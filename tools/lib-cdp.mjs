/**
 * 极简 CDP 客户端（Node ≥22 自带全局 WebSocket，无需依赖）。
 *
 * 用法：
 *   const cdp = await connectPage(9222);            // 找 type=page 的 target
 *   await cdp.send('Runtime.enable');
 *   const text = await cdp.eval('document.body.innerText');
 *   await cdp.screenshot('shots/xx.png');
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.onEvent = null;
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`CDP ${m.error.message}`));
        else resolve(m.result);
        return;
      }
      if (m.method !== undefined) {
        this.events.push({ t: Date.now(), method: m.method, params: m.params });
        if (this.events.length > 5000) this.events.shift();
        if (this.onEvent !== null) this.onEvent(m.method, m.params);
      }
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, timeoutMs);
    });
  }

  /** 求值（awaitPromise + returnByValue）；页面异常**抛出**并带原文 */
  async eval(expression, timeoutMs = 30000) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs,
    );
    if (r.exceptionDetails) {
      const txt = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`页面异常：${txt}`);
    }
    return r.result?.value;
  }

  /** 求值但**不抛**（返回 {ok, value|error}），用于探测式断言 */
  async tryEval(expression, timeoutMs = 30000) {
    try {
      return { ok: true, value: await this.eval(expression, timeoutMs) };
    } catch (err) {
      return { ok: false, error: String(err.message ?? err) };
    }
  }

  async screenshot(path, { fullPage = false } = {}) {
    const params = { format: 'png', captureBeyondViewport: fullPage };
    const r = await this.send('Page.captureScreenshot', params, 30000);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** 连到 HTTP CDP 端点上第一个 type=page 的 target */
export async function connectPage(port, { matchUrl = null } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const pages = targets.filter((t) => t.type === 'page');
  const pick =
    (matchUrl === null ? null : pages.find((t) => (t.url ?? '').includes(matchUrl))) ?? pages[0] ?? null;
  if (pick === null) throw new Error(`CDP ${port} 上没有 page target：${JSON.stringify(targets.map((t) => t.type))}`);
  const ws = new WebSocket(pick.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP ws 连接失败')), { once: true });
    setTimeout(() => reject(new Error('CDP ws 连接超时')), 10000);
  });
  const cdp = new Cdp(ws);
  cdp.target = pick;
  return cdp;
}

/** 连到主进程 Node inspector 端点（--inspect=port） */
export async function connectInspector(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const pick = targets[0];
  if (pick === undefined) throw new Error(`inspector ${port} 上没有 target`);
  const ws = new WebSocket(pick.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('inspector ws 连接失败')), { once: true });
    setTimeout(() => reject(new Error('inspector ws 连接超时')), 10000);
  });
  return new Cdp(ws);
}

/** 页面交互小工具（React 受控输入用原生 setter） */
export const js = {
  setInputByPlaceholder: (cands, value) => `(() => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    const el = inputs.find((i) => ${JSON.stringify(cands)}.some((c) => (i.placeholder || '').includes(c)));
    if (!el) return 'NOT_FOUND';
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`,
  clickByText: (text) => `(() => {
    const els = [...document.querySelectorAll('button, a, [role=button], .btn, li, div[role=tab]')];
    const el = els.find((e) => (e.innerText || '').trim() === ${JSON.stringify(text)})
      || els.find((e) => (e.innerText || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  })()`,
  pageText: `(() => (document.body ? document.body.innerText : '').replace(/\\n{2,}/g, '\\n').trim())()`,
};
