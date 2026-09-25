// compose-grid.mjs —— 把多张 SVG / PNG 按网格拼成一张对比图（**无浏览器**，用工作区现成的 sharp/librsvg）。
// 用法：node compose-grid.mjs <out.png> <cols> <cellWidth> <in1> <in2> ...
//   - 每格等比缩放到 cellWidth 宽，高度按原图比例；格子上方加文件名标签
//   - SVG 用 density=144（2x 清晰度）渲染；中文由 librsvg + fontconfig 处理
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
// sharp 的定位顺序：`DSH_SHARP_DIR` → 从本脚本目录向上逐级找 `node_modules/sharp` → 裸名 sharp。
// 仓库里不写死任何盘符：在仓库根 `npm i sharp` 即可，或把安装目录塞进 DSH_SHARP_DIR。
function findSharp() {
  const candidates = []
  if (process.env.DSH_SHARP_DIR) candidates.push(path.join(process.env.DSH_SHARP_DIR, 'sharp'), process.env.DSH_SHARP_DIR)
  for (let dir = HERE; ;) {
    candidates.push(path.join(dir, 'node_modules', 'sharp'))
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  candidates.push('sharp')
  const tried = []
  for (const c of candidates) {
    try { return { mod: require(c), from: c } } catch { tried.push(c) }
  }
  throw new Error('找不到 sharp（在仓库根 `npm i sharp`，或用 DSH_SHARP_DIR 指向安装目录）。试过：\n  ' + tried.join('\n  '))
}
const { mod: sharp, from: sharpFrom } = findSharp()

const [, , OUT, COLS, CELLW, ...INS] = process.argv
if (!OUT || !COLS || !CELLW || INS.length === 0) {
  console.error('用法：node compose-grid.mjs <out.png> <cols> <cellWidth> <in1> <in2> ...')
  process.exit(2)
}
const cols = Number(COLS)
const cellW = Number(CELLW)
const LABEL_H = 34
const PAD = 12
const BG = { r: 13, g: 17, b: 23, alpha: 1 }

const imgs = []
for (const f of INS) {
  let buf = fs.readFileSync(f)
  const isSvg = path.extname(f).toLowerCase() === '.svg'
  // XML 1.0 不允许部分控制字符（如 \x0B 垂直制表符）—— 数据里混进来会让 librsvg 直接报
  // "Input buffer has corrupt header: XML parse error … PCDATA invalid Char value 11"。这里先清洗。
  if (isSvg) buf = Buffer.from(buf.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''), 'utf8')
  const pipeline = isSvg ? sharp(buf, { density: 144 }) : sharp(buf)
  const meta = await pipeline.metadata()
  const scale = cellW / meta.width
  const cellH = Math.round(meta.height * scale)
  const png = await sharp(isSvg ? buf : buf, isSvg ? { density: 144 } : {})
    .resize({ width: cellW })
    .png()
    .toBuffer()
  imgs.push({ file: f, png, w: cellW, h: cellH, label: path.basename(f) })
  console.log(`  ${path.basename(f)}  ${meta.width}x${meta.height} → ${cellW}x${cellH}`)
}

const rows = Math.ceil(imgs.length / cols)
const rowH = Math.max(...imgs.map((i) => i.h)) + LABEL_H
const W = PAD + cols * (cellW + PAD)
const H = PAD + rows * (rowH + PAD)

function labelSvg(text, w) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL_H}">` +
    `<text x="4" y="23" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="20" fill="#e6edf3">${esc}</text></svg>`,
  )
}

const comps = []
imgs.forEach((im, i) => {
  const r = Math.floor(i / cols)
  const c = i % cols
  const left = PAD + c * (cellW + PAD)
  const top = PAD + r * (rowH + PAD)
  comps.push({ input: labelSvg(im.label, cellW), left, top })
  comps.push({ input: im.png, left, top: top + LABEL_H })
})

await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
  .composite(comps)
  .png()
  .toFile(OUT)
console.log(`\n拼好：${OUT}  (${W}x${H}，${imgs.length} 格 × ${cols} 列)  [sharp: ${sharpFrom}]`)
