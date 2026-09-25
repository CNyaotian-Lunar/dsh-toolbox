// check-svg.mjs —— 校验导出的静态 SVG：自包含性 / XML 良构性 / UTF-8 / 中文标签 / 与线上产物一致性
// 用法：node check-svg.mjs <map.html> <spider.svg> <force.svg>
import fs from 'node:fs';

const [MAP, ...SVGS] = process.argv.slice(2);
let FAIL = 0;
const say = (ok, name, detail) => { if (!ok) FAIL++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} —— ${detail}`); return ok; };

// ---- 从线上产物抽出真实布局（与 svg-stub3 同源口径，但这里只解析 SVG 文件本身）
const html = fs.readFileSync(MAP, 'utf8');
const pay = JSON.parse(html.match(/<script>window\.__WIKI_MAP__=([\s\S]*?);<\/script>/)[1]);

for (const f of SVGS) {
  console.log(`\n--- ${f} ---`);
  const buf = fs.readFileSync(f);
  const s = buf.toString('utf8');

  // 1) 编码 / BOM
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const roundTrip = Buffer.from(s, 'utf8').equals(buf);
  say(!bom && roundTrip, 'UTF-8 无 BOM 且可无损往返', `BOM=${bom} 往返一致=${roundTrip} 字节=${buf.length}`);
  say(/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(s), 'XML 声明 + UTF-8', s.slice(0, 45).replace(/\n/g, ' '));

  // 2) 自包含性：排除 data-* 数据属性后的真实资源引用
  const res = [...s.matchAll(/(?<!data-)(?<!data-key-)\b(xlink:href|href|src)\s*=\s*"([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
  const imports = [...s.matchAll(/@import|url\(\s*['"]?(?!data:)[^)'"]+/g)].map((m) => m[0]);
  const scripts = [...s.matchAll(/<script|onload=|onerror=|onclick=/gi)].map((m) => m[0]);
  say(res.length === 0 && imports.length === 0 && scripts.length === 0,
    '无外部资源引用 / 无 @import / 无脚本与事件',
    `资源引用 ${res.length} 处 ${res.slice(0, 3).join(',')} · import/url ${imports.length} 处 ${imports.slice(0, 3).join(',')} · 脚本/事件 ${scripts.length} 处 ${scripts.slice(0, 3).join(',')}`);
  const dataHref = [...s.matchAll(/data-href="([^"]*)"/g)].length;
  console.log(`     说明：另有 ${dataHref} 个 data-href 数据属性（点节点跳转用），不是资源引用，静态图里不加载任何东西`);

  // 3) 中文标签确实存在
  const cjk = [...s.matchAll(/[\u4e00-\u9fff]/g)].length;
  const textNodes = [...s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const cjkLabels = textNodes.filter((t) => /[\u4e00-\u9fff]/.test(t));
  say(cjk > 0, '含中文文本（不会显示成方块）', `CJK 字符 ${cjk} 个 · 含中文的 text 标签 ${cjkLabels.length} 个，例如：${cjkLabels.slice(0, 6).join(' / ')}`);

  // 4) XML 良构性：栈式标签配对（属性值内的 < > 已转义，不会干扰）
  const stack = [];
  let bad = null;
  for (const m of s.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
    const [, close, tag, , selfClose] = m;
    if (close) { const top = stack.pop(); if (top !== tag) { bad = `</${tag}> 与 <${top}> 不匹配`; break; } }
    else if (!selfClose) stack.push(tag);
  }
  if (!bad && stack.length) bad = `未闭合：${stack.join(', ')}`;
  say(!bad, 'XML 标签全部闭合配对', bad || '栈清空、配对正确');

  // 5) 与线上产物的数据一致性（节点数）
  const hits = [...s.matchAll(/data-name="/g)].length;
  const lines = [...s.matchAll(/<line\b/g)].length;
  const isSpider = /蛛网图/.test(s);
  const expHits = isSpider ? pay.proj.length + pay.task.length : 1 + pay.proj.length + pay.task.length;
  const expLines = isSpider ? 12 + pay.proj.length + pay.task.length : pay.proj.length + pay.task.length;
  say(hits === expHits && lines === expLines,
    `节点数/连线数与线上 payload 一致（${isSpider ? '蛛网图' : '力导向'}）`,
    `data-name 命中 ${hits}（期望 ${expHits}）· line ${lines}（期望 ${expLines}）· payload proj=${pay.proj.length} task=${pay.task.length}`);

  // 6) 越界统计（与 svg-stub3 口径一致：蛛网图看圆心，力导向看矩形 AABB）
  const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  let outside = 0, n = 0;
  if (isSpider) {
    for (const m of s.matchAll(/<circle\b[^>]*>/g)) {
      const a = attrsOf(m[0]);
      if (!a['data-name']) continue;
      const x = +a.cx, y = +a.cy; n++;
      if (x < 0 || x > 1000 || y < 0 || y > 660) outside++;
    }
  } else {
    for (const m of s.matchAll(/<g\b[^>]*>/g)) {
      const a = attrsOf(m[0]);
      if (!a['data-name'] || !a.transform) continue;
      const tr = a.transform.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
      const r = s.slice(m.index + m[0].length).match(/^\s*<rect\b[^>]*>/);
      if (!tr || !r) continue;
      const ra = attrsOf(r[0]);
      const x = +tr[1], y = +tr[2], w = +ra.width, h = +ra.height; n++;
      if (x - w / 2 < 0 || x + w / 2 > 1000 || y - h / 2 < 0 || y + h / 2 > 660) outside++;
    }
  }
  console.log(`     节点 ${n} 个 · 出 viewBox（0 0 1000 660）的 ${outside} 个`);
  if (n !== expHits) say(false, '节点解析数与 data-name 命中数一致', `${n} vs ${hits}`);
}

console.log(`\n汇总：失败 ${FAIL} 项`);
process.exit(FAIL ? 1 : 0);
