// SOLMAR BAY — tools/shots.mjs
// Takes the 4 screenshots with headless Chromium (--screenshot, 1280x720),
// converts them to JPEG (quality 78, <=256 KiB) with Python PIL, and
// reports each file's size. Usage: node tools/shots.mjs
import { spawn } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const CHROME = process.env.CHROME || '/home/hatch/chrome-testing/chrome-linux64/chrome';
const PORT = 8932;
const SHOTS = [
  ['1-cover-chase.jpg', 'chase'],
  ['2-driving.jpg', 'drive'],
  ['3-mission.jpg', 'mission'],
  ['4-start.jpg', 'start'],
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], { cwd: repo });
await new Promise((r) => setTimeout(r, 1500));
try {
  for (const [name, shot] of SHOTS) {
    const png = join(repo, 'screenshots', name.replace('.jpg', '.png'));
    const jpg = join(repo, 'screenshots', name);
    const url = `http://127.0.0.1:${PORT}/index.html?shot=${shot}`;
    const r = await run(CHROME, [
      '--headless=new', '--no-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--window-size=1280,720',
      '--hide-scrollbars', '--virtual-time-budget=9000',
      `--screenshot=${png}`, url,
    ]);
    if (!existsSync(png)) { console.log(name, 'FAILED — no png, chromium code', r.code); continue; }
    // Convert to JPEG with PIL, quality 78.
    const conv = await run('python3', ['-c',
      `from PIL import Image; im=Image.open(${JSON.stringify(png)}).convert('RGB'); im.save(${JSON.stringify(jpg)}, 'JPEG', quality=78)`,]);
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(png); } catch (e) {}
    const size = existsSync(jpg) ? statSync(jpg).size : -1;
    console.log(name, shot, size, 'bytes', size > 262144 ? 'TOO BIG' : 'ok');
  }
} finally {
  server.kill();
}
console.log('screenshots dir:', readdirSync(join(repo, 'screenshots')));
