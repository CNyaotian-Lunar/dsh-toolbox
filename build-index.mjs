/**
 * 工具箱「索引生成器」：扫描 dsh-toolbox 下所有脚本，抽出顶部注释里的「干什么 / 用法」，
 * 生成两份索引：`INDEX.md`（人看）与 `index.json`（机器读，AI 可直接查）。
 *
 * 用法: node build-index.mjs
 * 约定：每个脚本的顶部块注释里最好包含
 *   - 第一段：这个脚本**解决什么问题**（一行）
 *   - `用法:` 或 `用法：` 后跟命令行
 *   - 可选 `@tags 标签1 标签2`（不写就按目录归类）
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, extname, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根 = 本脚本所在目录（不写死盘符，拷到任何目录都能跑）
const ROOT = dirname(fileURLToPath(import.meta.url))
// `analysis/` = 本地分析工作台（已在 .gitignore 排除、不随仓库发布）
// ⇒ 一并跳过，免得索引里出现「仓库里根本没有」的脚本条目。
const SKIP = new Set(['node_modules', 'out', '.git', 'analysis', '__pycache__'])
const EXTS = new Set(['.mjs', '.js', '.ps1', '.py', '.cmd', '.sh'])
const GROUP_LABEL = { session: '读 / 分析 dsh 会话日志', memory: '记忆库（memory.db）', render: 'SVG 渲染与拼版（需 sharp）', tools: '其它工具' }

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), out); continue }
    if (EXTS.has(extname(e.name).toLowerCase())) out.push(join(dir, e.name))
  }
  return out
}

/** 从文件顶部注释里抽 描述 / 用法 / tags */
function parse(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8').slice(0, 4000) } catch { return null }
  const lines = text.split('\n').slice(0, 60)
  // 描述：第一段非空注释行（去掉 /**, *, */ 与 "xxx.mjs —" 前缀）
  let desc = ''
  for (const raw of lines) {
    const s = raw.replace(/^\s*\/?\*+\s?/, '').replace(/\*\/\s*$/, '').trim()
    if (s === '' || s.startsWith('用法') || s.startsWith('@tags')) continue
    if (/^[\w.-]+\.(mjs|js|ps1|py|cmd|sh)\s*[—:-]/.test(s)) { desc = s.replace(/^[\w.-]+\.(mjs|js|ps1|py|cmd|sh)\s*[—:-]\s*/, ''); break }
    if (/^[=＝#]/.test(s)) continue
    desc = s
    break
  }
  const usage = (text.match(/用法[:：]\s*(.+)/) ?? [])[1]
    ?.replace(/^\s*(?:\*|\/\/)+\s?/, '')
    .replace(/\s*(?:\*\/|\/\/)\s*$/, '')
    .trim() ?? ''
  const tags = ((text.match(/@tags\s+(.+)/) ?? [])[1] ?? '').trim().split(/[\s,，]+/).filter(Boolean)
  return { desc: desc.slice(0, 120), usage: usage.slice(0, 200), tags }
}

const files = walk(ROOT).sort()
const rows = []
for (const f of files) {
  const p = parse(f)
  if (p === null) continue
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  // 分组：`memory\analysis\x.mjs` → `memory/analysis`；`memory\x.mjs` → `memory`；根下 → `tools`
  const parts = rel.split('/')
  const group = parts.length > 2 ? parts.slice(0, 2).join('/') : (parts.length === 2 ? parts[0] : 'tools')
  const size = statSync(f).size
  rows.push({ path: rel, group, ...p, sizeKB: Math.round(size / 1024), mtime: statSync(f).mtime.toISOString().slice(0, 10) })
}

const byGroup = new Map()
for (const r of rows) { const a = byGroup.get(r.group) ?? []; a.push(r); byGroup.set(r.group, a) }

const md = []
const L = (s = '') => md.push(s)
L(`# 工具箱索引（自动生成，勿手改）`)
L(``)
L(`> 由 \`node build-index.mjs\` 扫 \`dsh-toolbox\` 下所有脚本生成 —— **加了新脚本重跑一次就有了**。`)
L(`> 生成时刻：${new Date().toISOString().replace('T', ' ').slice(0, 19)} · 共 **${rows.length}** 个脚本`)
L(``)
L(`## 速查：我要干什么 → 用哪个`)
L(``)
L(`| 想干的事 | 脚本 | 用法 |`)
L(`|---|---|---|`)
for (const r of rows.filter((x) => x.usage !== '')) L(`| ${r.desc || r.path} | \`${r.path}\` | \`${r.usage.replace(/`/g, '')}\` |`)
L(``)
for (const [g, arr] of byGroup) {
  L(`## ${g}\\ —— ${GROUP_LABEL[g] ?? ''}`)
  L(``)
  for (const r of arr.sort((a, b) => a.path.localeCompare(b.path))) {
    L(`### \`${r.path}\`  <sub>${r.sizeKB}KB · ${r.mtime}</sub>`)
    L(``)
    L(`- **干什么**：${r.desc || '（顶部注释里没写描述，建议补一句）'}`)
    if (r.usage) L(`- **怎么用**：\`${r.usage.replace(/`/g, '')}\``)
    if (r.tags.length) L(`- **标签**：${r.tags.join(' / ')}`)
    L(``)
  }
}
writeFileSync(join(ROOT, 'INDEX.md'), md.join('\n') + '\n', 'utf8')
writeFileSync(join(ROOT, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, tools: rows }, null, 1), 'utf8')

const noDesc = rows.filter((r) => r.desc === '').length
const noUsage = rows.filter((r) => r.usage === '').length
console.log(`索引已生成：${rows.length} 个脚本 → INDEX.md / index.json`)
console.log(`缺描述的 ${noDesc} 个；缺用法的 ${noUsage} 个`)
for (const [g, arr] of byGroup) console.log(`  ${g}: ${arr.length}`)
