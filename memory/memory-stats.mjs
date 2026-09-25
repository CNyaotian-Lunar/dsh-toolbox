/**
 * 只读清点记忆库：表结构 / 各层条数与状态分布 / project 子类 / 最近更新。
 * 用法: node memory-stats.mjs [memory.db 路径]
 */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 记忆库路径：位置参数 > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.argv[2] ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
console.log(`库：${dbPath}`)
console.log(`表：${tables.join(', ')}\n`)

const LEVELS = ['soul', 'user', 'project', 'fact', 'lesson', 'topic', 'rules']
let total = 0
console.log('=== 各层条数（按状态） ===')
for (const t of LEVELS) {
  if (!tables.includes(t)) continue
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM ${t} GROUP BY status`).all()
  const byStatus = Object.fromEntries(rows.map((r) => [r.status ?? '(空)', r.n]))
  const sum = rows.reduce((a, r) => a + r.n, 0)
  total += (byStatus.active ?? 0)
  console.log(`${t.padEnd(8)} 合计 ${String(sum).padStart(4)}  ${JSON.stringify(byStatus)}`)
}
console.log(`\n（active 总数 = ${total}）`)

if (tables.includes('project')) {
  console.log('\n=== project 按 project 名 + 子类 ===')
  for (const r of db.prepare(`SELECT project, ` + `COALESCE(subcategory,'(无)') AS sub, COUNT(*) AS n, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS act FROM project GROUP BY project, sub ORDER BY act DESC, project`).all()) {
    console.log(`${String(r.act).padStart(3)} act / ${String(r.n).padStart(3)}  ${String(r.project).padEnd(24)} ${r.sub}`)
  }
}

console.log('\n=== 各层最近 5 条（按 updated_at） ===')
for (const t of LEVELS) {
  if (!tables.includes(t)) continue
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  if (!cols.includes('updated_at')) continue
  console.log(`\n--- ${t} ---`)
  for (const r of db.prepare(`SELECT * FROM ${t} WHERE status='active' ORDER BY updated_at DESC LIMIT 5`).all()) {
    const c = String(r.content ?? '').replace(/\s+/g, ' ')
    console.log(`  [${r.updated_at}] ${r.title ? r.title + ' · ' : ''}${c.slice(0, 90)}${c.length > 90 ? '…' : ''}`)
  }
}

console.log('\n=== 其它表 ===')
for (const t of tables) {
  if (LEVELS.includes(t)) continue
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
  const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  console.log(`${t.padEnd(14)} ${String(n).padStart(5)} 行  列: ${cols.join(', ')}`)
}
