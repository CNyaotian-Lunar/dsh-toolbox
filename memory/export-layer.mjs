/**
 * 导出某一层（或全部）记忆为 Markdown 清单，便于逐条判决（保留 / 搬家 / 合并 / 归档）。
 * 用法: node export-layer.mjs <层名|all> [输出 md]
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 生成物默认落到仓库的 out\ 目录（已在 .gitignore 里）；可用 DSH_TOOLBOX_OUT 覆盖 */
const OUTDIR = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')

const which = process.argv[2] ?? 'user'
const outPath = process.argv[3] ?? join(OUTDIR, `layer-${which}.md`)
// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const LEVELS = which === 'all' ? ['user', 'rules', 'project', 'fact', 'lesson', 'topic'] : [which]

const fmt = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 16).replace('T', ' ') : '')
const lines = []
let total = 0, chars = 0
for (const level of LEVELS) {
  const cols = db.prepare(`PRAGMA table_info(${level})`).all().map((c) => c.name)
  const orderBy = cols.includes('project') ? 'ORDER BY project, updated_at DESC' : 'ORDER BY updated_at DESC'
  const rows = db.prepare(`SELECT * FROM ${level} WHERE status='active' ${orderBy}`).all()
  lines.push(`\n## ${level}（active ${rows.length} 条）\n`)
  for (const r of rows) {
    total++
    chars += String(r.content ?? '').length
    const proj = cols.includes('project') ? (r.project || '全局') : '（user 层无 project 列）'
    const sub = cols.includes('subcategory') && r.subcategory ? ' · ' + r.subcategory : ''
    lines.push(`### ${r.id}  \`${proj}\`${sub} · 重要性 ${r.importance} · ${fmt(r.updated_at)} · ${String(r.content ?? '').length} 字`)
    lines.push('')
    lines.push(String(r.content ?? ''))
    lines.push('')
    lines.push(`关键词：${r.keywords ?? ''}`)
    lines.push('')
  }
}
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`导出 ${total} 条 / ${chars} 字符 → ${outPath}`)
