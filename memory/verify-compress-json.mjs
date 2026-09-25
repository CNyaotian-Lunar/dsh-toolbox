/**
 * 压缩产物独立验真（任意层，主 agent 用，**不信子代理自检**）：
 *   ① id 存在 / 状态 / newLen === newContent.length / 真变短 / ≥ minLen
 *   ② **覆盖率**：原文的实体 token 有多少进了新文（低≠丢事实，删过程/URL/命令必然掉分，须再人工过目）
 *   ③ **反向核对**：新文里出现的 token / 数字，有多少是原文没有的（>0 就是"凭空新增事实"，这是硬伤）
 * 用法: node verify-compress-json.mjs <json...> [--table topic] [--dump C1,C2]
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
const table = val('--table', 'lesson')
const dump = new Set(String(val('--dump', '')).split(',').map((s) => s.trim()).filter(Boolean))
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table' && argv[i - 1] !== '--dump')
if (files.length === 0) throw new Error('用法: node verify-compress-json.mjs <json...> [--table topic] [--dump C1]')

// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const TOKEN_RE = /[A-Za-z0-9_][A-Za-z0-9_.\-/\\:]{3,}/g
const pick = (s) => new Set((String(s).match(TOKEN_RE) ?? []).map((t) => t.replace(/[.,;)]$/, '')))
const get = (id) => db.prepare(`SELECT id, status, content FROM ${table} WHERE id = ?`).get(id)

let bad = 0, oldSum = 0, newSum = 0, addedTotal = 0
const lines = []
for (const f of files) {
  console.log(`\n=== ${f}（表 ${table}）===`)
  console.log(`${'short'.padEnd(9)}${'old'.padStart(6)}${'new'.padStart(6)}   覆盖  新增 状态`)
  for (const e of JSON.parse(readFileSync(f, 'utf8'))) {
    const row = get(e.id)
    if (row === undefined) { console.log(`${String(e.short).padEnd(9)} [未找到] ${e.id}`); bad++; continue }
    const oldText = String(row.content)
    const newText = String(e.newContent)
    const oldT = pick(oldText), newT = pick(newText)
    // 覆盖：原文 token 是否还在新文里（双向子串，容忍"路径缩成后缀"这类等价改写）
    const newArr = [...newT]
    const covered = (t) => { const k = t.toLowerCase(); return newArr.some((n) => n.toLowerCase().includes(k) || k.includes(n.toLowerCase())) }
    const missing = [...oldT].filter((t) => t.length >= 5 && !covered(t))
    const cov = oldT.size === 0 ? 1 : (oldT.size - missing.length) / oldT.size
    // 反向：新文里有、原文没有的 token（排除掉"被缩写后的残留"这类误报：只在长度≥5 时算）
    const added = [...newT].filter((t) => t.length >= 5 && ![...oldT].some((o) => t.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(t.toLowerCase())))
    const flags = []
    if (row.status !== 'active') flags.push(`状态=${row.status}`)
    if (e.newLen !== newText.length) flags.push('长度不符')
    if (newText.length >= oldText.length) flags.push('没变短')
    if (newText.length < 250) flags.push('<250')
    if (added.length > 0) flags.push(`新增${added.length}`)
    if (flags.length > 0) bad++
    addedTotal += added.length
    oldSum += oldText.length; newSum += newText.length
    console.log(`${String(e.short).padEnd(9)}${String(oldText.length).padStart(6)}${String(newText.length).padStart(6)}  ${(cov * 100).toFixed(0).padStart(4)}%  ${String(added.length).padStart(3)}  ${flags.length === 0 ? 'OK' : '⚠ ' + flags.join(' / ')}`)
    if (added.length > 0) console.log(`      新增 token: ${added.slice(0, 12).join(' ')}${added.length > 12 ? ` …(+${added.length - 12})` : ''}`)
    if (dump.has(e.short)) lines.push(`===== ${e.short} ${e.id} 旧 ${oldText.length} → 新 ${newText.length} =====`, newText, '', `[丢失 ${missing.length}] ${missing.join(' ')}`, `[新增 ${added.length}] ${added.join(' ')}`, '')
  }
}
console.log(`\n合计：${oldSum} → ${newSum}（省 ${oldSum - newSum}，保留率 ${(newSum / oldSum * 100).toFixed(1)}%）；不合格 ${bad} 条；新增 token 总数 ${addedTotal}`)
console.log('说明：覆盖率低 ≠ 丢事实（删过程/URL/命令必然掉分）⇒ 覆盖 <60% 或有"新增 token"的条目要人工过目。')
if (lines.length > 0) { const p = `${OUTDIR}/verify-compress-dump.txt`; writeFileSync(p, lines.join('\n'), 'utf8'); console.log(`dump → ${p}`) }
