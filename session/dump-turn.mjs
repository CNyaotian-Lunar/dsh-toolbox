/** 打印指定会话指定 turn 的节点序列（判断折叠范围与 memory_* 调用分布）。 */
import { readFileSync, readdirSync } from 'node:fs'
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
const [frag, turnArg] = process.argv.slice(2)
const wantTurn = Number(turnArg)
const hit = findSessions(SESS_ROOT).find((s) => s.dir.includes(frag))
if (hit === undefined) { console.error(`找不到目录名含 "${frag}" 的会话（会话根：${SESS_ROOT}）`); process.exit(2) }
const evs = []
for (const line of unzstdMulti(hit.file).split('\n')) {
  if (!line.trim()) continue
  try { evs.push(JSON.parse(line)) } catch {}
}
let turn = -1, step = -1
const turnOf = []
for (const e of evs) {
  if (e.type === 'turn/start') { turn = e.data?.turn ?? turn + 1; step = -1 }
  if (e.type === 'step/start') { step = e.data?.step ?? step + 1 }
  turnOf.push({ turn, step })
}
let i = -1, n = 0
for (const e of evs) {
  i++
  if (turnOf[i].turn !== wantTurn) continue
  const src = e.data?.source ?? {}
  const kind = e.type === 'user/message' ? (src.kind !== 'user' ? 'context' : (src.rpcId ? 'user-rpc?' : 'user')) : e.type
  const extra = e.type === 'user/message' ? `${src.kind}${src.form ? '/' + src.form : ''}${src.plugin ? '/' + src.plugin : ''}` : (e.data?.name ?? '')
  let preview = ''
  if (e.type === 'user/message') preview = (e.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').slice(0, 70)
  else if (e.type === 'assistant/message') preview = (e.data.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').slice(0, 70)
  else if (e.type === 'tool/call') preview = String(e.data?.arguments ?? '').replace(/\s+/g, ' ').slice(0, 60)
  console.log(`${String(n++).padStart(3)} step${String(turnOf[i].step).padStart(3)} ${String(kind).padEnd(18)} ${extra.padEnd(34)} ${preview}`)
}
