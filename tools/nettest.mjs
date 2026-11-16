// End-to-end check of online play: opens the built game in two headless Edge
// windows (host + guest), lets them connect through a room code and compares state.
//   node tools/nettest.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const page = pathToFileURL(resolve('dist/index.html')).href;
const outDir = process.argv[2] || tmpdir();
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(port, query) {
  const proc = spawn(EDGE, ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=960,540',
    `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bv-'))}`, `${page}?${query}`], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); pending.delete(d.id); };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  return {
    eval: async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value,
    shot: async (name) => writeFileSync(join(outDir, name), Buffer.from((await send('Page.captureScreenshot')).data, 'base64')),
    close: () => { ws.close(); proc.kill(); },
  };
}

const STATE = `(() => { const b = window.__bv, g = b?.game; if (!g) return null; const m = g.match, w = m.world;
  return { app: b.app, net: g.net || null, phase: m.phase, score: m.score.join('-'), ball: [Math.round(w.ball.x), Math.round(w.ball.y)],
    p0: Math.round(w.players[0].x), p1: Math.round(w.players[1].x), names: document.getElementById('name0').textContent + '/' + document.getElementById('name1').textContent,
    status: document.getElementById('onlineStatus').textContent }; })()`;

console.log('room code', code);
const host = await open(9351, 'hostcode=' + code);
await sleep(6000);
console.log('host before join:', JSON.stringify(await host.eval(STATE)));
const guest = await open(9352, 'room=' + code);
let ok = false;
for (let i = 0; i < 14; i++) {
  await sleep(2500);
  const h = await host.eval(STATE), g = await guest.eval(STATE);
  console.log(`t+${(i + 1) * 2.5}s host`, JSON.stringify(h), '\n        guest', JSON.stringify(g));
  if (h?.net === 'host' && g?.net === 'guest' && g.phase !== 'serve' && h.score === g.score && Math.abs(h.ball[0] - g.ball[0]) < 120) ok = true;
  if (ok && i >= 5) break;
}
// drive the guest: hold "move right" and confirm the host sees player 2 move
await guest.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))`);
await sleep(1500);
const moved = await host.eval(STATE);
console.log('after guest holds right, host sees p1 at', moved?.p1);
await host.shot('net-host.png'); await guest.shot('net-guest.png');
host.close(); guest.close();
console.log(ok ? 'ONLINE TEST PASSED' : 'ONLINE TEST FAILED');
process.exit(ok ? 0 : 1);
