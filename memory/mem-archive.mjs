/**
 * 多表通用归档器：把一批 id 标 archived（只改 status，不删数据），可 dry-run、可回滚。
 * 与 lesson 专用那份的区别：**表名可指定**（fact / topic / lesson / project / rules / user）。
 *
 * 用法:
 *   node mem-archive.mjs --table fact --ids <id1,id2,...> [--apply]
 *   node mem-archive.mjs --table topic --from-file <每行一个 id 的文本> [--apply]
 *   node mem-archive.mjs --table fact --cluster C1,C2 [--apply]      # 从 fact-topic-clusters.md 解析该簇 ids
 *
 *   --from <states>   只归档这些状态，默认 `active`。归档 stale 用 `--from stale`
 *                     （stale = 已完结；undo 会**还原成它原来的状态**，不是一律 active）。
 *
 * 行为：状态不在 --from 里的自动跳过；写库前把「将归档清单」全量打印；
 *      undo SQL 追加到 out\undo-archive-<table>.sql（**按原状态分组还原**）。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 聚类报告与 undo 的目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const REPORTS = {
  fact: `${OUT}/fact-topic-clusters.md`,
  topic: `${OUT}/fact-topic-clusters.md`,
  lesson: `${OUT}/lesson-clusters.md`,
  project: `${OUT}/project-clusters.md`,
}

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const val = (name, dflt = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt)
const table = val('--table')
if (table === null) throw new Error('必须给 --table（fact / topic / lesson / project / rules / user）')
const fromArg = val('--from', 'active')
const fromSet = new Set(fromArg.split(',').map((s) => s.trim()).filter(Boolean))

let ids = []
const idsArg = val('--ids')
const fileArg = val('--from-file')
const clusterArg = val('--cluster')

if (idsArg !== null) ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean)
else if (fileArg !== null) {
  for (const line of readFileSync(fileArg, 'utf8').split('\n')) {
    const s = line.trim()
    if (s === '' || s.startsWith('#')) continue
    const m = s.match(/([0-9a-z]{8,}-[0-9a-z-]{8,})/i)
    if (m !== null) ids.push(m[1])
  }
} else if (clusterArg !== null) {
  const rep = REPORTS[table]
  if (rep === undefined || !existsSync(rep)) throw new Error(`表 ${table} 没有对应报告可解析：${rep}`)
  const text = readFileSync(rep, 'utf8')
  for (const name of clusterArg.split(',').map((s) => s.trim()).filter(Boolean)) {
    const re = new RegExp(`####\\s*(?:\\(次要\\)\\s*)?${name}\\.([\\s\\S]*?)(?=\\n####\\s|\\n###\\s|\\n##\\s|$)`)
    const block = text.match(re)
    if (block === null) { console.log(`  [找不到簇] ${name}`); continue }
    // 抓块内所有「短号=id」或裸 id
    //
    // ⚠️ 已知缺陷（2026-09-22 实测）：簇块里的「⚠️ 已落地：合并产物 `0mucuv584-…`」这类
    //    **引用块里的裸 id 也会被一起抓走**，会把刚写好的合并产物当成员归档。
    //    ⇒ 用 --cluster 前**必须 dry-run 逐条核对**，或改用 --ids 显式列出。
    for (const m of block[1].matchAll(/[A-Z]\d+\s*=\s*`?([0-9a-z]{8,}-[0-9a-z-]{8,})`?/g)) ids.push(m[1])
    for (const m of block[1].matchAll(/`([0-9a-z]{8,}-[0-9a-z-]{8,})`/g)) ids.push(m[1])
  }
} else throw new Error('必须给 --ids / --from-file / --cluster 之一')

ids = [...new Set(ids)]
// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const db = new DatabaseSync(val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')))
const getRow = (id) => db.prepare(`SELECT id, status, substr(content,1,60) AS s, LENGTH(content) AS n FROM ${table} WHERE id = ?`).get(id)

const toArchive = []
let already = 0, missing = 0, chars = 0
for (const id of ids) {
  const row = getRow(id)
  if (row === undefined) {
    missing++
    // id 抄错一位是高发事故（36 位里少个字符肉眼看不出来）⇒ 用前 9 位做近似提示
    const near = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ? LIMIT 3`).all(`${String(id).slice(0, 9)}%`)
    console.log(`  [未找到] ${id}${near.length > 0 ? `  ← 近似：${near.map((r) => r.id).join(' / ')}` : ''}`)
    continue
  }
  if (!fromSet.has(row.status)) { already++; continue }
  chars += row.n
  toArchive.push(row)
  console.log(`  [将归档] ${row.id.slice(0, 18)} ${String(row.n).padStart(5)}字 (${row.status}) ${String(row.s).replace(/\s+/g, ' ')}`)
}

console.log(`\n${table}：请求 ${ids.length} 条 → 将归档 ${toArchive.length}（${chars} 字符，来源状态 ${fromArg}）/ 状态不符跳过 ${already} / 未找到 ${missing}`)
if (!apply) console.log('[dry-run] 未写库。加 --apply 执行。')
else {
  if (toArchive.length === 0) throw new Error('没有可归档的条目，拒绝执行')
  const list = toArchive.map((r) => `'${r.id}'`).join(',')
  const fromList = [...new Set(toArchive.map((r) => r.status))].map((s) => `'${s}'`).join(',')
  // undo：按「原状态」分组还原（归档 stale 时不能一律还原成 active）
  const byStatus = {}
  for (const r of toArchive) (byStatus[r.status] ??= []).push(r.id)
  let undoLines = `-- ${new Date().toISOString()} 归档 ${toArchive.length} 条（来源状态：${[...new Set(toArchive.map((r) => r.status))].join(',')}）\n`
  for (const [st, stIds] of Object.entries(byStatus)) {
    undoLines += `UPDATE ${table} SET status='${st}' WHERE id IN (${stIds.map((i) => `'${i}'`).join(',')});\n`
  }
  const undo = `${OUT}/undo-archive-${table}.sql`
  appendFileSync(undo, undoLines, 'utf8')
  db.exec(`UPDATE ${table} SET status='archived' WHERE id IN (${list}) AND status IN (${fromList})`)
  const after = db.prepare(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`).all()
  console.log(`[applied] ${table} 各状态：${after.map((r) => `${r.status}=${r.n}`).join(' / ')}`)
  const act = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${table} WHERE status='active'`).get()
  console.log(`          active ${act.n} 条 / ${act.c} 字符`)
  console.log(`[undo] ${undo}`)
}
