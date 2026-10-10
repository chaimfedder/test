// Renders the short forming-and-trimming film: frames of every shot (3D frame
// and caption layer separately), joins the shots with dissolves, mixes
// narration and a soft music bed, writes subtitles and the deliverables to
// output/making-film.
//
// Usage (from the hat-case folder):
//   node film/making/render.mjs                  everything
//   node film/making/render.mjs --frames-only    only (re)render missing frames
//   node film/making/render.mjs --captions-only  only the caption layer (fast), then assemble
//   node film/making/render.mjs --assemble-only  only build the videos, the mix and the subtitles
//   node film/making/render.mjs --srt-only       only the subtitle file
// Options: --workers=N (default 3)
// Needs Playwright (Chromium), ffmpeg and python3 (numpy) for the music.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../serve.mjs';
import { FILM, SHOTS, shotStarts, subtitleCards } from './shots.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FRAMES = `${ROOT}film/making/frames`;
const OUT = `${ROOT}output/making-film`;
const AUDIO = `${ROOT}film/making/audio`;
const args = new Set(process.argv.slice(2));
const workers = Number((process.argv.find((a) => a.startsWith('--workers=')) || '--workers=3').split('=')[1]);
const { starts, total } = shotStarts();
const pad = (n) => String(n).padStart(4, '0');
const dir = (kind, i) => `${FRAMES}/${kind}/shot${String(i).padStart(2, '0')}`;
const ff = (a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
const frameCount = (i) => Math.round(SHOTS[i].duration * FILM.fps);

async function withPages(n, fn) {
  const { chromium } = require('playwright');
  const port = 8000 + Math.floor(Math.random() * 900);
  const server = await startServer(port);
  const run = async (w) => {
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
    await page.goto(`http://localhost:${port}/film/making/index.html?w=${FILM.width}&h=${FILM.height}`);
    await page.waitForFunction(() => window.film?.ready, null, { timeout: 600000 });
    await fn(page, w);
    await browser.close();
  };
  await Promise.all(Array.from({ length: n }, (_, w) => run(w)));
  server.close();
}

async function renderFrames(captionsOnly = false) {
  const jobs = [];
  for (let i = 0; i < SHOTS.length; i++) {
    for (const k of ['clean', 'captions']) await mkdir(dir(k, i), { recursive: true });
    for (let f = 0; f < frameCount(i); f++) {
      if (captionsOnly || !existsSync(`${dir('clean', i)}/${pad(f)}.jpg`)) jobs.push([i, f]);
    }
  }
  console.log(`${jobs.length} frames to render`);
  if (!jobs.length) return;
  // interleave shots so every worker gets a mix of light and heavy frames
  const started = Date.now();
  let done = 0;
  await withPages(captionsOnly ? 1 : workers, async (page, w) => {
    const n = captionsOnly ? 1 : workers;
    for (let j = w; j < jobs.length; j += n) {
      const [i, f] = jobs[j];
      if (captionsOnly) {
        const url = await page.evaluate(([i, t]) => window.film.renderOverlay(i, t), [i, f / FILM.fps]);
        await writeFile(`${dir('captions', i)}/${pad(f)}.png`, Buffer.from(url.split(',')[1], 'base64'));
      } else {
        const r = await page.evaluate(([i, t]) => window.film.renderFrame(i, t), [i, f / FILM.fps]);
        await writeFile(`${dir('captions', i)}/${pad(f)}.png`, Buffer.from(r.overlay.split(',')[1], 'base64'));
        await writeFile(`${dir('clean', i)}/${pad(f)}.jpg`, Buffer.from(r.clean.split(',')[1], 'base64'));
      }
      if (++done % 60 === 0) {
        const rate = (Date.now() - started) / 1000 / done;
        console.log(`${done}/${jobs.length} frames, ~${Math.round(((jobs.length - done) * rate) / 60)} min left`);
      }
    }
  });
}

// One video per shot (captions over the 3D frames), then dissolves between shots
function assemble() {
  const tmp = `${FRAMES}/shots`;
  execFileSync('mkdir', ['-p', tmp, `${OUT}/source`]);
  const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p'];
  for (let i = 0; i < SHOTS.length; i++) {
    const fr = ['-framerate', String(FILM.fps)];
    ff([...fr, '-i', `${dir('clean', i)}/%04d.jpg`, ...fr, '-i', `${dir('captions', i)}/%04d.png`, '-filter_complex', '[0:v][1:v]overlay=format=auto,format=yuv420p[v]', '-map', '[v]', ...x264, '-crf', '12', `${tmp}/final${i}.mp4`]);
    ff([...fr, '-i', `${dir('clean', i)}/%04d.jpg`, '-vf', 'format=yuv420p', ...x264, '-crf', '12', `${tmp}/clean${i}.mp4`]);
  }
  const join = (kind, dst) => {
    const inputs = [];
    SHOTS.forEach((_, i) => inputs.push('-i', `${tmp}/${kind}${i}.mp4`));
    let chain = '';
    let last = '[0:v]';
    for (let i = 1; i < SHOTS.length; i++) {
      chain += `${last}[${i}:v]xfade=transition=fade:duration=${FILM.dissolve}:offset=${starts[i].toFixed(3)}[x${i}];`;
      last = `[x${i}]`;
    }
    chain += `${last}fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - FILM.fadeOut).toFixed(3)}:d=${FILM.fadeOut},format=yuv420p[v]`;
    ff([...inputs, '-filter_complex', chain, '-map', '[v]', '-r', String(FILM.fps), ...x264, dst]);
  };
  join('final', `${OUT}/source/video-with-captions.mp4`);
  join('clean', `${OUT}/source/video-clean.mp4`);
}

// Narration on the timeline, soft music bed ducked under the voice
function mixAudio(dst) {
  const music = `${AUDIO}/music.wav`;
  if (!existsSync(music)) execFileSync('python3', [`${ROOT}film/audio/make_music.py`, String(total), music], { stdio: 'inherit' });
  const inputs = ['-i', music];
  const parts = [];
  const voices = [];
  let k = 1;
  SHOTS.forEach((s, i) => {
    for (const [line, at] of s.voice || []) {
      inputs.push('-i', `${AUDIO}/narration/${line}.mp3`);
      const ms = Math.round((starts[i] + at) * 1000);
      parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${k}]`);
      voices.push(`[v${k}]`);
      k++;
    }
  });
  const graph = [
    ...parts,
    `${voices.join('')}amix=inputs=${voices.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total},asplit=2[voice][key]`,
    `[0:a]aresample=48000,volume=-17dB,atrim=0:${total},afade=t=in:d=1.5,afade=t=out:st=${(total - 2.5).toFixed(2)}:d=2.5[mus]`,
    `[mus][key]sidechaincompress=threshold=0.03:ratio=5:attack=60:release=800[duck]`,
    `[voice][duck]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`,
  ].join(';');
  ff([...inputs, '-filter_complex', graph, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', dst]);
  // narration alone (for checking and editing)
  const g2 = [...parts, `${voices.join('')}amix=inputs=${voices.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total}[out]`].join(';');
  ff([...inputs.slice(2), '-filter_complex', g2.replace(/\[(\d+):a\]/g, (m, n) => `[${Number(n) - 1}:a]`), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', `${OUT}/source/narration-only.wav`]);
}

function srtTime(s) {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
async function writeSubtitles() {
  const cards = subtitleCards().map((c, i, a) => ({ ...c, end: i + 1 < a.length ? Math.min(c.end, a[i + 1].start - 0.05) : c.end }));
  const srt = cards.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n‫${c.text}‬\n`).join('\n');
  await writeFile(`${OUT}/hat-case-forming-and-trimming.he.srt`, srt);
}

if (args.has('--srt-only')) {
  await writeSubtitles();
  process.exit(0);
}
if (args.has('--captions-only')) await renderFrames(true);
else if (!args.has('--assemble-only')) await renderFrames(false);
if (!args.has('--frames-only')) {
  await mkdir(`${OUT}/source`, { recursive: true });
  assemble();
  mixAudio(`${OUT}/source/audio-mix.wav`);
  await writeSubtitles();
  ff([
    '-i', `${OUT}/source/video-with-captions.mp4`, '-i', `${OUT}/source/audio-mix.wav`,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart',
    `${OUT}/hat-case-forming-and-trimming.mp4`,
  ]);
  console.log(`saved output/making-film/hat-case-forming-and-trimming.mp4 (${total.toFixed(1)} s)`);
}
