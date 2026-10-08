// Renders the product video: PNG frames from video/index.html, then MP4 with ffmpeg.
// Also writes the animated GLB (case + hat + the whole sequence) for editing.
//
// Usage (from the hat-case folder):  node video/render_video.mjs [--workers 3] [--from 0] [--to 539]
// Needs Playwright with Chromium and ffmpeg on the PATH.

import { createRequire } from 'node:module';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';
import { VIDEO } from './timeline.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRAMES = `${ROOT}video/frames`;
const OUT = `${ROOT}output/video`;
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const total = Math.round(VIDEO.duration * VIDEO.fps);
const from = arg('from', 0);
const to = arg('to', total - 1);
const workers = arg('workers', 3);

await mkdir(FRAMES, { recursive: true });
await mkdir(OUT, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = await startServer(port);
const url = `http://localhost:${port}/video/index.html?w=${VIDEO.width}&h=${VIDEO.height}`;
const launch = () => chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function openScene(browser) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.video?.ready, null, { timeout: 300000 });
  return page;
}

async function worker(id, frames) {
  const browser = await launch();
  const page = await openScene(browser);
  for (const i of frames) {
    const data = await page.evaluate((t) => {
      window.video.setTime(t);
      return window.video.frame();
    }, i / VIDEO.fps);
    await writeFile(`${FRAMES}/${String(i).padStart(4, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
    if (i % 30 === 0) console.log(`worker ${id}: frame ${i}`);
  }
  await browser.close();
}

try {
  const list = [];
  for (let i = from; i <= to; i++) list.push(i);
  const chunks = Array.from({ length: workers }, (_, w) => list.filter((_, k) => k % workers === w));
  const started = Date.now();
  await Promise.all(chunks.map((c, w) => worker(w, c)));
  console.log(`frames done in ${((Date.now() - started) / 60000).toFixed(1)} min`);

  const have = (await readdir(FRAMES)).filter((f) => f.endsWith('.png')).length;
  if (have >= total) {
    const mp4 = `${OUT}/hat-case-product.mp4`;
    execFileSync('ffmpeg', [
      '-y', '-framerate', String(VIDEO.fps), '-i', `${FRAMES}/%04d.png`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', mp4,
    ], { stdio: 'inherit' });
    console.log(`saved ${mp4}`);
  } else {
    console.log(`${have}/${total} frames present, MP4 not encoded yet`);
  }

  // Animated GLB for editing
  const browser = await launch();
  const page = await openScene(browser);
  const { b64 } = await page.evaluate(() => window.video.exportAnimatedBase64());
  await writeFile(`${OUT}/hat-case-animated.glb`, Buffer.from(b64, 'base64'));
  console.log('saved output/video/hat-case-animated.glb');
  await browser.close();
} finally {
  server.close();
}
