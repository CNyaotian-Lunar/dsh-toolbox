/**
 * 合并产物独立验真（主 agent 专用，**不信子代理自检**）：
 * 读 apply-merge 的输入 JSON，自己从库里重读主条与成员原文，算「成员原文实体 token 在主条新正文里的覆盖率」。
 * 用法: node verify-merge-json.mjs <json> [--table fact] [--dump C1,C2]
 *   --dump 逗号列出的簇会把「主条新正文 + 丢失实体」落到 tmp-main/verify-merge-<short>.txt
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `--dump` 落盘目录：默认仓库的 out\tmp-main，可用 DSH_TOOLBOX_OUT 覆盖 */
const OUTDIR = process.env.DSH_TOOLBOX_OUT ? join(process.env.DSH_TOOLBOX_OUT, 'tmp-main') : join(HERE, '..', 'out', 'tmp-main')
const argv = process.argv.slice(2)
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const table = val('--table', 'fact')
const dump = new Set((val('--dump', '') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const jsonPath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table' && argv[i - 1] !== '--dump')
if (jsonPath === undefined) throw new Error('用法: node verify-merge-json.mjs <json> [--table fact] [--dump C1,C2]')

const arr = JSON.parse(readFileSync(jsonPath, 'utf8'))
// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const TOKEN_RE = /[A-Za-z0-9_][A-Za-z0-9_.\-/\\:]{3,}/g
const pick = (s) => new Set((String(s).match(TOKEN_RE) ?? []).map((t) => t.replace(/[.,;)]$/, '')))
const get = (id) => db.prepare(`SELECT id, status, content FROM ${table} WHERE id = ?`).get(id)

const lines = []
let fail = 0, oldSum = 0, newSum = 0
console.log(`解析 ${arr.length} 簇（表 ${table}）\n${'簇'.padEnd(8)}${'主条旧'.padStart(7)}${'新'.padStart(7)}${'簇内原'.padStart(8)}${'省'.padStart(7)}   覆盖率  状态`)
for (const e of arr) {
  const main = get(e.mainId)
  if (main === undefined) { console.log(`${e.cluster}: [主条未找到] ${e.mainId}`); fail++; continue }
  const memberIds = [...new Set(e.members ?? [])].filter((m) => m !== e.mainId)
  const mRows = memberIds.map((m) => get(m))
  const missMembers = memberIds.filter((m, i) => mRows[i] === undefined)
  const badStatus = []
  if (main.status !== 'active') badStatus.push(`主条=${main.status}`)
  mRows.forEach((r, i) => { if (r !== undefined && r.status !== 'active') badStatus.push(`${memberIds[i].slice(0, 9)}=${r.status}`) })
  const memberText = mRows.filter(Boolean).map((r) => r.content).join('\n')
  const oldT = pick(memberText)
  const newT = pick(e.newContent)
  const missing = [...oldT].filter((t) => !newT.has(t) && t.length >= 5)
  const cov = oldT.size === 0 ? 1 : (oldT.size - missing.length) / oldT.size
  const mainOld = String(main.content).length
  const clusterOld = mainOld + mRows.filter(Boolean).reduce((a, r) => a + String(r.content).length, 0)
  oldSum += clusterOld
  newSum += e.newLen
  const lenOk = e.newLen === String(e.newContent).length
  const flags = []
  if (!lenOk) flags.push('长度不符')
  if (missMembers.length > 0) flags.push(`缺成员 ${missMembers.length}`)
  if (badStatus.length > 0) flags.push(`状态 ${badStatus.join(',')}`)
  if (e.newLen >= clusterOld) flags.push('膨胀')
  if (flags.length > 0) fail++
  console.log(`${String(e.cluster).padEnd(8)}${String(mainOld).padStart(7)}${String(e.newLen).padStart(7)}${String(clusterOld).padStart(8)}${String(clusterOld - e.newLen).padStart(7)}   ${(cov * 100).toFixed(1)}%  ${flags.length === 0 ? 'OK' : '⚠ ' + flags.join(' / ')}`)
  if (dump.has(e.cluster)) {
    lines.push(`===== ${e.cluster} 主条 ${e.mainId} 旧 ${mainOld} → 新 ${e.newLen}（簇内原 ${clusterOld}）=====`, e.newContent, '', `[丢失实体 ${missing.length}] ${missing.join(' ')}`, '')
  }
}
console.log(`\n合计：簇内原 ${oldSum} → 合并后 ${newSum}（净省 ${oldSum - newSum}，保留率 ${(newSum / oldSum * 100).toFixed(1)}%）；不合格 ${fail} 簇`)
if (lines.length > 0) {
  const p = `${OUTDIR}/verify-merge-${[...dump].join('-')}.txt`
  writeFileSync(p, lines.join('\n'), 'utf8')
  console.log(`dump → ${p}`)
}
