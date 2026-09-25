/** 各层「长度分布桶」统计：用于收尾报告（超长条目还剩多少）。只读。
 * 用法: node stats-buckets.mjs [db路径] */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 记忆库路径：位置参数 > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.argv[2] ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const LEVELS = ['user', 'rules', 'project', 'fact', 'lesson', 'topic']
const BUCKETS = [[0, 150], [151, 300], [301, 400], [401, 600], [601, 1000], [1001, Number.MAX_SAFE_INTEGER]]
const db = new DatabaseSync(dbPath, { readOnly: true })
const label = (b) => (b[1] === Number.MAX_SAFE_INTEGER ? `>${b[0]}` : `${b[0]}~${b[1]}`)

console.log(`库：${dbPath}    采样：${new Date().toISOString().slice(0, 19)}`)
console.log(`\n| 层 | active | 字符 | ${BUCKETS.map(label).join(' | ')} | >300字 | >400字 |`)
console.log(`|---|---|---|---|---|---|---|---|---|`)
let tot = 0, totChar = 0, totOver300 = 0, totOver400 = 0
for (const level of LEVELS) {
  const rows = db.prepare(`SELECT LENGTH(content) AS n FROM ${level} WHERE status='active'`).all().map((r) => r.n)
  const counts = BUCKETS.map((b) => rows.filter((n) => n >= b[0] && n <= b[1]).length)
  const chars = rows.reduce((a, b) => a + b, 0)
  const over300 = rows.filter((n) => n > 300).length
  const over400 = rows.filter((n) => n > 400).length
  tot += rows.length; totChar += chars; totOver300 += over300; totOver400 += over400
  console.log(`| ${level} | ${rows.length} | ${chars} | ${counts.join(' | ')} | ${over300} | ${over400} |`)
}
console.log(`| **合计** | **${tot}** | **${totChar}** | | | | | **${totOver300}** | **${totOver400}** |`)
console.log(`\n估算 token ≈ ${Math.round(totChar * 0.75)}`)
