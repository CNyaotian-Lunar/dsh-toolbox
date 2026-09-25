/**
 * 「每轮固定注入」总账：把 **AGENTS.md 瘦身前 ↔ 现在** 与 **记忆库整理前 ↔ 现在** 放在一起算 token。
 *
 * 为什么要一起算：每次开新会话固定要付两笔 ——
 *   ① 两份 AGENTS.md（全局 + 工作区，共享 64 KB 预算）② 记忆库首轮注入（user 层 + 全局 rules）。
 * 只看其中一笔会低估"瘦身"的效果。
 *
 * 用法: node token-account.mjs [--agents-before <旧版 AGENTS.md>] [--db-before <旧备份库>]
 * 基线没有通用默认值：不传就只统计"现在"这一侧，基线列显示为「未提供」。
 */
import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 报告落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUTDIR = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')

const val = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
// 基线（"瘦身前"）文件：`--agents-before` / `--db-before`，或环境变量 DSH_AGENTS_BEFORE / DSH_DB_BEFORE
const AGENTS_BEFORE = val('--agents-before', process.env.DSH_AGENTS_BEFORE ?? '')
const DB_BEFORE = val('--db-before', process.env.DSH_DB_BEFORE ?? '')
const AGENTS_NOW = [process.env.DSH_WORKSPACE_AGENTS ?? '<工作区>/AGENTS.md', process.env.DSH_HOME_AGENTS ?? join(homedir(), '.dsh', 'AGENTS.md')]
// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const DB_NOW = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')

const chars = (p) => (typeof p === 'string' && p !== '' && existsSync(p) ? readFileSync(p, 'utf8').length : null)
const bytes = (p) => (typeof p === 'string' && p !== '' && existsSync(p) ? readFileSync(p).length : null)
const tok = (c) => Math.round(c * 0.75) // 中文粗估：1 字符 ≈ 0.75 token（与其它报告同口径）
const NONE = '（未提供）'

// ── AGENTS.md ──
const nowChars = AGENTS_NOW.reduce((a, p) => a + (chars(p) ?? 0), 0)
const beforeChars = chars(AGENTS_BEFORE)
if (beforeChars === null) console.error('⚠️ 未提供「瘦身前」的 AGENTS.md 基线 —— 基线列会显示「未提供」，可用 --agents-before 补。')

// ── 记忆库「固定注入」= user 层 active + 全局 rules（project='全局' 且 importance≥2） ──
function fixedInjection(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const u = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM user WHERE status='active'").get()
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS c FROM rules WHERE status='active' AND project='全局' AND importance >= 2").get()
  db.close()
  return { user: u, rules: r, chars: u.c + r.c }
}
// 基线缺省时**不碰库**：空路径会开出一个空库，查表直接报 `no such table: user`
const memBefore = DB_BEFORE !== '' ? fixedInjection(DB_BEFORE) : null
if (memBefore === null) console.error('⚠️ 未提供「整理前」的记忆库基线 —— 基线列会显示「未提供」，可用 --db-before 补。')
let memNow
try {
  memNow = fixedInjection(DB_NOW)
} catch (e) {
  console.error(`⚠️ 打不开「现在」的记忆库：${DB_NOW}\n   ${e.message}\n   可用 DSH_MEMORY_DB 指向库文件，或把 DSH_WORKSPACE 指到工作区。`)
  process.exit(2)
}

const fmtCount = (m, k) => (m === null ? NONE : `${m[k].n} 条 / ${m[k].c} 字符`)
const fmtTotal = (m) => (m === null ? `**${NONE}**` : `**${m.chars} 字符 ≈ ${tok(m.chars)} token**`)
const fmtSave = (b, n) => (b === null ? '—' : `−${b - n}`)

const md = []
const L = (s = '') => { console.log(s); md.push(s) }
L(`# 每轮固定开销 · 总账（AGENTS.md + 记忆库首轮注入）`)
L(``)
L(`> 采样：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`)
L(`> token 口径：**字符 × 0.75**（中文粗估，与其它报告一致；不是分词器真值，但前后同口径可比）`)
L(`> AGENTS.md 基线：${beforeChars === null ? NONE : `\`${AGENTS_BEFORE}\`（${bytes(AGENTS_BEFORE)} B，瘦身前）`}`)
L(`> 记忆库基线：${memBefore === null ? NONE : `\`${basename(DB_BEFORE)}\``}`)
L(``)
L(`## 一、两份 AGENTS.md（每轮注入，共享 64 KB 预算）`)
L(``)
L(`| 项目 | 瘦身前 | 现在 | 省下 |`)
L(`|---|---|---|---|`)
const agentsBeforeCell = beforeChars === null ? NONE : `${bytes(AGENTS_BEFORE)} B（${beforeChars} 字符）`
L(`| 工作区 \`AGENTS.md\` | ${agentsBeforeCell} | ${bytes(AGENTS_NOW[0]) ?? '?'} B（${chars(AGENTS_NOW[0]) ?? '?'} 字符） | ${beforeChars === null ? '—' : `−${bytes(AGENTS_BEFORE) - (bytes(AGENTS_NOW[0]) ?? 0)} B`} |`)
L(`| 全局 \`~/.dsh/AGENTS.md\` | （基线文件只含工作区版，见下注） | ${bytes(AGENTS_NOW[1]) ?? '?'} B（${chars(AGENTS_NOW[1]) ?? '?'} 字符） | — |`)
const agentsSave = beforeChars === null ? null : beforeChars - nowChars
L(`| **合计（字符口径）** | **${beforeChars ?? NONE}** | **${nowChars}** | **${agentsSave === null ? '—' : `−${agentsSave}`}** |`)
L(`| 估算 token | ${beforeChars === null ? '—' : `≈ ${tok(beforeChars)}`} | ≈ ${tok(nowChars)} | **${agentsSave === null ? '—' : `≈ −${tok(agentsSave)}`}** |`)
L(``)
L(`> 注：\`bak-slim-*\` 那一版是**工作区版**；全局版当时体积未留快照，故上表"现在"含全局版、基线只含工作区版 ⇒`)
L(`> **AGENTS.md 的真实降幅比上表更大**（现在这一行把全局版也算进来了，属于"保守计算"）。`)
L(``)
L(`## 二、记忆库首轮注入（user 层 + 全局 rules）`)
L(``)
L(`| 项目 | 整理前 | 现在 | 省下 |`)
L(`|---|---|---|---|`)
L(`| user 层 | ${fmtCount(memBefore, 'user')} | ${fmtCount(memNow, 'user')} | ${fmtSave(memBefore?.user.c ?? null, memNow.user.c)} |`)
L(`| 全局 rules | ${fmtCount(memBefore, 'rules')} | ${fmtCount(memNow, 'rules')} | ${fmtSave(memBefore?.rules.c ?? null, memNow.rules.c)} |`)
L(`| **合计** | ${fmtTotal(memBefore)} | ${fmtTotal(memNow)} | ${memBefore === null ? '—' : `**≈ −${tok(memBefore.chars - memNow.chars)} token**`} |`)
L(``)
L(`## 三、总账`)
L(``)
// 两块里缺任何一块，就没法给"瘦身前"的总数 ⇒ 显示「—」而不是算出个假数
const totalBefore = (beforeChars === null || memBefore === null) ? null : beforeChars + memBefore.chars
const totalNow = nowChars + memNow.chars
const pct = totalBefore === null ? null : `${((1 - totalNow / totalBefore) * 100).toFixed(1)}%`
L(`| | 瘦身前 | 现在 | 省下 | 降幅 |`)
L(`|---|---|---|---|---|`)
L(`| 每轮固定注入（字符） | ${totalBefore ?? '—'} | ${totalNow} | ${totalBefore === null ? '—' : `**−${totalBefore - totalNow}**`} | ${pct === null ? '—' : `**${pct}**`} |`)
L(`| 每轮固定注入（≈token） | ${totalBefore === null ? '—' : `≈ ${tok(totalBefore)}`} | ≈ ${tok(totalNow)} | ${totalBefore === null ? '—' : `**≈ −${tok(totalBefore - totalNow)}**`} | ${pct === null ? '—' : `**${pct}**`} |`)
L(``)
L(`> ⚠️ 这笔账只算「**每轮固定注入**」。整库的可检索信息**没有减少** —— AGENTS.md 的细则搬进了`)
L(`> 按需才读的手册文件，记忆库的细节搬进了可全文检索的归档目录`)
L(`> ⇒ 省的是"每次都付的钱"，不是"信息本身"。`)

const outPath = join(OUTDIR, 'token-account.md')
const { writeFileSync } = await import('node:fs')
writeFileSync(outPath, md.join('\n') + '\n', 'utf8')
console.log(`\n→ ${outPath}`)
