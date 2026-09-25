// 只读勘察：统计所有 dsh 会话里 user/message 事件的 source.kind / form 分布，
// 并统计「meow 折叠轮内出现非 user/steering 边界节点」的真实样本。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const root = process.argv[2]
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
    try { parts.push(zstdDecompressSync(buf.subarray(start, end)).toString('utf8')) } catch { /* 跳过坏帧 */ }
  }
  return parts.join('')
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}

const files = walk(root)
const counts = new Map()
let msgTotal = 0
for (const f of files) {
  let text
  try { text = readAll(f) } catch { continue }
  for (const line of text.split('\n')) {
    if (!line.includes('"user/message"')) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    if (rec.type !== 'user/message') continue
    msgTotal++
    const src = rec.data?.source ?? {}
    const key = `${src.kind}${src.form !== undefined ? '|form=' + src.form : ''}${src.plugin !== undefined ? '|plugin=' + src.plugin : ''}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}
console.log(`files=${files.length} userMessages=${msgTotal}`)
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(7)}  ${k}`)
