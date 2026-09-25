// 只读勘察：按 source 分类列出一条样例文本（判断这类注入/消息的语义）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const root = process.argv[2]
const MAGIC = Buffer.from('28b52ffd', 'hex')
function readAll(path) {
  const buf = readFileSync(path)
  const offs = []
  let p = buf.indexOf(MAGIC, 0)
  while (p >= 0) { offs.push(p); p = buf.indexOf(MAGIC, p + 4) }
  const parts = []
  for (let i = 0; i < offs.length; i++) {
    const s = offs[i], e = i + 1 < offs.length ? offs[i + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(s, e)).toString('utf8')) } catch {}
  }
  return parts.join('')
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}
const samples = new Map()
for (const f of walk(root)) {
  let text
  try { text = readAll(f) } catch { continue }
  for (const line of text.split('\n')) {
    if (!line.includes('"user/message"')) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    if (rec.type !== 'user/message') continue
    const src = rec.data?.source ?? {}
    const key = `${src.kind}${src.form ? '|form=' + src.form : ''}${src.plugin ? '|plugin=' + src.plugin : ''}`
    if (samples.has(key)) continue
    const text0 = (rec.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    samples.set(key, text0.replace(/\s+/g, ' ').slice(0, 220))
  }
}
for (const [k, v] of samples) console.log(`\n### ${k}\n${v}`)
