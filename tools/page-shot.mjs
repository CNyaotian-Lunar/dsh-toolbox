// page-shot.mjs —— 无头浏览器「截图 + 采集页面错误 + 跑断言」。
// 用本机 Edge/Chrome + CDP（= lib-cdp.mjs），**headless + 独立 user-data-dir + 独立端口** ⇒ 不弹窗、不抢焦点、不碰用户正在用的浏览器。
//
// 用法：
//   node page-shot.mjs --url <file:///… 或 http://…> --out <png 路径>
//        [--width 1600] [--height 1000] [--wait 2500] [--full] [--eval "<在页面里跑的 JS>"] [--keep]
// 退出码：0 = 正常截图；1 = 截图成功但页面有 console 错误/异常；2 = 参数或启动失败
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectPage } from './lib-cdp.mjs'

// 浏览器可执行文件：`DSH_BROWSER` 优先，其后是 Edge / Chrome 的常规安装位置（非个人目录）
const EDGE = [
  process.env.DSH_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => existsSync(p))
if (EDGE === undefined) { console.error('找不到 Edge/Chrome（可用 DSH_BROWSER 指定可执行文件路径）'); process.exit(2) }

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def
}
const has = (name) => process.argv.includes(`--${name}`)

const url = arg('url')
const out = arg('out')
if (!url || !out) { console.error('用法：node page-shot.mjs --url <url> --out <png> [--width 1600 --height 1000 --wait 2500 --full --eval "js"]'); process.exit(2) }
const W = Number(arg('width', 1600))
const H = Number(arg('height', 1000))
const WAIT = Number(arg('wait', 2500))
const PORT = Number(arg('port', 9333))
const keep = has('keep')

const profile = mkdtempSync(join(tmpdir(), 'dsh-pageshot-'))
const child = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore', detached: false })

function killEdge() {
  // Edge 会派生一堆子进程；用 taskkill 按 pid 树收（不按命令行文本杀！）。
  // 🩸 顺序要紧：**先** taskkill、后 child.kill()。taskkill 得靠还活着的 pid 去枚举子进程树；
  //    若先杀主进程，taskkill 找不到该 pid ⇒ 边缘子进程继续占着 profile ⇒ 下面删目录失败、残留临时目录。
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  } catch { /* 进程可能已经退了，退回 child.kill() */ }
  try { child.kill() } catch { /* ignore */ }
}
/** 删临时 profile：子进程刚被收掉时句柄往往还没释放（实测偶发 EPERM）⇒ 必须重试，不能一次失败就静默吞掉 */
const rmProfile = async (tries = 20, gapMs = 250) => {
  for (let i = 0; i < tries; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return true } catch { /* 还被占，稍等再试 */ }
    await new Promise((r) => setTimeout(r, gapMs))
  }
  return false
}
let cleaned = false
const cleanup = () => { // 兜底：异常退出 / SIGINT 路径（同步、尽力而为）
  if (cleaned || keep) return
  cleaned = true
  killEdge()
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* 留给系统清 */ }
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

// 等 CDP 端点起来
const t0 = Date.now()
let ready = false
while (Date.now() - t0 < 20000) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    if (r.ok) { ready = true; break }
  } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!ready) { console.error(`Edge 的 CDP 端点 20 秒内没起来（端口 ${PORT}）`); process.exit(2) }

const cdp = await connectPage(PORT)
const problems = []
cdp.onEvent = (method, params) => {
  if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
    problems.push(`console.${params.type}: ${(params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`)
  }
  if (method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? '').slice(0, 300)}`)
  }
  if (method === 'Log.entryAdded' && params.entry?.level === 'error') {
    problems.push(`log.error: ${String(params.entry.text ?? '').slice(0, 300)}`)
  }
}

await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })

const loaded = new Promise((resolve) => {
  const prev = cdp.onEvent
  cdp.onEvent = (m, p) => { prev?.(m, p); if (m === 'Page.loadEventFired') resolve(true) }
  setTimeout(() => resolve(false), 25000)
})
await cdp.send('Page.navigate', { url })
const didLoad = await loaded
// 给前端框架/动画留时间（设计图常靠 JS 现画）。
// 🩸 教训：有「入场动画 / 力导向布局」的页面，固定等 3.5s 可能仍是一片空白 ⇒ 优先用 --waitFor/--waitUntil 等条件。
await new Promise((r) => setTimeout(r, WAIT))

const waitFor = arg('waitFor')
if (waitFor) {
  const t = Date.now()
  let ok = false
  while (Date.now() - t < 20000) {
    const r = await cdp.tryEval(`!!document.querySelector(${JSON.stringify(waitFor)})`)
    if (r.ok && r.value === true) { ok = true; break }
    await new Promise((res) => setTimeout(res, 250))
  }
  if (!ok) problems.push(`waitFor 超时（20s）：${waitFor}`)
}
const waitUntil = arg('waitUntil')
if (waitUntil) {
  const t = Date.now()
  let ok = false
  while (Date.now() - t < 20000) {
    const r = await cdp.tryEval(`(() => { try { return !!(${waitUntil}) } catch { return false } })()`)
    if (r.ok && r.value === true) { ok = true; break }
    await new Promise((res) => setTimeout(res, 250))
  }
  if (!ok) problems.push(`waitUntil 超时（20s）：${waitUntil}`)
}

const info = await cdp.tryEval(`(() => ({
  title: document.title,
  url: location.href,
  bodyText: (document.body?.innerText ?? '').slice(0, 400),
  elements: document.querySelectorAll('*').length,
  svg: document.querySelectorAll('svg').length,
  canvas: document.querySelectorAll('canvas').length,
  scrollW: document.documentElement.scrollWidth,
  scrollH: document.documentElement.scrollHeight,
}))()`)

let custom = null
const customJs = arg('eval')
if (customJs) custom = await cdp.tryEval(customJs)

await cdp.screenshot(out, { fullPage: has('full') })
cdp.close()

const report = {
  url, out, didLoad, viewport: `${W}x${H}`, waitMs: WAIT,
  page: info.ok ? info.value : { error: info.error },
  custom: custom === null ? undefined : (custom.ok ? custom.value : { error: custom.error }),
  problems,
}
console.log(JSON.stringify(report, null, 1))
if (!keep) {
  killEdge()
  cleaned = true
  if (!(await rmProfile())) console.error(`⚠️ 临时 profile 没删掉（可能还被 Edge 子进程占着）：${profile}`)
}
process.exit(problems.length > 0 ? 1 : 0)
