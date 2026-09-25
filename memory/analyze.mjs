/**
 * 记忆库体检：层分布 / 注入成本 / 重复簇 / 超长 / 关键词缺失 / 访问记录 / 时间分布。
 * 只读，不改库。用法: node analyze.mjs [memory.db]
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 生成物默认落到仓库的 out\ 目录（已在 .gitignore 里）；可用 DSH_TOOLBOX_OUT 覆盖 */
const OUTDIR = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')

// 记忆库路径：位置参数 > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.argv[2] ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const outJson = join(OUTDIR, 'analyze.json')
const db = new DatabaseSync(dbPath, { readOnly: true })
const LEVELS = ['user', 'rules', 'project', 'fact', 'lesson', 'topic', 'soul']

const items = []
for (const level of LEVELS) {
  for (const r of db.prepare(`SELECT * FROM ${level}`).all()) {
    items.push({
      level,
      id: r.id,
      project: r.project ?? '',
      sub: r.subcategory ?? '',
      status: r.status ?? 'active',
      importance: r.importance ?? 0,
      title: r.title ?? '',
      content: r.content ?? '',
      keywords: r.keywords ?? '',
      created: Number(r.created_at ?? 0),
      updated: Number(r.updated_at ?? 0),
      accessed: r.last_accessed_at === null || r.last_accessed_at === undefined ? null : Number(r.last_accessed_at),
    })
  }
}

const line = (s = '') => console.log(s)
const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`
const tokens = (chars) => Math.round(chars * 0.75) // 中文粗估：1 字符 ≈ 0.75 token

line(`库：${dbPath}`)
line(`总行数 ${items.length}\n`)

// ── 1. 层分布 + 注入成本 ──
line('=== 1. 层分布与体积 ===')
line('层        active  其它   总字符  平均  最长  >300字  估算token(active)')
for (const level of LEVELS) {
  const all = items.filter((i) => i.level === level)
  if (all.length === 0) continue
  const act = all.filter((i) => i.status === 'active')
  const chars = act.reduce((a, i) => a + i.content.length, 0)
  const max = act.reduce((a, i) => Math.max(a, i.content.length), 0)
  const long = act.filter((i) => i.content.length > 300).length
  line(`${level.padEnd(8)} ${String(act.length).padStart(5)}  ${String(all.length - act.length).padStart(5)}  ${String(chars).padStart(7)}  ${String(Math.round(chars / Math.max(1, act.length))).padStart(5)}  ${String(max).padStart(5)}  ${String(long).padStart(6)}  ${String(tokens(chars)).padStart(8)}`)
}
const userChars = items.filter((i) => i.level === 'user' && i.status === 'active').reduce((a, i) => a + i.content.length, 0)
line(`\n⚠️ user 层**每会话固定注入**：${items.filter((i) => i.level === 'user' && i.status === 'active').length} 条 / ${userChars} 字符 ≈ **${tokens(userChars)} token**（每次开新会话就先付这笔）`)

// ── 2. 状态与时间 ──
line('\n=== 2. 状态分布 ===')
for (const level of LEVELS) {
  const all = items.filter((i) => i.level === level)
  if (all.length === 0) continue
  const g = {}
  for (const i of all) g[i.status] = (g[i.status] ?? 0) + 1
  line(`${level.padEnd(8)} ${JSON.stringify(g)}`)
}
line('\n=== 3. 创建时间分布（按天，active 条数 top 15） ===')
const byDay = new Map()
for (const i of items) {
  if (i.status !== 'active' || !i.created) continue
  const d = new Date(i.created).toISOString().slice(0, 10)
  byDay.set(d, (byDay.get(d) ?? 0) + 1)
}
for (const [d, n] of [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) line(`  ${d}  ${String(n).padStart(4)}`)

// ── 4. 关键词 / 访问记录 ──
line('\n=== 4. 关键词与访问记录 ===')
const kwCount = (k) => { try { const a = JSON.parse(k); return Array.isArray(a) ? a.length : 0 } catch { return k ? k.split(/[,，、\s]+/).filter(Boolean).length : 0 } }
for (const level of LEVELS) {
  const act = items.filter((i) => i.level === level && i.status === 'active')
  if (act.length === 0) continue
  const noKw = act.filter((i) => kwCount(i.keywords) === 0).length
  const fewKw = act.filter((i) => kwCount(i.keywords) > 0 && kwCount(i.keywords) < 5).length
  const never = act.filter((i) => i.accessed === null).length
  line(`${level.padEnd(8)} 关键词=0: ${String(noKw).padStart(4)}  <5个: ${String(fewKw).padStart(4)}  从未被访问: ${String(never).padStart(4)} / ${act.length}`)
}

// ── 5. 重复簇（同层内 bigram 余弦） ──
function bigrams(s) {
  const t = s.replace(/[\s`*|#>-]+/g, '')
  const set = new Set()
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}
line('\n=== 5. 重复簇（同层内相似度 ≥ 0.62，忽略超高频 bigram） ===')
const clustersAll = []
for (const level of ['user', 'rules', 'project', 'fact', 'lesson', 'topic']) {
  const act = items.filter((i) => i.level === level && i.status === 'active')
  if (act.length < 2) continue
  const grams = act.map((i) => bigrams(i.content))
  const df = new Map()
  for (const g of grams) for (const x of g) df.set(x, (df.get(x) ?? 0) + 1)
  const cut = Math.max(3, act.length * 0.25)
  const filtered = grams.map((g) => new Set([...g].filter((x) => (df.get(x) ?? 0) <= cut)))
  const parent = act.map((_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra }
  let pairs = 0
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const A = filtered[i], B = filtered[j]
      if (A.size === 0 || B.size === 0) continue
      const small = A.size < B.size ? A : B
      if (small.size / Math.max(A.size, B.size) < 0.45) continue
      let inter = 0
      for (const g of A) if (B.has(g)) inter++
      const cos = inter / Math.sqrt(A.size * B.size)
      if (cos >= 0.62) { union(i, j); pairs++ }
    }
  }
  const groups = new Map()
  act.forEach((it, i) => { const r = find(i); const arr = groups.get(r) ?? []; arr.push(it); groups.set(r, arr) })
  for (const arr of groups.values()) if (arr.length > 1) clustersAll.push({ level, items: arr })
}
clustersAll.sort((a, b) => b.items.length - a.items.length)
line(`共 ${clustersAll.length} 个重复簇，涉及 ${clustersAll.reduce((a, c) => a + c.items.length, 0)} 条`)
for (const c of clustersAll.slice(0, 12)) {
  line(`\n[${c.level}] ${c.items.length} 条`)
  for (const it of c.items.slice(0, 6)) line(`   ${it.id.slice(0, 14)} ${it.project ? '@' + it.project + ' ' : ''}${it.content.replace(/\s+/g, ' ').slice(0, 70)}`)
  if (c.items.length > 6) line(`   …还有 ${c.items.length - 6} 条`)
}

// ── 6. 超长条目 ──
line('\n=== 6. 超长条目（topic 允许 300 字，其余 >400 字即偏长） ===')
const longOnes = items.filter((i) => i.status === 'active' && i.content.length > (i.level === 'topic' ? 400 : 400)).sort((a, b) => b.content.length - a.content.length)
line(`合计 ${longOnes.length} 条`)
for (const i of longOnes.slice(0, 10)) line(`  ${String(i.content.length).padStart(5)} 字 [${i.level}] ${i.project}  ${i.content.replace(/\s+/g, ' ').slice(0, 60)}`)

// ── 7. project todo 子类 ──
line('\n=== 7. project 的 todo 子类（可能是已完成但没下架的） ===')
for (const r of db.prepare("SELECT project, status, COUNT(*) n FROM project WHERE subcategory='todo' GROUP BY project, status ORDER BY n DESC").all()) {
  line(`  ${String(r.n).padStart(3)}  ${r.status}  ${r.project}`)
}

writeFileSync(outJson, JSON.stringify({ items: items.map((i) => ({ ...i, content: i.content.slice(0, 4000) })), clusters: clustersAll.map((c) => ({ level: c.level, ids: c.items.map((i) => i.id) })) }, null, 1))
line(`\n明细 JSON → ${outJson}`)
