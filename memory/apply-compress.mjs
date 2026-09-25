/**
 * 压缩落地器（**任意层**）：把子代理产出的 JSON（[{short,id,oldLen,newLen,newContent}]）批量写进记忆库。
 * - 只改 content，不动 status/keywords/时间戳。
 * - 写前把**旧 content 全量**存成 undo JSON（带表名 + 时间戳，**不会覆盖上一批**）。
 * - 逐条校验：id 存在 / 状态在 --from 内 / newLen === newContent.length / 新内容不太短。
 * 用法: node apply-compress.mjs <json...> [--table fact] [--from active] [--minLen 150] [--apply]
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** undo 落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db'))
const table = val('--table', 'lesson')
const fromArg = val('--from', 'active')
const fromSet = new Set(fromArg.split(',').map((s) => s.trim()).filter(Boolean))
const minLen = Number(val('--minLen', '150'))
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table' && argv[i - 1] !== '--from' && argv[i - 1] !== '--minLen' && argv[i - 1] !== '--db')
if (files.length === 0) throw new Error('用法: node apply-compress.mjs <json...> [--table fact] [--apply]')

const db = new DatabaseSync(dbPath)
const getRow = (id) => db.prepare(`SELECT id, status, LENGTH(content) AS n, content FROM ${table} WHERE id = ?`).get(id)

const todo = []
const undo = []
let skipArchived = 0, skipMissing = 0, skipBad = 0, oldSum = 0, newSum = 0

for (const f of files) {
  if (!existsSync(f)) { console.log(`[缺文件] ${f}`); continue }
  const arr = JSON.parse(readFileSync(f, 'utf8'))
  if (!Array.isArray(arr)) throw new Error(`${f} 不是数组`)
  for (const item of arr) {
    const row = getRow(item.id)
    if (row === undefined) { skipMissing++; console.log(`  [未找到] ${item.short} ${item.id}`); continue }
    if (!fromSet.has(row.status)) { skipArchived++; console.log(`  [状态不符跳过] ${item.short} ${String(item.id).slice(0, 18)} status=${row.status}`); continue }
    const len = String(item.newContent ?? '').length
    if (len !== item.newLen) { skipBad++; console.log(`  [长度不符] ${item.short} 声明 ${item.newLen} 实算 ${len}`); continue }
    if (len < minLen) { skipBad++; console.log(`  [过短拒收] ${item.short} ${len} 字 < ${minLen}`); continue }
    if (len >= String(row.content).length) { skipBad++; console.log(`  [未变短拒收] ${item.short} ${String(row.content).length} → ${len}`); continue }
    oldSum += String(row.content).length
    newSum += len
    undo.push({ id: row.id, content: row.content })
    todo.push({ item, row })
  }
}

console.log(`\n待写 ${todo.length} 条（${table}）：${oldSum} 字符 → ${newSum} 字符（省 ${oldSum - newSum}）；跳过：状态不符 ${skipArchived} / 未找到 ${skipMissing} / 不合格 ${skipBad}`)
for (const { item, row } of todo) console.log(`  ${String(item.short).padEnd(5)} ${String(item.id).slice(0, 18)} ${String(String(row.content).length).padStart(5)} → ${String(item.newLen).padStart(5)}`)

if (!apply) {
  console.log('\n[dry-run] 未写库。加 --apply 执行。')
} else {
  if (todo.length === 0) throw new Error('没有可写的条目，拒绝执行')
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const UNDO = `${OUT}/undo-compress-${table}-${stamp}.json`
  if (existsSync(UNDO)) throw new Error(`undo 目标已存在，拒绝覆盖：${UNDO}`)
  const stmt = db.prepare(`UPDATE ${table} SET content = ? WHERE id = ?`)
  for (const { item, row } of todo) stmt.run(item.newContent, row.id)
  writeFileSync(UNDO, JSON.stringify(undo, null, 1), 'utf8')
  const after = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${table} WHERE status='active'`).get()
  console.log(`\n[applied] ${table} active 现在 ${after.n} 条 / ${after.c} 字符`)
  console.log(`[undo] ${UNDO}（${undo.length} 条旧正文；还原：node restore-compress.mjs <该文件> --apply）`)
}
