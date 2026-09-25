# 工具箱索引（自动生成，勿手改）

> 由 `node build-index.mjs` 扫 `dsh-toolbox` 下所有脚本生成 —— **加了新脚本重跑一次就有了**。
> 生成时刻：2026-09-25 08:25:38 · 共 **40** 个脚本

## 速查：我要干什么 → 用哪个

| 想干的事 | 脚本 | 用法 |
|---|---|---|
| 工具箱「索引生成器」：扫描 dsh-toolbox 下所有脚本，抽出顶部注释里的「干什么 / 用法」， | `build-index.mjs` | `node build-index.mjs` |
| 记忆库体检：层分布 / 注入成本 / 重复簇 / 超长 / 关键词缺失 / 访问记录 / 时间分布。 | `memory/analyze.mjs` | `node analyze.mjs [memory.db]` |
| 批量归档器：把一批 lesson id 标 archived（只改 status，不删数据），可 dry-run、可回滚。 | `memory/apply-archive.mjs` | `node apply-archive.mjs --file <ids.txt> [--apply]` |
| 压缩落地器（**任意层**）：把子代理产出的 JSON（[{short,id,oldLen,newLen,newContent}]）批量写进记忆库。 | `memory/apply-compress.mjs` | `node apply-compress.mjs <json...> [--table fact] [--from active] [--minLen 150] [--apply]` |
| 合并落地器：把一个簇的成员合并进【主条】——改写主条正文（+可选 keywords/project/importance）， | `memory/apply-merge.mjs` | `node apply-merge.mjs <json...> [--table fact] [--from active] [--allowGrow] [--apply]` |
| B1 收口：把 user 层「已被 12 条主题条吸收」的旧条目归档（只改 status，不删数据）。 | `memory/archive-user-old.mjs` | `node archive-user-old.mjs [--apply]` |
| 记忆库一致性备份（VACUUM INTO：包含 WAL 里未落盘的数据，源库不改数据）。 | `memory/backup-db.mjs` | `node backup-db.mjs <源 memory.db> <目标文件>  —— 目标必须不存在` |
| 整理前后体检对比：读「整理前备份库」与「当前活库」，逐层对比条数 / 字符 / 估算 token。 | `memory/compare-before-after.mjs` | `node compare-before-after.mjs [备份库] [当前库]` |
| 从备份库导出某层全文到 md（用于补齐"整理前"快照）。 | `memory/export-from-backup.mjs` | `node export-from-backup.mjs <备份db> <层名> <输出md> [--all-status]` |
| 导出某一层（或全部）记忆为 Markdown 清单，便于逐条判决（保留 / 搬家 / 合并 / 归档）。 | `memory/export-layer.mjs` | `node export-layer.mjs <层名|all> [输出 md]` |
| 按 cluster 名过滤 merge JSON（主 agent 用）：剔掉某些簇后另存。 | `memory/filter-merge-json.mjs` | `node filter-merge-json.mjs <in.json> <out.json> --exclude "C1,C2"` |
| 只读导出记忆库 → 单文件深色浏览页（无依赖、可离线双击打开）。 | `memory/gen-browser.mjs` | `node gen-browser.mjs [memory.db 路径] [输出 html 路径]` |
| 列出某层 active 条目的紧凑概览（id / project / 重要性 / 长度 / 首 60 字）。 | `memory/list-lite.mjs` | `node list-lite.mjs <层名>` |
| B1 判决辅助：列出 user 层全部 active 条目（id + 长度 + 主题指纹），供逐条判决。 | `memory/list-user.mjs` | `node list-user.mjs [过滤正则]` |
| 多表通用归档器：把一批 id 标 archived（只改 status，不删数据），可 dry-run、可回滚。 | `memory/mem-archive.mjs` | `node mem-archive.mjs --table fact --ids <id1,id2,...> [--apply]` |
| 判据裁剪器：按可解释的判据批量归档条目（只改 status，不删数据），可 dry-run、可回滚。 | `memory/mem-cut.mjs` | `node mem-cut.mjs --table lesson --rule <判据> [--limit N] [--olderThanDays D] [--apply]` |
| 记忆库「分布统计」：按层看 importance / 长度 / 是否被检索命中过 / 项目 的分布， | `memory/mem-dist.mjs` | `node mem-dist.mjs [层名]` |
| 只读清点记忆库：表结构 / 各层条数与状态分布 / project 子类 / 最近更新。 | `memory/memory-stats.mjs` | `node memory-stats.mjs [memory.db 路径]` |
| 合并产物的「关键词并集补强」：把被归档成员的关键词**补回主条**，避免合并后搜不到。 | `memory/merge-keywords.mjs` | `node merge-keywords.mjs <merge-*.json> [--table fact] [--max 16] [--apply]` |
| merge JSON 规范化器：把 `members` 从**对象数组**（子代理常用 `[{id,short,oldLen,action}]`） | `memory/normalize-members.mjs` | `node normalize-members.mjs <in.json> <out.json>` |
| 压缩还原器：读 apply-compress.mjs 落下的 undo JSON，把 content 还原回压缩前。 | `memory/restore-compress.mjs` | `node restore-compress.mjs <undo-compress-*.json> [--table fact] [--apply]` |
| 合并还原器：读 apply-merge.mjs 落下的 `undo-merge-<表>-<时间戳>.json`，一键还原整批： | `memory/restore-merge.mjs` | `node restore-merge.mjs <undo-merge-*.json> [--table fact] [--apply]` |
| 各层「长度分布桶」统计：用于收尾报告（超长条目还剩多少）。只读。 | `memory/stats-buckets.mjs` | `node stats-buckets.mjs [db路径]` |
| 「每轮固定注入」总账：把 **AGENTS.md 瘦身前 ↔ 现在** 与 **记忆库整理前 ↔ 现在** 放在一起算 token。 | `memory/token-account.mjs` | `node token-account.mjs [--agents-before <旧版 AGENTS.md>] [--db-before <旧备份库>]` |
| 压缩产物独立验真（任意层，主 agent 用，**不信子代理自检**）： | `memory/verify-compress-json.mjs` | `node verify-compress-json.mjs <json...> [--table topic] [--dump C1,C2]` |
| 合并产物独立验真（主 agent 专用，**不信子代理自检**）： | `memory/verify-merge-json.mjs` | `node verify-merge-json.mjs <json> [--table fact] [--dump C1,C2]` |
| // check-svg.mjs —— 校验导出的静态 SVG：自包含性 / XML 良构性 / UTF-8 / 中文标签 / 与线上产物一致性 | `render/check-svg.mjs` | `node check-svg.mjs <map.html> <spider.svg> <force.svg>` |
| // compose-grid.mjs —— 把多张 SVG / PNG 按网格拼成一张对比图（**无浏览器**，用工作区现成的 sharp/librsvg）。 | `render/compose-grid.mjs` | `node compose-grid.mjs <out.png> <cols> <cellWidth> <in1> <in2> ...` |
| // svg2png.mjs —— 用工作区现成的 sharp(librsvg) 把静态 SVG 转 PNG（无浏览器） | `render/svg2png.mjs` | `node svg2png.mjs <in.svg> <out.png> [density，默认 144 = 2x]` |
| 反事实对照：真实会话 → chat 快照 → 折叠组。 | `session/_repro-inbound.mjs` | `node repro-inbound.mjs --fold-src <目录> [会话id子串...]   （不给会话 id = 扫全库）` |
| // 只读勘察：dsh 会话 jsonl.zstd 是多帧拼接，逐帧解压后按关键词切片打印。 | `session/dump-session.mjs` | `node dump-session.mjs <session.vN.jsonl.zstd> <关键词> [前后行数] [每行截断]` |
| 反事实对照：真实会话 → chat 快照 → 折叠组。 | `session/repro-inbound.mjs` | `node repro-inbound.mjs --fold-src <目录> [会话id子串...]   （不给会话 id = 扫全库）` |
| // 只读勘察：dsh 会话 jsonl.zstd 是多帧拼接，逐帧解压后按关键词切片打印。 | `session/zstd-session.mjs` | `node zstd-session.mjs <session.vN.jsonl.zstd> <关键词> [前后行数] [每行截断]` |
| 极简 CDP 客户端（Node ≥22 自带全局 WebSocket，无需依赖）。 | `tools/lib-cdp.mjs` | `const cdp = await connectPage(9222);            // 找 type=page 的 target` |
| // page-shot.mjs —— 无头浏览器「截图 + 采集页面错误 + 跑断言」。 | `tools/page-shot.mjs` | `node page-shot.mjs --url <file:///… 或 http://…> --out <png 路径>` |

## tools\ —— 其它工具

### `build-index.mjs`  <sub>5KB · 2026-09-25</sub>

- **干什么**：工具箱「索引生成器」：扫描 dsh-toolbox 下所有脚本，抽出顶部注释里的「干什么 / 用法」，
- **怎么用**：`node build-index.mjs`
- **标签**：标签1 / 标签2`（不写就按目录归类）

### `tools/lib-cdp.mjs`  <sub>6KB · 2026-09-12</sub>

- **干什么**：极简 CDP 客户端（Node ≥22 自带全局 WebSocket，无需依赖）。
- **怎么用**：`const cdp = await connectPage(9222);            // 找 type=page 的 target`

### `tools/page-shot.mjs`  <sub>7KB · 2026-09-25</sub>

- **干什么**：// page-shot.mjs —— 无头浏览器「截图 + 采集页面错误 + 跑断言」。
- **怎么用**：`node page-shot.mjs --url <file:///… 或 http://…> --out <png 路径>`

## memory\ —— 记忆库（memory.db）

### `memory/analyze.mjs`  <sub>8KB · 2026-09-25</sub>

- **干什么**：记忆库体检：层分布 / 注入成本 / 重复簇 / 超长 / 关键词缺失 / 访问记录 / 时间分布。
- **怎么用**：`node analyze.mjs [memory.db]`

### `memory/apply-archive.mjs`  <sub>6KB · 2026-09-25</sub>

- **干什么**：批量归档器：把一批 lesson id 标 archived（只改 status，不删数据），可 dry-run、可回滚。
- **怎么用**：`node apply-archive.mjs --file <ids.txt> [--apply]`

### `memory/apply-compress.mjs`  <sub>5KB · 2026-09-25</sub>

- **干什么**：压缩落地器（**任意层**）：把子代理产出的 JSON（[{short,id,oldLen,newLen,newContent}]）批量写进记忆库。
- **怎么用**：`node apply-compress.mjs <json...> [--table fact] [--from active] [--minLen 150] [--apply]`

### `memory/apply-merge.mjs`  <sub>7KB · 2026-09-25</sub>

- **干什么**：合并落地器：把一个簇的成员合并进【主条】——改写主条正文（+可选 keywords/project/importance），
- **怎么用**：`node apply-merge.mjs <json...> [--table fact] [--from active] [--allowGrow] [--apply]`

### `memory/archive-user-old.mjs`  <sub>3KB · 2026-09-25</sub>

- **干什么**：B1 收口：把 user 层「已被 12 条主题条吸收」的旧条目归档（只改 status，不删数据）。
- **怎么用**：`node archive-user-old.mjs [--apply]`

### `memory/backup-db.mjs`  <sub>1KB · 2026-09-22</sub>

- **干什么**：记忆库一致性备份（VACUUM INTO：包含 WAL 里未落盘的数据，源库不改数据）。
- **怎么用**：`node backup-db.mjs <源 memory.db> <目标文件>  —— 目标必须不存在`

### `memory/compare-before-after.mjs`  <sub>5KB · 2026-09-25</sub>

- **干什么**：整理前后体检对比：读「整理前备份库」与「当前活库」，逐层对比条数 / 字符 / 估算 token。
- **怎么用**：`node compare-before-after.mjs [备份库] [当前库]`

### `memory/export-from-backup.mjs`  <sub>1KB · 2026-09-22</sub>

- **干什么**：从备份库导出某层全文到 md（用于补齐"整理前"快照）。
- **怎么用**：`node export-from-backup.mjs <备份db> <层名> <输出md> [--all-status]`

### `memory/export-layer.mjs`  <sub>2KB · 2026-09-25</sub>

- **干什么**：导出某一层（或全部）记忆为 Markdown 清单，便于逐条判决（保留 / 搬家 / 合并 / 归档）。
- **怎么用**：`node export-layer.mjs <层名|all> [输出 md]`

### `memory/filter-merge-json.mjs`  <sub>1KB · 2026-09-25</sub>

- **干什么**：按 cluster 名过滤 merge JSON（主 agent 用）：剔掉某些簇后另存。
- **怎么用**：`node filter-merge-json.mjs <in.json> <out.json> --exclude "C1,C2"`

### `memory/gen-browser.mjs`  <sub>13KB · 2026-09-25</sub>

- **干什么**：只读导出记忆库 → 单文件深色浏览页（无依赖、可离线双击打开）。
- **怎么用**：`node gen-browser.mjs [memory.db 路径] [输出 html 路径]`

### `memory/list-lite.mjs`  <sub>1KB · 2026-09-25</sub>

- **干什么**：列出某层 active 条目的紧凑概览（id / project / 重要性 / 长度 / 首 60 字）。
- **怎么用**：`node list-lite.mjs <层名>`

### `memory/list-user.mjs`  <sub>1KB · 2026-09-25</sub>

- **干什么**：B1 判决辅助：列出 user 层全部 active 条目（id + 长度 + 主题指纹），供逐条判决。
- **怎么用**：`node list-user.mjs [过滤正则]`

### `memory/mem-archive.mjs`  <sub>6KB · 2026-09-25</sub>

- **干什么**：多表通用归档器：把一批 id 标 archived（只改 status，不删数据），可 dry-run、可回滚。
- **怎么用**：`node mem-archive.mjs --table fact --ids <id1,id2,...> [--apply]`

### `memory/mem-cut.mjs`  <sub>4KB · 2026-09-25</sub>

- **干什么**：判据裁剪器：按可解释的判据批量归档条目（只改 status，不删数据），可 dry-run、可回滚。
- **怎么用**：`node mem-cut.mjs --table lesson --rule <判据> [--limit N] [--olderThanDays D] [--apply]`

### `memory/mem-dist.mjs`  <sub>3KB · 2026-09-25</sub>

- **干什么**：记忆库「分布统计」：按层看 importance / 长度 / 是否被检索命中过 / 项目 的分布，
- **怎么用**：`node mem-dist.mjs [层名]`

### `memory/memory-stats.mjs`  <sub>3KB · 2026-09-25</sub>

- **干什么**：只读清点记忆库：表结构 / 各层条数与状态分布 / project 子类 / 最近更新。
- **怎么用**：`node memory-stats.mjs [memory.db 路径]`

### `memory/merge-keywords.mjs`  <sub>5KB · 2026-09-25</sub>

- **干什么**：合并产物的「关键词并集补强」：把被归档成员的关键词**补回主条**，避免合并后搜不到。
- **怎么用**：`node merge-keywords.mjs <merge-*.json> [--table fact] [--max 16] [--apply]`

### `memory/normalize-members.mjs`  <sub>2KB · 2026-09-22</sub>

- **干什么**：merge JSON 规范化器：把 `members` 从**对象数组**（子代理常用 `[{id,short,oldLen,action}]`）
- **怎么用**：`node normalize-members.mjs <in.json> <out.json>`

### `memory/restore-compress.mjs`  <sub>3KB · 2026-09-25</sub>

- **干什么**：压缩还原器：读 apply-compress.mjs 落下的 undo JSON，把 content 还原回压缩前。
- **怎么用**：`node restore-compress.mjs <undo-compress-*.json> [--table fact] [--apply]`

### `memory/restore-merge.mjs`  <sub>4KB · 2026-09-25</sub>

- **干什么**：合并还原器：读 apply-merge.mjs 落下的 `undo-merge-<表>-<时间戳>.json`，一键还原整批：
- **怎么用**：`node restore-merge.mjs <undo-merge-*.json> [--table fact] [--apply]`

### `memory/stats-buckets.mjs`  <sub>2KB · 2026-09-25</sub>

- **干什么**：各层「长度分布桶」统计：用于收尾报告（超长条目还剩多少）。只读。
- **怎么用**：`node stats-buckets.mjs [db路径]`

### `memory/token-account.mjs`  <sub>8KB · 2026-09-25</sub>

- **干什么**：「每轮固定注入」总账：把 **AGENTS.md 瘦身前 ↔ 现在** 与 **记忆库整理前 ↔ 现在** 放在一起算 token。
- **怎么用**：`node token-account.mjs [--agents-before <旧版 AGENTS.md>] [--db-before <旧备份库>]`

### `memory/verify-compress-json.mjs`  <sub>5KB · 2026-09-25</sub>

- **干什么**：压缩产物独立验真（任意层，主 agent 用，**不信子代理自检**）：
- **怎么用**：`node verify-compress-json.mjs <json...> [--table topic] [--dump C1,C2]`

### `memory/verify-merge-json.mjs`  <sub>4KB · 2026-09-25</sub>

- **干什么**：合并产物独立验真（主 agent 专用，**不信子代理自检**）：
- **怎么用**：`node verify-merge-json.mjs <json> [--table fact] [--dump C1,C2]`

## render\ —— SVG 渲染与拼版（需 sharp）

### `render/check-svg.mjs`  <sub>5KB · 2026-09-22</sub>

- **干什么**：// check-svg.mjs —— 校验导出的静态 SVG：自包含性 / XML 良构性 / UTF-8 / 中文标签 / 与线上产物一致性
- **怎么用**：`node check-svg.mjs <map.html> <spider.svg> <force.svg>`

### `render/compose-grid.mjs`  <sub>4KB · 2026-09-25</sub>

- **干什么**：// compose-grid.mjs —— 把多张 SVG / PNG 按网格拼成一张对比图（**无浏览器**，用工作区现成的 sharp/librsvg）。
- **怎么用**：`node compose-grid.mjs <out.png> <cols> <cellWidth> <in1> <in2> ...`

### `render/svg2png.mjs`  <sub>2KB · 2026-09-25</sub>

- **干什么**：// svg2png.mjs —— 用工作区现成的 sharp(librsvg) 把静态 SVG 转 PNG（无浏览器）
- **怎么用**：`node svg2png.mjs <in.svg> <out.png> [density，默认 144 = 2x]`

## session\ —— 读 / 分析 dsh 会话日志

### `session/_repro-inbound.mjs`  <sub>10KB · 2026-09-25</sub>

- **干什么**：反事实对照：真实会话 → chat 快照 → 折叠组。
- **怎么用**：`node repro-inbound.mjs --fold-src <目录> [会话id子串...]   （不给会话 id = 扫全库）`

### `session/dump-session.mjs`  <sub>2KB · 2026-09-25</sub>

- **干什么**：// 只读勘察：dsh 会话 jsonl.zstd 是多帧拼接，逐帧解压后按关键词切片打印。
- **怎么用**：`node dump-session.mjs <session.vN.jsonl.zstd> <关键词> [前后行数] [每行截断]`

### `session/dump-turn.mjs`  <sub>3KB · 2026-09-25</sub>

- **干什么**：打印指定会话指定 turn 的节点序列（判断折叠范围与 memory_* 调用分布）。

### `session/list-sessions.mjs`  <sub>3KB · 2026-09-25</sub>

- **干什么**：列出全库会话：id + 标题 + 末条用户消息摘要（用于定位某段提问对应的会话）。

### `session/repro-inbound.mjs`  <sub>10KB · 2026-09-25</sub>

- **干什么**：反事实对照：真实会话 → chat 快照 → 折叠组。
- **怎么用**：`node repro-inbound.mjs --fold-src <目录> [会话id子串...]   （不给会话 id = 扫全库）`

### `session/sample-sources.mjs`  <sub>2KB · 2026-09-22</sub>

- **干什么**：// 只读勘察：按 source 分类列出一条样例文本（判断这类注入/消息的语义）。

### `session/scan-sources.mjs`  <sub>2KB · 2026-09-22</sub>

- **干什么**：// 只读勘察：统计所有 dsh 会话里 user/message 事件的 source.kind / form 分布，

### `session/turn-summary.mjs`  <sub>4KB · 2026-09-25</sub>

- **干什么**：按 turn 汇总一个会话的结构：步数 / 每步的 assistant 内容块类型 / 是否有 meow prompt / 进站消息 / 结束原因。

### `session/zstd-session.mjs`  <sub>2KB · 2026-09-25</sub>

- **干什么**：// 只读勘察：dsh 会话 jsonl.zstd 是多帧拼接，逐帧解压后按关键词切片打印。
- **怎么用**：`node zstd-session.mjs <session.vN.jsonl.zstd> <关键词> [前后行数] [每行截断]`

