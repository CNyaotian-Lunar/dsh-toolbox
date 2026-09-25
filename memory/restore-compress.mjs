/**
 * 压缩还原器：读 apply-compress.mjs 落下的 undo JSON，把 content 还原回压缩前。
 * 用法: node restore-compress.mjs <undo-compress-*.json> [--table fact] [--apply]
 *   --table 省略时：先按文件名里的表名猜（`undo-compress-fact-20260923001234.json`），
 *   猜不到就退回 lesson（兼容最早的 `undo-compress.json`）。
 * 注意：还原**只改 content**，不动 status / keywords / 时间戳。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** undo 默认目录：仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const DEFAULT_UNDO = join(OUT, 'undo-compress.json')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)

const undoPath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table') ?? DEFAULT_UNDO
if (!existsSync(undoPath)) throw new Error(`找不到 undo 文件：${undoPath}`)

const guess = /undo-compress-([a-z]+)-?\d*\.json$/.exec(undoPath.replace(/\\/g, '/'))
const table = val('--table', guess !== null ? guess[1] : 'lesson')

const rows = JSON.parse(readFileSync(undoPath, 'utf8'))
console.log(`undo 文件：${undoPath}（${rows.length} 条）→ 表 ${table}`)

// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const db = new DatabaseSync(val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')))
let ok = 0, missing = 0
let backChars = 0
for (const r of rows) {
  const cur = db.prepare(`SELECT LENGTH(content) AS n FROM ${table} WHERE id = ?`).get(r.id)
  if (cur === undefined) { missing++; console.log(`  [未找到] ${r.id}`); continue }
  ok++
  backChars += String(r.content).length - cur.n
  if (!apply) console.log(`  ${String(r.id).slice(0, 18)} 当前 ${cur.n} → 还原 ${String(r.content).length}`)
}
console.log(`可还原 ${ok} 条 / 未找到 ${missing} 条；还原后约增加 ${backChars} 字符`)
if (!apply) console.log('\n[dry-run] 未写库。加 --apply 执行。')
else {
  const stmt = db.prepare(`UPDATE ${table} SET content = ? WHERE id = ?`)
  for (const r of rows) stmt.run(r.content, r.id)
  const after = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${table} WHERE status='active'`).get()
  console.log(`[applied] 还原完成：${table} active 现在 ${after.n} 条 / ${after.c} 字符`)
}
