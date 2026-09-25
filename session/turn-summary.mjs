/** 按 turn 汇总一个会话的结构：步数 / 每步的 assistant 内容块类型 / 是否有 meow prompt / 进站消息 / 结束原因。
 *  用于定位 dsh 本体 turn-process 行的「正文被折」判据（latestAnswer → null 的条件）。 */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
  while (i <= buf.length - 4) { const idx = buf.indexOf(MAGIC, i); if (idx === -1) break; offsets.push(idx); i = idx + 4 }
  const parts = []
  for (let k = 0; k < offsets.length; k++) {
    const s = offsets[k], e = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(s, e)).toString('utf8')) } catch {}
  }
  return parts.join('')
}
const [frag, lastN] = process.argv.slice(2)
const tail = Number(lastN ?? 4)
const hit = findSessions(SESS_ROOT).find((s) => s.dir.includes(frag))
if (hit === undefined) { console.error(`找不到目录名含 "${frag}" 的会话（会话根：${SESS_ROOT}）`); process.exit(2) }
const dir = hit.dir
const evs = []
for (const line of unzstdMulti(hit.file).split('\n')) {
  if (!line.trim()) continue
  try { evs.push(JSON.parse(line)) } catch {}
}

let turn = -1, step = -1
const turns = new Map()
for (const e of evs) {
  if (e.type === 'turn/start') { turn = e.data?.turn ?? turn + 1; step = -1 }
  if (e.type === 'step/start') { step = e.data?.step ?? step + 1 }
  if (turn < 0) continue
  let t = turns.get(turn)
  if (t === undefined) { t = { turn, steps: new Map(), prompts: 0, inbound: 0, end: '', lastEvent: e.type }; turns.set(turn, t) }
  t.lastEvent = e.type
  if (e.type === 'turn/end') t.end = e.data?.reason?.kind ?? JSON.stringify(e.data?.reason ?? '')
  const s = (n) => { let v = t.steps.get(n); if (v === undefined) { v = { assistant: [], tools: 0, text: 0 }; t.steps.set(n, v) } return v }
  if (e.type === 'user/message') {
    const src = e.data?.source ?? {}
    if (src.kind === 'plugin' && src.plugin === 'meow-memory') t.prompts++
    else if (['agent-message', 'subagent-settled', 'team-message', 'goal'].includes(src.kind)) t.inbound++
  }
  if (e.type === 'assistant/message' && e.surfaceOp === 'append') {
    const content = e.data?.message?.content ?? []
    const types = content.map((b) => b.type)
    const hasText = content.some((b) => b.type === 'text' && (b.text ?? '').trim() !== '')
    const rec = s(step)
    rec.assistant.push(`${types.join('+')}${hasText ? '[有文本]' : '[无文本]'} stop=${e.data?.message?.stopReason ?? '?'}`)
    if (hasText) rec.text++
  }
  if (e.type === 'tool/call') s(step).tools++
}
const all = [...turns.values()].sort((a, b) => a.turn - b.turn)
console.log(`会话 ${dir}：共 ${all.length} 个 turn（下面只列最后 ${tail} 个）`)
for (const t of all.slice(-tail)) {
  console.log(`\n--- turn ${t.turn}  meowPrompt=${t.prompts} inbound=${t.inbound} end=${t.end} 最后事件=${t.lastEvent}`)
  for (const [n, v] of [...t.steps.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`   step ${String(n).padStart(2)}: tools=${v.tools} 文本消息=${v.text}  assistant=[${v.assistant.join(' | ')}]`)
  }
}
