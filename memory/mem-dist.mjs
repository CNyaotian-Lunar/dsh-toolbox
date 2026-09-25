/** 记忆库「分布统计」：按层看 importance / 长度 / 是否被检索命中过 / 项目 的分布，
 *  用于给"按判据砍"选阈值（砍之前先看清代价）。只读。
 * 用法: node mem-dist.mjs [层名] */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 记忆库路径：环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const LEVELS = process.argv[2] ? [process.argv[2]] : ['user', 'rules', 'project', 'fact', 'lesson', 'topic']

for (const level of LEVELS) {
  const cols = db.prepare(`PRAGMA table_info(${level})`).all().map((c) => c.name)
  const hasImp = cols.includes('importance')
  const hasAcc = cols.includes('last_accessed_at')
  const hasProj = cols.includes('project')
  const hasCreated = cols.includes('created_at')
  const rows = db.prepare(`SELECT * FROM ${level} WHERE status='active'`).all()
  if (rows.length === 0) continue
  console.log(`\n======== ${level}（active ${rows.length} 条）========`)

  if (hasImp) {
    const byImp = new Map()
    for (const r of rows) {
      const k = r.importance ?? 0
      const o = byImp.get(k) ?? { n: 0, c: 0, never: 0 }
      o.n++; o.c += String(r.content ?? '').length
      if (hasAcc && (r.last_accessed_at === null || r.last_accessed_at === undefined)) o.never++
      byImp.set(k, o)
    }
    console.log('  按重要性：')
    for (const k of [...byImp.keys()].sort((a, b) => a - b)) {
      const o = byImp.get(k)
      console.log(`    importance=${k}: ${String(o.n).padStart(4)} 条 / ${String(o.c).padStart(6)} 字符${hasAcc ? ` · 其中从未被检索命中 ${o.never} 条` : ''}`)
    }
  }

  if (hasAcc) {
    const never = rows.filter((r) => r.last_accessed_at === null || r.last_accessed_at === undefined)
    console.log(`  从未被检索命中：${never.length} 条 / ${never.reduce((a, r) => a + String(r.content).length, 0)} 字符`)
    // 从未命中 ∩ 低重要性
    if (hasImp) {
      for (const th of [1, 2, 3]) {
        const cut = never.filter((r) => (r.importance ?? 0) <= th)
        console.log(`    ∩ importance ≤ ${th}：${cut.length} 条 / ${cut.reduce((a, r) => a + String(r.content).length, 0)} 字符`)
      }
    }
  }

  // 时间分布（按创建日）
  if (hasCreated) {
    const byDay = new Map()
    for (const r of rows) {
      const d = new Date(Number(r.created_at ?? 0)).toISOString().slice(0, 10)
      byDay.set(d, (byDay.get(d) ?? 0) + 1)
    }
    const days = [...byDay.entries()].sort()
    console.log(`  创建日区间：${days[0]?.[0]} ~ ${days[days.length - 1]?.[0]}（共 ${days.length} 天）`)
    console.log(`    最近 3 天：${days.slice(-3).map(([d, n]) => d + ':' + n).join('  ')}`)
  }

  if (hasProj) {
    const byProj = new Map()
    for (const r of rows) {
      const k = r.project || '(空)'
      byProj.set(k, (byProj.get(k) ?? 0) + 1)
    }
    const top = [...byProj.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    console.log(`  按 project（top12）：${top.map(([k, n]) => k + ':' + n).join('  ')}`)
  }
}
