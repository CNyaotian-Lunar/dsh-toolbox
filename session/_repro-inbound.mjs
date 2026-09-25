/**
 * 反事实对照：真实会话 → chat 快照 → 折叠组。
 * 对照 baseline（修复前）与 patched（修复后）在「记忆轮里出现进站消息」时的折叠范围。
 *
 * 用法: node repro-inbound.mjs --fold-src <目录> [会话id子串...]   （不给会话 id = 扫全库）
 *   `--fold-src` 指向含 client-fold-baseline.ts / client-fold-fixed.ts 的目录（本仓库之外的 dsh 客户端源码），
 *   也可用环境变量 DSH_FOLD_SRC。缺少时脚本会直接报错退出。
 * 产物: 控制台输出（stdout 落盘由调用方重定向）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

// 会话根目录：DSH_SESSIONS_DIR > <DSH_HOME 或 ~/.dsh>/sessions。其下可能再套一层「工作区」目录。
const SESS_ROOT = process.env.DSH_SESSIONS_DIR ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
/** 列出所有会话文件（自动发现「工作区/会话/」与「会话/」两种层级；会话文件名形如 session.v<N>.jsonl.zstd） */
const SESSION_FILE_RE = /^session\.v\d+\.jsonl\.zstd$/i
function findSessions(root) {
  const out = []
  const scan = (dir, depth) => {
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const full = join(dir, e.name)
      let hit
      try { hit = readdirSync(full).find((n) => SESSION_FILE_RE.test(n)) } catch { continue }
      if (hit !== undefined) out.push({ dir: e.name, file: join(full, hit) })
      else if (depth > 0) scan(full, depth - 1)
    }
  }
  scan(root, 1)
  return out
}
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function unzstdMulti(file) {
  const buf = readFileSync(file)
  const offsets = []
  let i = 0
  while (i <= buf.length - 4) {
    const idx = buf.indexOf(MAGIC, i)
    if (idx === -1) break
    offsets.push(idx); i = idx + 4
  }
  if (offsets.length === 0 || offsets[0] !== 0) {
    try { return zstdDecompressSync(buf).toString('utf8') } catch { return '' }
  }
  const parts = []
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k]
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(start, end)).toString('utf8')) } catch { /* skip */ }
  }
  return parts.join('')
}

function readEvents(file) {
  const evs = []
  for (const line of unzstdMulti(file).split('\n')) {
    if (line.trim().length === 0) continue
    try { evs.push(JSON.parse(line)) } catch { /* 跳过坏行 */ }
  }
  return evs
}

/** 事件流 → items（与 dsh 客户端 messageDefinition 同判据：source.kind !== 'user' ⇒ context）。 */
function buildItems(evs) {
  const steeredIds = new Set()
  for (const e of evs) {
    if (e.type !== 'agent/inbox/spliced' || e.data?.target !== 'next-step') continue
    for (const m of e.data?.inserted ?? []) if (m?.source?.kind === 'user') steeredIds.add(String(m.id))
  }
  const turnOfEvent = []
  let turn = -1, step = -1
  for (const e of evs) {
    if (e.type === 'turn/start') { turn = e.data?.turn ?? turn + 1; step = -1 }
    if (e.type === 'step/start') { step = e.data?.step ?? step + 1 }
    turnOfEvent.push({ turn, step })
  }
  const items = []
  let idx = -1
  for (const e of evs) {
    idx++
    const { turn: t, step: s } = turnOfEvent[idx]
    if (e.type === 'user/message') {
      if (e.surfaceOp !== 'append') continue
      const src = e.data?.source ?? {}
      const key = `u:${String(e.data?.id).slice(0, 8)}`
      let kind
      if (src.kind !== 'user') kind = 'context'
      else if (steeredIds.has(String(e.data.id))) kind = 'steering'
      else kind = 'user'
      items.push({ seq: e.seq, key, kind, turn: t, node: { key, kind, location: { kind: 'turn', turn: { turn: t } }, data: { source: src, content: e.data?.content ?? [] } } })
      continue
    }
    if (e.type === 'assistant/message') {
      if (e.surfaceOp !== 'append') continue
      const key = `a:${e.seq}`
      const status = e.data?.message?.stopReason ?? e.data?.stopReason ?? 'settled'
      items.push({ seq: e.seq, key, kind: 'assistant-step', turn: t, node: { key, kind: 'assistant-step', location: { kind: 'step', turn: { turn: t }, step: { step: s } }, data: { status } } })
      continue
    }
    if (e.type === 'tool/call') {
      const key = `t:${String(e.data?.callId ?? e.seq).slice(0, 12)}`
      items.push({ seq: e.seq, key, kind: 'tool-call', turn: t, node: { key, kind: 'tool-call', location: { kind: 'step', turn: { turn: t }, step: { step: s } }, data: { root: { callId: e.data?.callId, name: e.data?.name, argsRaw: e.data?.arguments ?? '{}', turn: t, step: s, time: e.time ?? 0, subCalls: [] } } } })
      continue
    }
    if (e.type === 'turn/end') {
      const key = `tail:${t}`
      items.push({ seq: e.seq, key, kind: 'turn-tail', turn: t, node: { key, kind: 'turn-tail', location: { kind: 'turn', turn: { turn: t } }, data: {} } })
      continue
    }
  }
  items.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  return items
}

function makeSnapshot(items) {
  const order = items.map((i) => i.key)
  const map = new Map(items.map((i) => [i.key, i.node]))
  const byTurn = new Map()
  for (const i of items) {
    if (i.turn === undefined || i.turn < 0) continue
    const list = byTurn.get(i.turn) ?? []
    list.push(i.key)
    byTurn.set(i.turn, list)
  }
  return {
    chat: { order, nodes: { get: (k) => map.get(k) }, locations: { getTurn: (t) => byTurn.get(t) ?? [] } },
    __items: items, __byTurn: byTurn,
  }
}

const BOUNDARY_KINDS = new Set(['agent-message', 'subagent-settled', 'team-message', 'goal'])
const isInbound = (n) => typeof n?.data?.source?.kind === 'string' && BOUNDARY_KINDS.has(n.data.source.kind)
const textOf = (n) => (Array.isArray(n?.data?.content) ? n.data.content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('') : '')

// 折叠实现（修复前 / 修复后）不在本仓库里 —— 它属于 dsh 客户端源码，必须由使用者指明目录：
//   node repro-inbound.mjs --fold-src <目录>   （该目录需含 client-fold-baseline.ts / client-fold-fixed.ts）
// 也可以用环境变量 DSH_FOLD_SRC。
const foldSrcArg = (() => { const i = process.argv.indexOf('--fold-src'); return i >= 0 ? process.argv[i + 1] : undefined })()
const FOLD_SRC = foldSrcArg ?? process.env.DSH_FOLD_SRC
if (!FOLD_SRC) {
  console.error('缺少 --fold-src <目录>：该目录需含 client-fold-baseline.ts 与 client-fold-fixed.ts\n' +
    '  这两个模块是 dsh 客户端的折叠实现，不随本仓库分发；也可用环境变量 DSH_FOLD_SRC 指定。')
  process.exit(2)
}
const baseMod = await import(pathToFileURL(join(FOLD_SRC, 'client-fold-baseline.ts')).href)
const fixMod = await import(pathToFileURL(join(FOLD_SRC, 'client-fold-fixed.ts')).href)

// 位置参数是「会话 id 子串」，要排掉选项本身及其取值
const only = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--fold-src')
let dirs = findSessions(SESS_ROOT).map((s) => s.file).filter((p) => {
  try { return statSync(p).size > 0 } catch { return false }
})
if (only.length > 0) dirs = dirs.filter((p) => only.some((f) => p.includes(f)))

let scanned = 0, groups = 0, baseViolations = 0, fixViolations = 0, affectedTurns = 0
const samples = []
for (const file of dirs) {
  let evs
  try { evs = readEvents(file) } catch { continue }
  scanned++
  const items = buildItems(evs)
  const snap = makeSnapshot(items)
  const byTurn = snap.__byTurn
  const nodeOf = new Map(items.map((i) => [i.key, i.node]))
  const baseGroups = baseMod.computeFoldGroups(snap)
  const fixGroups = fixMod.computeFoldGroups(snap)
  for (const g of baseGroups) {
    const anchor = nodeOf.get(g.id)
    const turn = anchor?.location?.turn?.turn
    const keys = byTurn.get(turn) ?? []
    groups++
    const swallowed = g.keys.filter((k) => isInbound(nodeOf.get(k)))
    if (swallowed.length === 0) continue
    baseViolations++
    if (samples.length < 6) {
      // 被吞掉的进站消息之后还有多少节点（= 用户看不见的正文规模）
      const insideIdx = g.keys.map((k) => keys.indexOf(k))
      const lastInboundIdx = Math.max(...g.keys.filter((k) => isInbound(nodeOf.get(k))).map((k) => keys.indexOf(k)))
      // 口径：**折叠组内**、位于最后一个进站消息之后的节点（这些才是被藏掉的"正文"）
      const after = g.keys.filter((k) => keys.indexOf(k) > lastInboundIdx)
      const fixed = fixGroups.find((x) => x.id === g.id)
      samples.push({
        session: file.split('\\').slice(-2)[0],
        turn,
        variant: g.variant,
        swallowedInbound: swallowed.length,
        inboundPreview: textOf(nodeOf.get(swallowed[0])).replace(/\s+/g, ' ').slice(0, 90),
        baselineKeys: g.keys.length,
        fixedKeys: fixed === undefined ? 0 : fixed.keys.length,
        nodesAfterInboundHiddenByBaseline: after.length,
        insideIdxRange: `${Math.min(...insideIdx)}..${Math.max(...insideIdx)} of turn ${keys.length} nodes`,
      })
    }
  }
  // 修复后断言：任何折叠组都不得再含进站消息
  for (const g of fixGroups) {
    const bad = g.keys.filter((k) => isInbound(nodeOf.get(k)))
    if (bad.length > 0) fixViolations++
  }
  if (fixGroups.some((g) => g.keys.some((k) => isInbound(nodeOf.get(k))))) affectedTurns++
}

console.log(`# scanned sessions = ${scanned}`)
console.log(`# 记忆折叠组（baseline）= ${groups}`)
console.log(`# 【修复前】折叠组内含"进站消息"（= 实测发现的 bug）= ${baseViolations}`)
console.log(`# 【修复后】折叠组内含"进站消息" = ${fixViolations}  (受影响会话 ${affectedTurns})`)
console.log('')
for (const s of samples) console.log(JSON.stringify(s, null, 1))
console.log('')
console.log(baseViolations > 0 && fixViolations === 0
  ? `反事实断言通过：baseline 违规 ${baseViolations} 处 → 修复后 0 处`
  : `反事实断言未通过：baseline=${baseViolations} fixed=${fixViolations}`)
process.exit(fixViolations === 0 ? 0 : 1)
