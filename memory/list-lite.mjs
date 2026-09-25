/** 列出某层 active 条目的紧凑概览（id / project / 重要性 / 长度 / 首 60 字）。
 * 用法: node list-lite.mjs <层名> */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const level = process.argv[2] ?? 'rules'
// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const cols = db.prepare(`PRAGMA table_info(${level})`).all().map((c) => c.name)
const has = (c) => (cols.includes(c) ? c : `'' AS ${c}`)
const rows = db.prepare(`SELECT id, ${has('project')}, ${has('subcategory')}, ${has('importance')}, LENGTH(content) AS n, substr(content,1,64) AS s FROM ${level} WHERE status='active' ORDER BY LENGTH(content) DESC`).all()
let total = 0
for (const r of rows) {
  total += r.n
  console.log(`${String(r.id).slice(0, 18)}  ${String(r.project).padEnd(22)} ${String(r.subcategory || '').padEnd(10)} imp${r.importance} ${String(r.n).padStart(5)}字  ${String(r.s).replace(/\s+/g, ' ')}`)
}
console.log(`\n${level}: ${rows.length} 条 active，总 ${total} 字符 ≈ ${Math.round(total * 0.75)} token`)
