/**
 * 判据裁剪器：按可解释的判据批量归档条目（只改 status，不删数据），可 dry-run、可回滚。
 *
 * 用法:
 *   node mem-cut.mjs --table lesson --rule <判据> [--limit N] [--olderThanDays D] [--apply]
 * 判据（rule）:
 *   low-imp         importance ≤ 2
 *   never           从未被检索命中（last_accessed_at 为空）
 *   never+low       从未命中 且 importance ≤ 3
 *   never+low+old   从未命中 + importance ≤ 3 + 创建 ≥ <D> 天（默认 3）  ← 推荐：避开刚写的新条
 *   never+verylow   从未命中 且 importance ≤ 2
 *   never+verylow+old 从未命中 + importance ≤ 2 + 创建 ≥ <D> 天（默认 3）
 * 排序：默认按内容长度【从长到短】砍（先砍占体积最多的）；--limit N 只砍前 N 条。
 *
 * ⚠️ 为什么必须带时间窗：`last_accessed_at` 对"刚写进去的条目"必然是空的，
 *    单用 never 会把最新、最相关的条目一起砍掉。
 */
import { DatabaseSync } from 'node:sqlite'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** undo 落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const table = val('--table')
if (table === null) throw new Error('必须给 --table')
const rule = val('--rule')
if (rule === null) throw new Error('必须给 --rule（low-imp / never / never+low / never+low+old / never+verylow）')
const limit = Number(val('--limit', '0'))
const olderDays = Number(val('--olderThanDays', '3'))

// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const db = new DatabaseSync(val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')))
const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
const has = (c) => cols.includes(c)

const rows = db.prepare(`SELECT * FROM ${table} WHERE status='active'`).all()
const never = (r) => !has('last_accessed_at') || r.last_accessed_at === null || r.last_accessed_at === undefined
const imp = (r) => (has('importance') ? (r.importance ?? 0) : 0)
const ageDays = (r) => (has('created_at') ? (Date.now() - Number(r.created_at ?? 0)) / 86400000 : 999)

const preds = {
  'low-imp': (r) => imp(r) <= 2,
  'never': (r) => never(r),
  'never+low': (r) => never(r) && imp(r) <= 3,
  'never+verylow': (r) => never(r) && imp(r) <= 2,
  'never+low+old': (r) => never(r) && imp(r) <= 3 && ageDays(r) >= olderDays,
  'never+verylow+old': (r) => never(r) && imp(r) <= 2 && ageDays(r) >= olderDays,
}
const pred = preds[rule]
if (pred === undefined) throw new Error(`未知判据：${rule}`)

let picked = rows.filter(pred).sort((a, b) => String(b.content).length - String(a.content).length)
const totalChars = picked.reduce((a, r) => a + String(r.content).length, 0)
console.log(`判据 ${rule}（${table}）命中 ${picked.length} 条 / ${totalChars} 字符；当前 active ${rows.length} 条`)
if (limit > 0) picked = picked.slice(0, limit)

let chars = 0
for (const r of picked) {
  chars += String(r.content).length
  console.log(`  ${String(r.id).slice(0, 18)} imp${imp(r)} ${String(ageDays(r) | 0).padStart(3)}天前 ${String(String(r.content).length).padStart(5)}字 ${String(r.content).replace(/\s+/g, ' ').slice(0, 56)}`)
}
console.log(`\n将归档 ${picked.length} 条 / ${chars} 字符 ⇒ 之后 active ≈ ${rows.length - picked.length} 条`)

if (!apply) console.log('[dry-run] 未写库。加 --apply 执行。')
else {
  if (picked.length === 0) throw new Error('没有命中条目，拒绝执行')
  const list = picked.map((r) => `'${r.id}'`).join(',')
  const undo = `${OUT}/undo-cut-${table}-${rule.replace(/\+/g, '_')}.sql`
  appendFileSync(undo, `-- ${new Date().toISOString()} 判据 ${rule} 归档 ${picked.length} 条\nUPDATE ${table} SET status='active' WHERE id IN (${list});\n`, 'utf8')
  db.exec(`UPDATE ${table} SET status='archived' WHERE id IN (${list})`)
  const after = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${table} WHERE status='active'`).get()
  console.log(`[applied] ${table} active 现在 ${after.n} 条 / ${after.c} 字符`)
  console.log(`[undo] ${undo}`)
}
