/**
 * 只读导出记忆库 → 单文件深色浏览页（无依赖、可离线双击打开）。
 * 用法: node gen-browser.mjs [memory.db 路径] [输出 html 路径]
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 生成物默认落到仓库的 out\ 目录（已在 .gitignore 里）；可用 DSH_TOOLBOX_OUT 覆盖 */
const OUTDIR = process.env.DSH_TOOLBOX_OUT ?? join(HERE, '..', 'out')

// 记忆库路径：位置参数 > 环境变量 DSH_MEMORY_DB > <DSH_WORKSPACE 或用户主目录>/.dsh-meow/memory.db
const dbPath = process.argv[2] ?? process.env.DSH_MEMORY_DB ?? join(process.env.DSH_WORKSPACE ?? homedir(), '.dsh-meow', 'memory.db')
const outPath = process.argv[3] ?? join(OUTDIR, 'memory-browser.html')

const db = new DatabaseSync(dbPath, { readOnly: true })
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)

const LEVEL_LABEL = { soul: '灵魂', user: '用户', project: '项目', fact: '事实', lesson: '经验', topic: '话题', rules: '准则' }
const SUB_LABEL = { overview: '总览', structure: '结构', decisions: '决策', quotes: '原话', ops: '运维', todo: '待办' }
const LEVELS = ['user', 'rules', 'project', 'fact', 'lesson', 'topic', 'soul']

const items = []
for (const level of LEVELS) {
  if (!tables.includes(level)) continue
  const rows = db.prepare(`SELECT * FROM ${level}`).all()
  for (const r of rows) {
    items.push({
      id: r.id ?? '',
      level,
      project: r.project ?? '',
      sub: r.subcategory ?? '',
      status: r.status ?? 'active',
      importance: r.importance ?? 0,
      corrected: r.corrected === 1 || r.corrected === true,
      title: r.title ?? '',
      content: r.content ?? '',
      goal: r.goal ?? '',
      keywords: r.keywords ?? '',
      session: r.source_session ?? '',
      created: Number(r.created_at ?? 0),
      updated: Number(r.updated_at ?? r.created_at ?? 0),
    })
  }
}
items.sort((a, b) => b.updated - a.updated)

const stats = {
  total: items.length,
  byLevel: Object.fromEntries(LEVELS.map((l) => [l, items.filter((i) => i.level === l).length])),
  active: items.filter((i) => i.status === 'active').length,
  archived: items.filter((i) => i.status === 'archived').length,
  stale: items.filter((i) => i.status === 'stale').length,
  projects: [...new Set(items.map((i) => i.project).filter((p) => p !== '' && p !== '全局'))].sort(),
}

const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (m) => (m === '\u2028' ? '\\u2028' : '\\u2029'))

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>记忆库浏览</title>
<style>
:root{--bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--line:#21262d;--card:#161b22;--accent:#4a9eff;--warn:#e3b341;--bad:#f85149;--ok:#3fb950}
html[data-theme=light]{--bg:#f6f8fa;--fg:#1f2328;--dim:#57606a;--line:#d0d7de;--card:#fff;--accent:#0969da;--warn:#9a6700;--bad:#cf222e;--ok:#1a7f37}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 18px}
h1{margin:0 0 10px;font-size:16px;font-weight:600}
h1 span{color:var(--dim);font-weight:400;font-size:13px;margin-left:8px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input[type=search],select{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font:inherit;min-width:120px}
input[type=search]{flex:1;min-width:220px}
label.chk{display:inline-flex;align-items:center;gap:5px;color:var(--dim);font-size:13px;cursor:pointer}
button{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer}
button:hover{border-color:var(--accent)}
.cards{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px}
.card b{font-size:16px;color:var(--accent);margin-right:4px}
main{padding:14px 18px 60px;max-width:1180px;margin:0 auto}
.item{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:8px}
.item[data-level=user]{border-left-color:#4a9eff}
.item[data-level=rules]{border-left-color:#f85149}
.item[data-level=project]{border-left-color:#3fb950}
.item[data-level=fact]{border-left-color:#8b949e}
.item[data-level=lesson]{border-left-color:#e3b341}
.item[data-level=topic]{border-left-color:#a371f7}
.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--dim);font-size:12px;margin-bottom:5px}
.tag{border:1px solid var(--line);border-radius:999px;padding:1px 8px;white-space:nowrap}
.tag.lv{color:var(--accent);border-color:var(--accent)}
.tag.imp{color:var(--warn);border-color:var(--warn)}
.tag.corr{color:var(--bad);border-color:var(--bad)}
.body{white-space:pre-wrap;word-break:break-word;max-height:9.5em;overflow:hidden;position:relative}
.item.open .body{max-height:none}
.item .fold{color:var(--accent);cursor:pointer;font-size:12px;margin-top:6px;user-select:none}
.kw{color:var(--dim);font-size:12px;margin-top:6px;white-space:pre-wrap}
.goal{color:var(--accent);font-size:12px;margin-bottom:4px}
.count{color:var(--dim);font-size:13px;margin:0 0 10px}
mark{background:var(--accent);color:var(--bg);border-radius:2px}
</style></head><body>
<header>
  <h1>记忆库浏览<span id="src"></span></h1>
  <div class="bar">
    <input type="search" id="q" placeholder="搜索内容 / 关键词 / 项目 / id（空格分隔，全部命中）">
    <select id="level"><option value="">全部层级</option></select>
    <select id="project"><option value="">全部项目</option></select>
    <select id="status">
      <option value="active">仅 active</option>
      <option value="">含 stale / archived</option>
      <option value="archived">仅 archived</option>
      <option value="stale">仅 stale</option>
    </select>
    <select id="sort">
      <option value="updated">按更新时间</option>
      <option value="created">按创建时间</option>
      <option value="importance">按重要性</option>
      <option value="level">按层级</option>
    </select>
    <button id="theme">☀️ 浅色</button>
  </div>
  <div class="cards" id="cards"></div>
</header>
<main><p class="count" id="count"></p><div id="list"></div></main>
<script>
const ITEMS = ${safeJson(items)};
const STATS = ${safeJson(stats)};
const DB = ${safeJson(dbPath)};
const LEVEL_LABEL = ${safeJson(LEVEL_LABEL)};
const SUB_LABEL = ${safeJson(SUB_LABEL)};
document.getElementById('src').textContent = DB + ' · 共 ' + STATS.total + ' 条（active ' + STATS.active + ' / stale ' + STATS.stale + ' / archived ' + STATS.archived + '）';
const cards = document.getElementById('cards');
for (const [lv, n] of Object.entries(STATS.byLevel)) {
  if (!n) continue;
  const d = document.createElement('div'); d.className = 'card';
  d.innerHTML = '<b>' + n + '</b>' + (LEVEL_LABEL[lv] || lv);
  d.style.cursor = 'pointer';
  d.onclick = () => { document.getElementById('level').value = lv; render(); };
  cards.appendChild(d);
}
const levelSel = document.getElementById('level');
for (const [lv, lab] of Object.entries(LEVEL_LABEL)) { const o = document.createElement('option'); o.value = lv; o.textContent = lab + ' (' + (STATS.byLevel[lv] || 0) + ')'; levelSel.appendChild(o); }
const projSel = document.getElementById('project');
for (const p of STATS.projects) { const o = document.createElement('option'); o.value = p; o.textContent = p; projSel.appendChild(o); }

const fmt = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const esc = (s) => s;
function highlight(text, terms) {
  if (!terms.length) return null;
  const frag = document.createDocumentFragment();
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('|') + ')', 'gi');
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const mk = document.createElement('mark'); mk.textContent = m[0]; frag.appendChild(mk);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}
const list = document.getElementById('list');
function render() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const terms = q.split(/\\s+/).filter(Boolean);
  const lv = levelSel.value, pj = projSel.value, st = document.getElementById('status').value, sort = document.getElementById('sort').value;
  let rows = ITEMS.filter((it) => {
    if (st && it.status !== st) return false;
    if (lv && it.level !== lv) return false;
    if (pj && it.project.indexOf(pj) === -1) return false;
    if (terms.length) {
      const hay = (it.content + ' ' + it.keywords + ' ' + it.project + ' ' + it.title + ' ' + it.id + ' ' + it.goal).toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  if (sort === 'created') rows = [...rows].sort((a, b) => b.created - a.created);
  else if (sort === 'importance') rows = [...rows].sort((a, b) => b.importance - a.importance || b.updated - a.updated);
  else if (sort === 'level') rows = [...rows].sort((a, b) => a.level.localeCompare(b.level) || b.updated - a.updated);
  document.getElementById('count').textContent = '显示 ' + rows.length + ' / ' + ITEMS.length + ' 条' + (terms.length ? '（搜索：' + terms.join(' + ') + '）' : '');
  list.textContent = '';
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const frag = document.createDocumentFragment();
    for (const it of slice) {
      const div = document.createElement('div');
      div.className = 'item'; div.dataset.level = it.level;
      const meta = document.createElement('div'); meta.className = 'meta';
      const add = (text, cls) => { const s = document.createElement('span'); s.className = 'tag' + (cls ? ' ' + cls : ''); s.textContent = text; meta.appendChild(s); };
      add(LEVEL_LABEL[it.level] || it.level, 'lv');
      if (it.project) add(it.project);
      if (it.sub) add(SUB_LABEL[it.sub] || it.sub);
      if (it.status !== 'active') add(it.status === 'stale' ? '已完成' : '已归档');
      if (it.importance) add('重要性 ' + it.importance, 'imp');
      if (it.corrected) add('被纠正', 'corr');
      add(fmt(it.updated));
      div.appendChild(meta);
      if (it.goal) { const g = document.createElement('div'); g.className = 'goal'; g.textContent = '目标：' + it.goal; div.appendChild(g); }
      const body = document.createElement('div'); body.className = 'body';
      const hl = highlight(it.content, terms);
      if (hl) body.appendChild(hl); else body.textContent = it.content;
      div.appendChild(body);
      const fold = document.createElement('div'); fold.className = 'fold'; fold.textContent = '展开 ▾';
      fold.onclick = () => { div.classList.toggle('open'); fold.textContent = div.classList.contains('open') ? '收起 ▴' : '展开 ▾'; };
      div.appendChild(fold);
      if (it.keywords) { const kw = document.createElement('div'); kw.className = 'kw'; kw.textContent = '关键词：' + it.keywords; div.appendChild(kw); }
      frag.appendChild(div);
    }
    list.appendChild(frag);
  }
}
for (const id of ['q', 'level', 'project', 'status', 'sort']) document.getElementById(id).addEventListener('input', render);
let t; document.getElementById('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 120); });
document.getElementById('theme').onclick = () => {
  const html = document.documentElement;
  const dark = html.dataset.theme !== 'light';
  html.dataset.theme = dark ? 'light' : 'dark';
  document.getElementById('theme').textContent = dark ? '🌙 深色' : '☀️ 浅色';
  try { localStorage.setItem('mem-theme', html.dataset.theme); } catch (e) {}
};
try { const saved = localStorage.getItem('mem-theme'); if (saved === 'light') { document.documentElement.dataset.theme = 'light'; document.getElementById('theme').textContent = '🌙 深色'; } } catch (e) {}
render();
</script></body></html>`

writeFileSync(outPath, html, 'utf8')
console.log(`导出 ${items.length} 条（active ${stats.active} / stale ${stats.stale} / archived ${stats.archived}）`)
console.log(`输出：${outPath}  (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`)
