/** 列出全库会话：id + 标题 + 末条用户消息摘要（用于定位某段提问对应的会话）。 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

// 会话根目录：DSH_SESSIONS_DIR > <DSH_HOME 或 ~/.dsh>/sessions。其下可能再套一层「工作区」目录。
const SESS_ROOT = process.env.DSH_SESSIONS_DIR ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
/** 列出所有会话文件（自动发现「工作区/会话/」与「会话/」两种层级；会话文件名形如 session.v<N>.jsonl.zstd） */
const SESSION_FILE_RE = /^session\.v\d+\.jsonl\.zstd$/i
function findSessions(root) {
  const out = []
  const scan = (dir, depth) => {
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const full = join(dir, e.name)
      let hit
      try { hit = readdirSync(full).find((n) => SESSION_FILE_RE.test(n)) } catch { continue }
      if (hit !== undefined) out.push({ dir: e.name, file: join(full, hit) })
      else if (depth > 0) scan(full, depth - 1)
    }
  }
  scan(root, 1)
  return out
}
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function unzstdMulti(file) {
  const buf = readFileSync(file)
  const offsets = []
  let i = 0
  while (i <= buf.length - 4) { const idx = buf.indexOf(MAGIC, i); if (idx === -1) break; offsets.push(idx); i = idx + 4 }
  const parts = []
  for (let k = 0; k < offsets.length; k++) {
    const s = offsets[k], e = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(s, e)).toString('utf8')) } catch {}
  }
  return parts.join('')
}
const pat = process.argv[2]
const rows = []
for (const { dir, file } of findSessions(SESS_ROOT)) {
  let st
  try { st = statSync(file) } catch { continue }
  const evs = []
  for (const line of unzstdMulti(file).split('\n')) {
    if (!line.trim()) continue
    try { evs.push(JSON.parse(line)) } catch {}
  }
  const titleEv = evs.find((e) => typeof e.type === 'string' && e.type.includes('title'))
  const title = titleEv?.data?.title ?? titleEv?.data?.text ?? '(无标题事件)'
  const users = evs.filter((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')
  const last = users.at(-1)
  const lastText = last === undefined ? '' : (last.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').slice(0, 110)
  rows.push({ dir, mtime: st.mtime, size: st.size, title, lastText })
}
rows.sort((a, b) => b.mtime - a.mtime)
for (const r of rows) {
  const blob = `${r.dir} ${r.title} ${r.lastText}`
  if (pat !== undefined && !blob.toLowerCase().includes(pat.toLowerCase())) continue
  console.log(`${r.mtime.toISOString().slice(5, 16)}  ${String(Math.round(r.size / 1024)).padStart(6)}KB  ${r.dir}\n    标题: ${r.title}\n    末条用户消息: ${r.lastText}`)
}
console.log(`\n共 ${rows.length} 会话（匹配 ${pat ?? '*'}）`)
