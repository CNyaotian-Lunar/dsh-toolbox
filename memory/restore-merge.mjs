/**
 * 合并还原器：读 apply-merge.mjs 落下的 `undo-merge-<表>-<时间戳>.json`，一键还原整批：
 *   ① 主条的 content / keywords / project / importance 还原回合并前
 *   ② 该批被归档的**成员**改回 active（undo JSON 里的 `members` 字段；老批次没有该字段时可传 --ids 补）
 *
 * 用法: node restore-merge.mjs <undo-merge-*.json> [--table fact] [--apply]
 *       node restore-merge.mjs <undo-merge-*.json> --table fact --ids id1,id2 --apply
 * 注意：老批次（2026-09-22 16:07 之前）的 undo JSON **不含 members**，需从
 *       `out\undo-archive-<表>.sql` 里挑出对应那一段的 id，用 --ids 传进来。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const table = val('--table', 'fact')
const idsArg = val('--ids')
const jsonPath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table' && argv[i - 1] !== '--ids')
if (jsonPath === undefined || !existsSync(jsonPath)) throw new Error(`用法: node restore-merge.mjs <undo-merge-*.json> [--table fact] [--ids a,b] [--apply]`)

const rows = JSON.parse(readFileSync(jsonPath, 'utf8'))
// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const db = new DatabaseSync(val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')))

const memberIds = new Set(idsArg !== null ? idsArg.split(',').map((s) => s.trim()).filter(Boolean) : [])
for (const r of rows) for (const m of r.members ?? []) memberIds.add(m)
if (memberIds.size === 0) console.log('⚠️ 这批 undo 不含 members 且未传 --ids ⇒ 只还原主条正文，成员状态需另用 out\\undo-archive-*.sql')

let okMain = 0, missMain = 0
for (const r of rows) {
  const cur = db.prepare(`SELECT id, LENGTH(content) AS n FROM ${table} WHERE id = ?`).get(r.id)
  if (cur === undefined) { missMain++; console.log(`  [主条未找到] ${r.id}`); continue }
  okMain++
  if (!apply) console.log(`  主条 ${String(r.id).slice(0, 18)} 当前 ${cur.n} → 还原 ${String(r.content).length}`)
}
console.log(`主条：可还原 ${okMain} 条 / 未找到 ${missMain} 条`)

let okMem = 0, skipMem = 0
for (const m of memberIds) {
  const cur = db.prepare(`SELECT id, status FROM ${table} WHERE id = ?`).get(m)
  if (cur === undefined) { console.log(`  [成员未找到] ${m}`); continue }
  if (cur.status === 'active') { skipMem++; continue }
  okMem++
  if (!apply) console.log(`  成员 ${String(m).slice(0, 18)} ${cur.status} → active`)
}
console.log(`成员：可还原 ${okMem} 条 / 已是 active ${skipMem} 条`)

if (!apply) console.log('\n[dry-run] 未写库。加 --apply 执行。')
else {
  const sets = ['content = ?']
  const hasCol = (c) => db.prepare(`PRAGMA table_info(${table})`).all().some((x) => x.name === c)
  for (const c of ['keywords', 'project', 'importance']) if (hasCol(c)) sets.push(`${c} = ?`)
  const stmt = db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
  for (const r of rows) {
    const args = [r.content]
    if (hasCol('keywords')) args.push(r.keywords)
    if (hasCol('project')) args.push(r.project)
    if (hasCol('importance')) args.push(r.importance)
    args.push(r.id)
    stmt.run(...args)
  }
  if (memberIds.size > 0) {
    const list = [...memberIds].map((i) => `'${i}'`).join(',')
    db.exec(`UPDATE ${table} SET status='active' WHERE id IN (${list})`)
  }
  const after = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${table} WHERE status='active'`).get()
  console.log(`\n[applied] 还原完成：${table} active 现在 ${after.n} 条 / ${after.c} 字符`)
}
