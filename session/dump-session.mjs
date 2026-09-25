// 只读勘察：dsh 会话 jsonl.zstd 是多帧拼接，逐帧解压后按关键词切片打印。
// 用法: node dump-session.mjs <session.vN.jsonl.zstd> <关键词> [前后行数] [每行截断]
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const [file, kw, ctxRaw, cutRaw] = process.argv.slice(2)
const ctx = Number(ctxRaw ?? 3)
const cut = Number(cutRaw ?? 400)

const MAGIC = Buffer.from('28b52ffd', 'hex')
function readAll(path) {
  const buf = readFileSync(path)
  const offsets = []
  let p = buf.indexOf(MAGIC, 0)
  while (p >= 0) {
    offsets.push(p)
    p = buf.indexOf(MAGIC, p + 4)
  }
  const parts = []
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
    try {
      parts.push(zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
    } catch (err) {
      process.stderr.write(`# frame ${i} @${start} failed: ${err.message}\n`)
    }
  }
  return parts.join('')
}

const text = readAll(file)
const lines = text.split('\n')
const hits = []
for (let i = 0; i < lines.length; i++) if (lines[i].includes(kw)) hits.push(i)
console.log(`# file=${file}`)
console.log(`# totalLines=${lines.length} hits=${hits.length}`)
const shown = new Set()
for (const h of hits.slice(0, 30)) {
  for (let i = Math.max(0, h - ctx); i <= Math.min(lines.length - 1, h + ctx); i++) {
    if (shown.has(i)) continue
    shown.add(i)
    const s = lines[i]
    console.log(`[${i}] ${s.length > cut ? s.slice(0, cut) + ` …(+${s.length - cut})` : s}`)
  }
  console.log('---')
}
