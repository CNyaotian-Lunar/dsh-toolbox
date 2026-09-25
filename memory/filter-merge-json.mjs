/**
 * 按 cluster 名过滤 merge JSON（主 agent 用）：剔掉某些簇后另存。
 * 用法: node filter-merge-json.mjs <in.json> <out.json> --exclude "C1,C2"
 *      （cluster 名按原样匹配；空白字符会被忽略）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null)
const exArg = val('--exclude')
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--exclude')
const [inp, outp] = files
if (inp === undefined || outp === undefined) throw new Error('用法: node filter-merge-json.mjs <in.json> <out.json> --exclude "A,B"')
if (!existsSync(inp)) throw new Error(`找不到 ${inp}`)
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase()
const ex = new Set(String(exArg ?? '').split(',').map((s) => norm(s)).filter(Boolean))

const arr = JSON.parse(readFileSync(inp, 'utf8'))
const kept = arr.filter((e) => !ex.has(norm(e.cluster)))
for (const e of arr) console.log(`${ex.has(norm(e.cluster)) ? '[剔除]' : '[保留]'} ${e.cluster} ${String(e.mainId).slice(0, 12)} ${e.newLen} 字`)
writeFileSync(outp, JSON.stringify(kept, null, 1), 'utf8')
console.log(`\n${arr.length} → ${kept.length} 簇；写出 ${outp}`)
