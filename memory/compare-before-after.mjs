/**
 * 整理前后体检对比：读「整理前备份库」与「当前活库」，逐层对比条数 / 字符 / 估算 token。
 * 用法: node compare-before-after.mjs [备份库] [当前库]
 * 输出: 控制台表格 + out\compare-before-after.md
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 报告落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUTDIR = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')

// 整理前的备份库没有通用默认值 ⇒ 用位置参数或环境变量 DSH_DB_BEFORE 传；当前库有默认。
const beforePath = process.argv[2] ?? process.env.DSH_DB_BEFORE
const afterPath = process.argv[3] ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
if (!beforePath) {
  console.error('用法: node compare-before-after.mjs <整理前的备份库> [当前库]\n' +
    '  也可以用环境变量 DSH_DB_BEFORE 指定整理前的备份库路径。')
  process.exit(2)
}
const OUT = join(OUTDIR, 'compare-before-after.md')
const LEVELS = ['user', 'rules', 'project', 'fact', 'lesson', 'topic', 'soul']
const tok = (c) => Math.round(c * 0.75)

function snapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  const out = {}
  for (const level of LEVELS) {
    const all = db.prepare(`SELECT COUNT(*) AS n FROM ${level}`).get().n
    const act = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM ${level} WHERE status='active'`).get()
    const arc = db.prepare(`SELECT COUNT(*) AS n FROM ${level} WHERE status='archived'`).get().n
    const st = db.prepare(`SELECT COUNT(*) AS n FROM ${level} WHERE status='stale'`).get().n
    out[level] = { all, active: act.n, chars: act.c, archived: arc, stale: st }
  }
  db.close()
  return out
}

const before = snapshot(beforePath)
const after = snapshot(afterPath)
const at = new Date().toISOString().replace('T', ' ').slice(0, 19)

const rows = []
let sumB = { n: 0, c: 0 }
let sumA = { n: 0, c: 0 }
for (const level of LEVELS) {
  const b = before[level]
  const a = after[level]
  sumB.n += b.active; sumB.c += b.chars
  sumA.n += a.active; sumA.c += a.chars
  rows.push({ level, b, a })
}

const line = (s) => { console.log(s); md.push(s) }
const md = []
line(`# 记忆库整理 · 前后对比`)
line(``)
line(`- 整理前快照：\`${beforePath}\``)
line(`- 整理后活库：\`${afterPath}\``)
line(`- 采样时刻：${at}`)
line(`- 字符→token 估算：1 字符 ≈ 0.75 token（中文粗估）`)
line(``)
line(`| 层 | 前·active | 后·active | 变化 | 前·字符 | 后·字符 | 省下字符 | 前≈token | 后≈token | 省下token |`)
line(`|---|---|---|---|---|---|---|---|---|---|`)
for (const { level, b, a } of rows) {
  if (b.all === 0 && a.all === 0) continue
  const dn = a.active - b.active
  const dc = a.chars - b.chars
  line(`| ${level} | ${b.active} | ${a.active} | ${dn > 0 ? '+' : ''}${dn} | ${b.chars} | ${a.chars} | ${-dc} | ${tok(b.chars)} | ${tok(a.chars)} | ${-tok(dc)} |`)
}
line(`| **合计** | **${sumB.n}** | **${sumA.n}** | **${sumA.n - sumB.n}** | **${sumB.c}** | **${sumA.c}** | **${sumB.c - sumA.c}** | **${tok(sumB.c)}** | **${tok(sumA.c)}** | **${tok(sumB.c - sumA.c)}** |`)
line(``)
line(`> 固定开销（每会话必注入）= user 层 + 全局 rules 层（project='全局' 且 importance≥2）。`)
const dbA = new DatabaseSync(afterPath, { readOnly: true })
const dbB = new DatabaseSync(beforePath, { readOnly: true })
const globRules = (db) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM rules WHERE status='active' AND project='全局'`).get()
const grB = globRules(dbB)
const grA = globRules(dbA)
line(``)
line(`| 固定开销 | 前 | 后 | 省下 |`)
line(`|---|---|---|---|`)
line(`| user 层 | ${before.user.active} 条 / ${before.user.chars} 字符 ≈ ${tok(before.user.chars)} token | ${after.user.active} 条 / ${after.user.chars} 字符 ≈ ${tok(after.user.chars)} token | **${tok(before.user.chars - after.user.chars)} token** |`)
line(`| rules 全局条 | ${grB.n} 条 / ${grB.c} 字符 ≈ ${tok(grB.c)} token | ${grA.n} 条 / ${grA.c} 字符 ≈ ${tok(grA.c)} token | **${tok(grB.c - grA.c)} token** |`)
line(`| **固定开销合计** | ≈ ${tok(before.user.chars + grB.c)} token | ≈ ${tok(after.user.chars + grA.c)} token | **省 ${tok(before.user.chars + grB.c - after.user.chars - grA.c)} token / 会话** |`)

writeFileSync(OUT, md.join('\n') + '\n', 'utf8')
console.log(`\n→ ${OUT}`)
