// svg2png.mjs —— 用工作区现成的 sharp(librsvg) 把静态 SVG 转 PNG（无浏览器）
// 用法：node svg2png.mjs <in.svg> <out.png> [density，默认 144 = 2x]
//
// ⚠️ 教训：**不要硬编码某个目录的 `node_modules/sharp`** —— 那个目录一旦被清理，
//    整个脚本会静默失效（某次自检就因此报 FAIL）。这里改为**多候选查找**，命中哪个打印哪个。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// 候选：`DSH_SHARP_DIR` → 从本脚本向上逐级找 `node_modules/sharp` → 裸名 sharp
const CANDIDATES = [];
if (process.env.DSH_SHARP_DIR) CANDIDATES.push(path.join(process.env.DSH_SHARP_DIR, 'sharp'), process.env.DSH_SHARP_DIR);
for (let dir = HERE; ;) {
  CANDIDATES.push(path.join(dir, 'node_modules', 'sharp'));
  const up = path.dirname(dir);
  if (up === dir) break;
  dir = up;
}
CANDIDATES.push('sharp');

let sharp = null, usedFrom = '';
for (const c of CANDIDATES) {
  try { sharp = require(c); usedFrom = c; break } catch { /* 试下一个 */ }
}
if (sharp === null) {
  console.error(`✗ 找不到可用的 sharp。试过：\n  ${CANDIDATES.join('\n  ')}\n` +
    `  提示：在仓库根执行 \`npm i sharp\` 即可；也可以把已装好 sharp 的目录用 DSH_SHARP_DIR 指过来。`);
  process.exit(3);
}

const [, , IN, OUT, D] = process.argv;
const density = Number(D || 144);
if (!IN || !OUT) { console.error('用法：node svg2png.mjs <in.svg> <out.png> [density]'); process.exit(2); }
const svg = fs.readFileSync(IN);
const info = await sharp(svg, { density }).png().toFile(OUT);
console.log(JSON.stringify({ in: IN, out: OUT, density, sharpFrom: usedFrom, ...info }));
