// Renders index.html to video, frame by frame.
//
//   node render.mjs                     → 42195-launch.mp4 (1080p60, with soundtrack.wav)
//   node render.mjs --stills 0.4,4.6    → stills/t-0.40.png, stills/t-4.60.png
//
// Each output frame averages SUB sub-frames spread across a 180° shutter,
// which is real motion blur rather than a filter guess. Workers render
// contiguous chunks in parallel; ffmpeg blends and encodes each chunk.

import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(join(process.execPath, '../../lib/node_modules/playwright'))); }

const ROOT = dirname(fileURLToPath(import.meta.url));
const FPS = 60, DURATION = 15, SUB = Number(process.env.SUB || 4), SHUTTER = 0.5;
const WORKERS = Number(process.env.WORKERS || 4);
const OUT = join(ROOT, process.env.OUT || '42195-launch.mp4');

const TYPES = { '.html': 'text/html', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) throw new Error('outside root');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?render`;

const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--hide-scrollbars'] });
async function page() {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.error('page error:', e.message));
  await p.goto(URL_);
  await p.waitForFunction(() => window.__ready === true);
  return p;
}
const shot = (p, t) => p.evaluate(t => window.__seek(t), t).then(() => p.screenshot({ type: 'jpeg', quality: 96 }));

const args = process.argv.slice(2);
if (args[0] === '--stills') {
  await mkdir(join(ROOT, 'stills'), { recursive: true });
  const p = await page();
  for (const t of args[1].split(',').map(Number)) {
    await p.evaluate(t => window.__seek(t), t);
    await p.screenshot({ path: join(ROOT, 'stills', `t-${t.toFixed(2)}.png`) });
    console.log('still', t);
  }
  await browser.close(); server.close();
  process.exit(0);
}

const FRAMES = FPS * DURATION;
const tmp = join(ROOT, '.render');
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
const per = Math.ceil(FRAMES / WORKERS);
const started = Date.now();
let done = 0;

async function chunk(w) {
  const f0 = w * per, f1 = Math.min(FRAMES, f0 + per);
  const p = await page();
  const seg = join(tmp, `seg${w}.mkv`);
  // blend each run of SUB sub-frames into one frame, keep the last of each run
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS * SUB), '-i', '-',
    '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv444p', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = f0; f < f1; f++) {
    for (let k = 0; k < SUB; k++) {
      const t = Math.max(0, (f + ((k + 0.5) / SUB - 0.5) * SHUTTER) / FPS);
      const buf = await shot(p, t);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    done++;
    if (done % 30 === 0) {
      const el = (Date.now() - started) / 1000;
      console.log(`${done}/${FRAMES} frames · ${el.toFixed(0)}s · eta ${(el / done * (FRAMES - done)).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c ? rej(new Error('ffmpeg ' + c)) : res()));
  await p.close();
  return seg;
}

const segs = await Promise.all(Array.from({ length: WORKERS }, (_, w) => chunk(w)));
await browser.close(); server.close();
await writeFile(join(tmp, 'list.txt'), segs.map(s => `file '${s}'`).join('\n'));
const audio = join(ROOT, 'soundtrack.wav');
await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-i', audio,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-tune', 'film', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '320k', '-shortest', OUT], { stdio: 'inherit' });
  ff.on('close', c => c ? rej(new Error('ffmpeg ' + c)) : res());
});
await rm(tmp, { recursive: true, force: true });
console.log(`wrote ${OUT} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
