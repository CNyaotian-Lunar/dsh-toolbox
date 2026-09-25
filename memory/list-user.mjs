/**
 * B1 判决辅助：列出 user 层全部 active 条目（id + 长度 + 主题指纹），供逐条判决。
 * 用法: node list-user.mjs [过滤正则]
 */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null
const rows = db.prepare("SELECT id, content, keywords, importance, created_at, updated_at FROM user WHERE status='active' ORDER BY LENGTH(content) DESC").all()

let total = 0
let shown = 0
for (const r of rows) {
  total += String(r.content).length
  if (filter && !filter.test(String(r.content))) continue
  shown++
  console.log(`${r.id.slice(0, 18)} ${String(String(r.content).length).padStart(4)}字 imp${r.importance} ${String(r.content).replace(/\s+/g, ' ').slice(0, 78)}`)
}
console.log(`\n匹配 ${shown} / 全部 ${rows.length} 条，总 ${total} 字符（≈${Math.round(total * 0.75)} token）`)
