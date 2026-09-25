/**
 * 合并产物的「关键词并集补强」：把被归档成员的关键词**补回主条**，避免合并后搜不到。
 *
 * 背景：需求要求把被合并成员的关键词并集保留，但「每条 8~13 个关键词」的准则
 *       与之结构性矛盾 ⇒ 只留 12 个时，实测子串口径覆盖仅 5%~50%（丢过 `fnOS` / `Tailscale` /
 *       `secure context` 这类**高区分度实体**）。
 *       keywords 字段**不参与首轮注入**（只作倒排匹配入口）⇒ 多留几个的注入成本≈0。
 *
 * 用法: node merge-keywords.mjs <merge-*.json> [--table fact] [--max 16] [--apply]
 * 幂等：重复跑不会重复添加（按小写去重）。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** undo 落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const val = (n, d = null) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const table = val('--table', 'fact')
const max = Number(val('--max', '16'))
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--table' && argv[i - 1] !== '--max' && argv[i - 1] !== '--exclude' && argv[i - 1] !== '--db')
if (files.length === 0) throw new Error('用法: node merge-keywords.mjs <merge-*.json> [--table fact] [--max 16] [--exclude "词1,词2"] [--apply]')

// ⚠️ 不能把「过程词 / 过时值」当检索入口：它们会把人引到已作废的信息上
//    （实测池里混进了 `ttl 900`——正文早已订正为 300——以及 `4738-2915 已修`、`No API key 已修`）
const BAD = /已修|已闭环|已过期|已下架|已确认|订正|旧值/
const excludeSet = new Set(String(val('--exclude', '')).split(',').map((s) => s.trim()).filter(Boolean))

// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const db = new DatabaseSync(val('--db', process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')))
const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }
const get = (id) => db.prepare(`SELECT id, keywords, status FROM ${table} WHERE id = ?`).get(id)
// 优先补「含数字/英文」的具体实体（这类词最可能是用户 prompt 里的字面命中点）
const score = (k) => (/[0-9]/.test(k) ? 2 : 0) + (/[A-Za-z]/.test(k) ? 1 : 0) + (k.length >= 4 ? 0.5 : 0)

const todo = []
let same = 0, miss = 0
for (const f of files) {
  if (!existsSync(f)) { console.log(`[缺文件] ${f}`); continue }
  for (const e of JSON.parse(readFileSync(f, 'utf8'))) {
    const main = get(e.mainId)
    if (main === undefined) { miss++; console.log(`[主条未找到] ${e.cluster} ${e.mainId}`); continue }
    const cur = parse(main.keywords)
    const curLower = new Set(cur.map((k) => String(k).toLowerCase()))
    const pool = new Map()
    for (const m of e.members ?? []) {
      const r = get(m)
      if (r === undefined) continue
      for (const k of parse(r.keywords)) {
        const s = String(k)
        if (curLower.has(s.toLowerCase())) continue
        if (BAD.test(s) || excludeSet.has(s)) continue
        pool.set(s, score(s))
      }
    }
    if (pool.size === 0) { same++; console.log(`${String(e.cluster).padEnd(7)} 无新增（已覆盖）`); continue }
    const add = [...pool.entries()]
      .filter(([, s]) => s > 0) // 只补"具体"的词，纯中文泛词如「远程连接」跳过
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .slice(0, Math.max(0, max - cur.length))
    if (add.length === 0) { same++; console.log(`${String(e.cluster).padEnd(7)} 无高价值可补（当前 ${cur.length}，池 ${pool.size}）`); continue }
    todo.push({ cluster: e.cluster, id: main.id, old: cur, next: [...cur, ...add] })
    console.log(`${String(e.cluster).padEnd(7)} ${String(cur.length).padStart(2)} → ${String(cur.length + add.length).padStart(2)}  +${add.join(' / ')}`)
  }
}

console.log(`\n待补 ${todo.length} 簇；无变化 ${same}；主条未找到 ${miss}；上限 ${max}`)
if (!apply) console.log('[dry-run] 未写库。加 --apply 执行。')
else {
  if (todo.length === 0) throw new Error('没有可补的簇，拒绝执行')
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const undoPath = `${OUT}/undo-keywords-${table}-${stamp}.json`
  writeFileSync(undoPath, JSON.stringify(todo.map((t) => ({ id: t.id, keywords: JSON.stringify(t.old) })), null, 1), 'utf8')
  const stmt = db.prepare(`UPDATE ${table} SET keywords = ? WHERE id = ?`)
  for (const t of todo) stmt.run(JSON.stringify(t.next), t.id)
  console.log(`[applied] ${todo.length} 簇关键词已补强`)
  console.log(`[undo] ${undoPath}（旧 keywords，可写脚本还原）`)
}
