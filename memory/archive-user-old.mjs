/**
 * B1 收口：把 user 层「已被 12 条主题条吸收」的旧条目归档（只改 status，不删数据）。
 * 默认 dry-run（只打印清单）；加 --apply 才真正写库，并落 undo SQL。
 * 用法: node archive-user-old.mjs [--apply]
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** undo 落盘目录：默认仓库的 out\（git 已忽略），可用 DSH_TOOLBOX_OUT 覆盖 */
const OUT = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')
const argv = process.argv.slice(2)
// 库路径：`--db <路径>` > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbArg = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : null
const dbPath = dbArg ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const undoPath = join(OUT, 'undo-user-archive.sql')

// 2026-09-22 新建的 12 条主题条（id 前缀）—— 这些必须保留
const KEEP = [
  '0mucu8wo', '0mucu8wp', '0mucu8wq', '0mucu8wr', '0mucu8ws', '0mucu8wt', // 语言文案 / 沟通 / 界面视觉 / 交付存放 / 协作节奏 / AI 权限红线
  '0mucu9j7', '0mucu9j8', '0mucu9j9', // 数据红线 / 验收评判 / 文档流程
  '0mucu9bw', '0mucu9bx', '0mucu9by', // 个人生活事实 / 家庭网络 / 技术解释与硬件投入
]

const apply = argv.includes('--apply')
const db = new DatabaseSync(dbPath)
const rows = db.prepare("SELECT id, content, created_at FROM user WHERE status='active'").all()

const keep = rows.filter((r) => KEEP.some((k) => String(r.id).startsWith(k)))
const arch = rows.filter((r) => !KEEP.some((k) => String(r.id).startsWith(k)))

const sum = (list) => list.reduce((a, r) => a + String(r.content).length, 0)
const tok = (n) => Math.round(n * 0.75)

console.log(`=== 将保留（${keep.length} 条 / ${sum(keep)} 字符 ≈ ${tok(sum(keep))} token）===`)
for (const r of keep) console.log(`  ${r.id.slice(0, 18)} ${String(String(r.content).length).padStart(4)}字 ${String(r.content).replace(/\s+/g, ' ').slice(0, 56)}`)
console.log(`\n=== 将归档（${arch.length} 条 / ${sum(arch)} 字符 ≈ ${tok(sum(arch))} token）===`)
for (const r of arch) console.log(`  ${r.id.slice(0, 18)} ${String(String(r.content).length).padStart(4)}字 ${String(r.content).replace(/\s+/g, ' ').slice(0, 56)}`)
console.log(`\n归档后 user 层 ≈ ${sum(keep)} 字符 ≈ ${tok(sum(keep))} token（原 ${sum(rows)} 字符 ≈ ${tok(sum(rows))} token）`)

if (!apply) {
  console.log('\n[dry-run] 未写库。加 --apply 执行。')
} else {
  if (arch.length === 0) throw new Error('没有可归档的条目，拒绝执行')
  for (const r of arch) if (String(r.id).length < 8) throw new Error(`可疑 id：${r.id}`)
  const list = arch.map((r) => `'${r.id}'`).join(',')
  writeFileSync(undoPath, `-- 还原（2026-09-22 B1 归档）：\nUPDATE user SET status='active' WHERE id IN (${list});\n`, 'utf8')
  db.exec(`UPDATE user SET status='archived' WHERE id IN (${list})`)
  const after = db.prepare("SELECT COUNT(*) AS n, SUM(LENGTH(content)) AS c FROM user WHERE status='active'").get()
  console.log(`\n[applied] user active 现在 ${after.n} 条 / ${after.c} 字符 ≈ ${tok(after.c)} token`)
  console.log(`[undo] ${undoPath}`)
}
