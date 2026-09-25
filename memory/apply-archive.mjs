/**
 * 批量归档器：把一批 lesson id 标 archived（只改 status，不删数据），可 dry-run、可回滚。
 *
 * 用法:
 *   node apply-archive.mjs --file <ids.txt> [--apply]
 *   node apply-archive.mjs --cluster C1 [--apply]      # 从 lesson-clusters.md 解析该簇的 ids
 *   node apply-archive.mjs --list C1 C2 C3 [--apply]
 *
 * ids.txt 每行一个 id，允许 `L005=0mtwvsyd2-...` 或纯 id 或 `# 注释`；短号 L### 走 lesson-map.json 还原。
 * 已 archived 的自动跳过（并发执行下必须核对），并把跳过原因打印出来。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 报告 / 短号映射 / undo 的目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const REPORT = `${OUT}/lesson-clusters.md`
const MAP = `${OUT}/lesson-map.json`
const UNDO = `${OUT}/undo-lesson-archive.sql`

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const fileArg = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null
const shortArg = argv.includes('--list') ? argv[argv.indexOf('--list') + 1] : null
const clusterArg = argv.includes('--cluster') ? argv[argv.indexOf('--cluster') + 1] : null

/** 短号 L001 → 完整 id（lesson-map.json 的键格式自己适配） */
function loadMap() {
  if (!existsSync(MAP)) return new Map()
  const raw = JSON.parse(readFileSync(MAP, 'utf8'))
  const map = new Map()
  const walk = (obj) => {
    if (obj === null || typeof obj !== 'object') return
    for (const [k, v] of Object.entries(obj)) {
      if (/^L\d+$/.test(k) && typeof v === 'string') map.set(k, v)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(raw)
  return map
}

const shortToId = loadMap()

/** 从报告里解析某个簇的 ids（形如 `- **ids（5 条）**：L005=xxx, L145=yyy, ...`） */
function idsFromCluster(name) {
  const text = readFileSync(REPORT, 'utf8')
  // 簇标题有两种写法：`#### C12. …` 与 `#### (次要) C31. …`；块以「下一个 #### / ### / ## 标题」为界。
  const re = new RegExp(`####\\s*(?:\\(次要\\)\\s*)?${name}\\.([\\s\\S]*?)(?=\\n####\\s|\\n###\\s|\\n##\\s|$)`)
  const block = text.match(re)
  if (block === null) throw new Error(`报告里找不到簇 ${name}`)
  // ids 行形如：`- **ids（3 条）**：L560=`id1`、L570=`id2`` —— 直接在整个簇块里抓 `L###=<id>` 对，
  // 不按行定位（ids 行里还有中文顿号与反引号，按行切容易抓空）。块里其它 `... = \`id\`` 前面没有 L###，不会误抓。
  const ids = [...block[1].matchAll(/(L\d+)\s*=\s*`?([0-9a-z-]{8,60})`?/g)].map((m) => m[2])
  if (ids.length === 0) throw new Error(`簇 ${name} 解析出 0 个 id`)
  return ids
}

let ids = []
if (fileArg !== null) {
  for (const line of readFileSync(fileArg, 'utf8').split('\n')) {
    const s = line.trim()
    if (s === '' || s.startsWith('#')) continue
    const m = s.match(/(L\d+)\s*=\s*([0-9a-z-]{8,40})/) ?? s.match(/^([0-9a-z-]{8,40})$/)
    if (m === null) { console.log(`  [跳过-格式] ${s}`); continue }
    const raw = m.length === 3 ? m[2] : m[1]
    if (/^L\d+$/.test(raw)) { const full = shortToId.get(raw); if (full !== undefined) ids.push(full); else console.log(`  [跳过-短号无映射] ${raw}`) }
    else ids.push(raw)
  }
} else if (shortArg !== null) {
  const names = shortArg.split(',').map((s) => s.trim()).filter(Boolean)
  for (const n of names) {
    // 只给了簇名列表（`--cluster C1` 取下一个参数，`--list C1,C2` 取逗号串）
    ids.push(...idsFromCluster(n))
  }
} else if (clusterArg !== null) {
  for (const n of clusterArg.split(',').map((s) => s.trim()).filter(Boolean)) ids.push(...idsFromCluster(n))
} else {
  throw new Error('必须给 --file / --cluster / --list 之一')
}

ids = [...new Set(ids)]

// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbArg = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : null
const dbPath = dbArg ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath)
const q = (id) => db.prepare('SELECT id, status, LENGTH(content) AS n, substr(content,1,50) AS s FROM lesson WHERE id = ?').get(id)

const toArchive = []
let alreadyArchived = 0
let notFound = 0
let chars = 0
for (const id of ids) {
  const row = q(id)
  if (row === undefined) { notFound++; console.log(`  [未找到] ${id}`); continue }
  if (row.status !== 'active') { alreadyArchived++; continue }
  chars += row.n
  toArchive.push(row)
  console.log(`  [将归档] ${row.id.slice(0, 18)} ${String(row.n).padStart(4)}字 ${String(row.s).replace(/\s+/g, ' ')}`)
}

console.log(`\n请求 ${ids.length} 条：将归档 ${toArchive.length}（${chars} 字符） / 已归档跳过 ${alreadyArchived} / 未找到 ${notFound}`)

if (!apply) {
  console.log('[dry-run] 未写库。加 --apply 执行。')
} else {
  if (toArchive.length === 0) { console.log('[apply] 没有可归档的条目，什么也不做。') } else {
    const list = toArchive.map((r) => `'${r.id}'`).join(',')
    appendFileSync(UNDO, `-- ${new Date().toISOString()} 归档 ${toArchive.length} 条\nUPDATE lesson SET status='active' WHERE id IN (${list});\n`, 'utf8')
    db.exec(`UPDATE lesson SET status='archived' WHERE id IN (${list})`)
    const after = db.prepare("SELECT COUNT(*) AS n, SUM(LENGTH(content)) AS c FROM lesson WHERE status='active'").get()
    console.log(`[applied] lesson active 现在 ${after.n} 条 / ${after.c} 字符`)
    console.log(`[undo] 已追加到 ${UNDO}`)
  }
}
