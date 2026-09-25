/** 记忆库一致性备份（VACUUM INTO：包含 WAL 里未落盘的数据，源库不改数据）。
 * 用法: node backup-db.mjs <源 memory.db> <目标文件>  —— 目标必须不存在 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

const src = process.argv[2]
const dst = process.argv[3]
if (existsSync(dst)) throw new Error(`目标已存在，拒绝覆盖：${dst}`)
const db = new DatabaseSync(src)
db.prepare('VACUUM INTO ?').run(dst)
db.close()
const check = new DatabaseSync(dst, { readOnly: true })
let total = 0
for (const t of ['user', 'rules', 'project', 'fact', 'lesson', 'topic', 'soul']) {
  const n = check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  total += n
  console.log(`${t.padEnd(8)} ${String(n).padStart(5)}`)
}
console.log(`合计 ${total} 行 → ${dst}`)
