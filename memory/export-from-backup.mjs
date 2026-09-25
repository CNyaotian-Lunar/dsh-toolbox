/** 从备份库导出某层全文到 md（用于补齐"整理前"快照）。
 * 用法: node export-from-backup.mjs <备份db> <层名> <输出md> [--all-status] */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'

const [dbPath, level, outPath] = process.argv.slice(2)
const allStatus = process.argv.includes('--all-status')
const db = new DatabaseSync(dbPath, { readOnly: true })
const where = allStatus ? '' : "WHERE status='active'"
const rows = db.prepare(`SELECT * FROM ${level} ${where} ORDER BY updated_at DESC`).all()
const fmt = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 16).replace('T', ' ') : '')
const lines = [`# ${level} 层快照（来源：备份库 ${dbPath}）`, ``, `共 ${rows.length} 条`, ``]
let chars = 0
for (const r of rows) {
  chars += String(r.content ?? '').length
  lines.push(`### ${r.id}  \`${r.project || '全局'}\`${r.subcategory ? ' · ' + r.subcategory : ''} · status=${r.status} · ${fmt(r.updated_at)} · ${String(r.content ?? '').length} 字`, '', String(r.content ?? ''), '', `关键词：${r.keywords ?? ''}`, '')
}
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`导出 ${rows.length} 条 / ${chars} 字符 → ${outPath}`)
