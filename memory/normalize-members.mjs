/**
 * merge JSON 规范化器：把 `members` 从**对象数组**（子代理常用 `[{id,short,oldLen,action}]`）
 * 统一成 **id 字符串数组**（apply-merge.mjs 要求的形态），并校验没有丢 id。
 * 用法: node normalize-members.mjs <in.json> <out.json>
 * 说明：apply-merge 从 2026-09-23 起也兼容对象数组（会自动取 `.id`），这个脚本用于
 *       ① 校验子代理产出 ② 需要给别的脚本喂标准格式时。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [inp, outp] = process.argv.slice(2)
if (inp === undefined || outp === undefined) throw new Error('用法: node normalize-members.mjs <in.json> <out.json>')
if (!existsSync(inp)) throw new Error(`找不到 ${inp}`)

let converted = 0, kept = 0, dropped = 0
const arr = JSON.parse(readFileSync(inp, 'utf8'))
const out = arr.map((e) => {
  const raw = e.members ?? []
  const ids = []
  for (const m of raw) {
    if (typeof m === 'string') { ids.push(m); kept++; continue }
    if (m !== null && typeof m === 'object' && typeof m.id === 'string') { ids.push(m.id); converted++; continue }
    dropped++
    console.log(`  [丢掉无法识别的成员] ${e.cluster}: ${JSON.stringify(m)}`)
  }
  const extra = {}
  for (const [k, v] of Object.entries(e)) if (!['members'].includes(k)) extra[k] = v
  return { ...extra, members: ids }
})
writeFileSync(outp, JSON.stringify(out, null, 1), 'utf8')
console.log(`簇 ${arr.length} 个；members：对象转字符串 ${converted} 条 / 本来就是字符串 ${kept} 条 / 丢掉 ${dropped} 条`)
console.log(`→ ${outp}`)
