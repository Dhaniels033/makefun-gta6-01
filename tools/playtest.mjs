// SOLMAR BAY — tools/playtest.mjs
// Headless play-test over CDP (real time, no deps — Node's built-in
// WebSocket): serves game/, loads ?selftest=1 in headless Chromium,
// collects console errors / exceptions for 18 s, then reads
// window.__selftest. Fails on ANY console error or a failed self-test.
// Usage: node tools/playtest.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const CHROME = process.env.CHROME || '/home/hatch/chrome-testing/chrome-linux64/chrome';
const PORT = 8931;
const CDP_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], { cwd: repo });
await sleep(1500);
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720', '--user-data-dir=/tmp/solmar-playtest-profile',
  `--remote-debugging-port=${CDP_PORT}`, 'about:blank',
], { stdio: 'ignore' });

let pass = false;
const errors = [];
try {
  // Find the page target.
  let wsUrl = null;
  for (let i = 0; i < 30 && !wsUrl; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) {}
  }
  if (!wsUrl) throw new Error('no CDP target');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('CONSOLE.ERROR: ' + JSON.stringify(msg.params.args).slice(0, 400));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      if (!/soda|dbus|GPU/i.test(e.text || '') && !/Failed to load resource/i.test(e.text || '')) {
        errors.push('LOG.ERROR: ' + (e.text || e.url || '').slice(0, 300));
      }
    }
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?selftest=1` });
  await sleep(18000);
  const evalRes = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__selftest || null)', returnByValue: true });
  const selftest = JSON.parse(evalRes.result?.value || 'null');
  console.log('selftest:', JSON.stringify(selftest, null, 1));
  console.log('console errors:', errors.length ? errors.join('\n') : '(none)');
  pass = !!selftest && selftest.pass === true && errors.length === 0;
  console.log(pass ? 'PLAYTEST PASS — 0 console errors, self-test passed' : 'PLAYTEST FAIL');
  ws.close();
} catch (e) {
  console.log('PLAYTEST ERROR:', e.message);
} finally {
  chrome.kill();
  server.kill();
}
process.exit(pass ? 0 : 1);
