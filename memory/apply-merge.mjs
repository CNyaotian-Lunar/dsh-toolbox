/**
 * 合并落地器：把一个簇的成员合并进【主条】——改写主条正文（+可选 keywords/project/importance），
 * 其余成员标 archived（数据不删）。可 dry-run、可回滚（undo JSON + undo SQL）。
 *
 * 输入 JSON 结构（数组）：
 *   [{ cluster:"C1", mainId:"<36位id>", mainShort:"F166", newContent:"...", newLen:993,
 *      members:["<id>", ...],            // 要被归档的成员（**不含主条**）
 *      keywords?:[...], project?:"...", importance?:3 }]
 *
 * 安全：主条与成员必须都是 active；member 含主条会被剔除；newLen 必须等于实算长度；
 *      **合并结果必须比「簇内原总和」短**（否则不是合并是膨胀 → 拒收，除非 --allowGrow）。
 *      ⚠️ 注意：合并结果**允许、而且通常**比主条自身原长更长（它并进了别的成员）——
 *      早先版本误用"必须比主条短"当判据，会让所有正常合并被拒。
 *
 * 用法: node apply-merge.mjs <json...> [--table fact] [--from active] [--allowGrow] [--apply]
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** undo 落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const allowGrow = argv.includes('--allowGrow')
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const table = val('--table', 'fact')
const fromArg = val('--from', 'active')
const fromSet = new Set(fromArg.split(',').map((s) => s.trim()).filter(Boolean))
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table' && argv[i - 1] !== '--from' && argv[i - 1] !== '--db')

// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const db = new DatabaseSync(val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')))
const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
const get = (id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
const has = (c) => cols.includes(c)

const plan = []
const undoJson = []
const undoIds = []
let bad = 0

for (const f of files) {
  if (!existsSync(f)) { console.log(`[缺文件] ${f}`); bad++; continue }
  const arr = JSON.parse(readFileSync(f, 'utf8'))
  if (!Array.isArray(arr)) throw new Error(`${f} 不是数组`)
  for (const e of arr) {
    const main = get(e.mainId)
    if (main === undefined) {
      const near = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ? LIMIT 3`).all(`${String(e.mainId).slice(0, 9)}%`)
      console.log(`[主条未找到] ${e.cluster} ${e.mainId}${near.length > 0 ? `  ← 近似：${near.map((r) => r.id).join(' / ')}` : ''}`); bad++; continue
    }
    if (!fromSet.has(main.status)) { console.log(`[主条状态不符] ${e.cluster} ${String(e.mainId).slice(0, 18)} → ${main.status}`); bad++; continue }
    const len = String(e.newContent ?? '').length
    if (len !== e.newLen) { console.log(`[长度不符] ${e.cluster} 声明 ${e.newLen} 实算 ${len}`); bad++; continue }
    // members 兼容两种形态：id 字符串数组，或子代理常产出的对象数组 `[{id,short,oldLen,action}]`
    const rawMembers = (e.members ?? [])
      .map((m) => (typeof m === 'string' ? m : m?.id))
      .filter((x) => typeof x === 'string' && x !== '')
    if (rawMembers.includes(e.mainId)) console.log(`[members 含主条，已剔除] ${e.cluster} ${String(e.mainId).slice(0, 18)}`)
    const members = [...new Set(rawMembers)].filter((m) => m !== e.mainId)
    const rows = []
    let missing = 0
    for (const m of members) {
      const r = get(m)
      if (r === undefined) {
        const near = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ? LIMIT 3`).all(`${String(m).slice(0, 9)}%`)
        console.log(`  [成员未找到] ${e.cluster} ${m}${near.length > 0 ? `  ← 近似：${near.map((x) => x.id).join(' / ')}` : ''}`); missing++; continue
      }
      if (!fromSet.has(r.status)) { console.log(`  [成员状态不符跳过] ${e.cluster} ${String(m).slice(0, 18)} → ${r.status}`); continue }
      rows.push(r)
    }
    const oldSum = String(main.content).length + rows.reduce((a, r) => a + String(r.content).length, 0)
    if (!allowGrow && len >= oldSum) {
      console.log(`[膨胀拒收] ${e.cluster} 簇内原 ${oldSum} → 合并后 ${len}（要放行加 --allowGrow）`); bad++; continue
    }
    plan.push({ e, main, rows, len, oldSum, missing })
  }
}

let gainOld = 0, gainNew = 0
console.log(`\n待合并 ${plan.length} 簇（表 ${table}）：`)
for (const p of plan) {
  gainOld += p.oldSum
  gainNew += p.len
  console.log(`  ${String(p.e.cluster).padEnd(7)} 主条 ${String(p.e.mainId).slice(0, 12)} ${String(String(p.main.content).length).padStart(5)} → ${String(p.len).padStart(5)}；归档成员 ${p.rows.length} 条；簇内 ${p.oldSum} → ${p.len}（省 ${p.oldSum - p.len}）${p.missing > 0 ? ` ⚠️ 缺 ${p.missing} 成员` : ''}`)
}
console.log(`\n合计：簇内原 ${gainOld} → 合并后 ${gainNew}（净省 ${gainOld - gainNew}）；主条改写 ${plan.length} 条；成员归档 ${plan.reduce((a, p) => a + p.rows.length, 0)} 条；不合格 ${bad}`)

if (!apply) {
  console.log('\n[dry-run] 未写库。加 --apply 执行。')
} else {
  if (plan.length === 0) throw new Error('没有可执行的簇，拒绝执行')
  const mainStmt = db.prepare(`UPDATE ${table} SET content = ?${has('keywords') ? ', keywords = ?' : ''}${has('project') ? ', project = ?' : ''}${has('importance') ? ', importance = ?' : ''} WHERE id = ?`)
  for (const p of plan) {
    undoJson.push({ id: p.e.mainId, content: p.main.content, keywords: p.main.keywords, project: p.main.project, importance: p.main.importance, status: p.main.status, members: p.rows.map((r) => r.id) })
    const args = [p.e.newContent]
    if (has('keywords')) args.push(p.e.keywords !== undefined ? JSON.stringify(p.e.keywords) : p.main.keywords)
    if (has('project')) args.push(p.e.project !== undefined ? p.e.project : p.main.project)
    if (has('importance')) args.push(p.e.importance !== undefined ? p.e.importance : p.main.importance)
    args.push(p.e.mainId)
    mainStmt.run(...args)
    for (const r of p.rows) undoIds.push(r.id)
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const undoMeta = `${OUT}/undo-merge-${table}-${stamp}.json`
  writeFileSync(undoMeta, JSON.stringify(undoJson, null, 1), 'utf8')
  if (undoIds.length > 0) {
    const list = undoIds.map((i) => `'${i}'`).join(',')
    appendFileSync(`${OUT}/undo-archive-${table}.sql`, `-- ${new Date().toISOString()} 合并归档 ${undoIds.length} 条\nUPDATE ${table} SET status='active' WHERE id IN (${list});\n`, 'utf8')
    db.exec(`UPDATE ${table} SET status='archived' WHERE id IN (${list})`)
  }
  const after = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${table} WHERE status='active'`).get()
  console.log(`\n[applied] ${table} active 现在 ${after.n} 条 / ${after.c} 字符`)
  console.log(`[undo] ${undoMeta}（主条旧正文）+ ${OUT}/undo-archive-${table}.sql（成员状态）`)
}
