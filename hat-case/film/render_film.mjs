// Renders the product film: frames of every shot (with and without the
// caption layer), joins the shots with dissolves, mixes narration, music and
// sound effects, and writes the deliverables to output/film.
//
// Usage (from the hat-case folder):
//   node film/render_film.mjs                  everything
//   node film/render_film.mjs --frames-only    only (re)render missing frames
//   node film/render_film.mjs --assemble-only  only build the videos and the mix
//   node film/render_film.mjs --audio-only     only the sound mix
//   node film/render_film.mjs --captions-only  only the caption layer, composited over the 3D frames
// Needs Playwright (Chromium), ffmpeg and python3 (numpy) for the music.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';
import { FILM, SHOTS, shotStarts } from './shots.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRAMES = `${ROOT}film/frames`;
const OUT = `${ROOT}output/film`;
const AUDIO = `${ROOT}film/audio`;
const args = new Set(process.argv.slice(2));
const workers = 3;
const { starts, total } = shotStarts();
const pad = (n) => String(n).padStart(4, '0');
const dir = (kind, i) => `${FRAMES}/${kind}/shot${String(i).padStart(2, '0')}`;
const ff = (a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });

async function renderFrames() {
  const { chromium } = require('playwright');
  const jobs = [];
  for (let i = 0; i < SHOTS.length; i++) {
    const n = Math.round(SHOTS[i].duration * FILM.fps);
    for (const k of ['final', 'clean', 'captions']) await mkdir(dir(k, i), { recursive: true });
    for (let f = 0; f < n; f++) if (!existsSync(`${dir('final', i)}/${pad(f)}.png`)) jobs.push([i, f]);
  }
  console.log(`${jobs.length} frames to render`);
  if (!jobs.length) return;
  const port = 8000 + Math.floor(Math.random() * 900);
  const server = await startServer(port);
  const started = Date.now();
  let done = 0;
  const worker = async (list) => {
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
    await page.goto(`http://localhost:${port}/film/index.html?w=${FILM.width}&h=${FILM.height}`);
    await page.waitForFunction(() => window.film?.ready, null, { timeout: 300000 });
    for (const [i, f] of list) {
      const r = await page.evaluate(([i, t]) => window.film.renderFrame(i, t, true), [i, f / FILM.fps]);
      await writeFile(`${dir('final', i)}/${pad(f)}.png`, Buffer.from(r.frame.split(',')[1], 'base64'));
      await writeFile(`${dir('clean', i)}/${pad(f)}.png`, Buffer.from(r.clean.split(',')[1], 'base64'));
      await writeFile(`${dir('captions', i)}/${pad(f)}.png`, Buffer.from(r.overlay.split(',')[1], 'base64'));
      if (++done % 60 === 0) {
        const rate = (Date.now() - started) / 1000 / done;
        console.log(`${done}/${jobs.length} frames, ~${Math.round(((jobs.length - done) * rate) / 60)} min left`);
      }
    }
    await browser.close();
  };
  await Promise.all(Array.from({ length: workers }, (_, w) => worker(jobs.filter((_, k) => k % workers === w))));
  server.close();
}

// Join the shots of one layer with dissolves (and fade the end to black)
function assembleLayer(kind, dst, codecArgs, alpha = false) {
  const inputs = [];
  SHOTS.forEach((_, i) => inputs.push('-framerate', String(FILM.fps), '-i', `${dir(kind, i)}/%04d.png`));
  let chain = '';
  let last = '[0:v]';
  for (let i = 1; i < SHOTS.length; i++) {
    const label = `[x${i}]`;
    chain += `${last}[${i}:v]xfade=transition=fade:duration=${FILM.dissolve}:offset=${starts[i].toFixed(3)}${label};`;
    last = label;
  }
  const fmt = alpha ? 'format=rgba' : 'format=yuv420p';
  const fade = alpha
    ? `fade=t=out:st=${(total - FILM.fadeOut).toFixed(3)}:d=${FILM.fadeOut}:alpha=1`
    : `fade=t=out:st=${(total - FILM.fadeOut).toFixed(3)}:d=${FILM.fadeOut}`;
  chain += `${last}${fade},${fmt}[v]`;
  ff([...inputs, '-filter_complex', chain, '-map', '[v]', '-r', String(FILM.fps), ...codecArgs, dst]);
}

// Narration, music (ducked under the voice) and sound effects
function mixAudio(dst) {
  const music = `${AUDIO}/music/music.wav`;
  if (!existsSync(music)) execFileSync('python3', [`${AUDIO}/make_music.py`, String(total), music], { stdio: 'inherit' });
  const SFX_GAIN = { reveal: -14, lidOpen: 4, place: 10, lidClose: -2 };
  const inputs = ['-i', music];
  const parts = [];
  const voices = [];
  const sfx = [];
  let k = 1;
  SHOTS.forEach((s, i) => {
    for (const [line, at] of s.voice || []) {
      inputs.push('-i', `${AUDIO}/narration/${line}.mp3`);
      const ms = Math.round((starts[i] + at) * 1000);
      parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${k}]`);
      voices.push(`[v${k}]`);
      k++;
    }
    for (const [name, at] of s.sfx || []) {
      inputs.push('-i', `${AUDIO}/sfx/${name}.mp3`);
      const ms = Math.round((starts[i] + at) * 1000);
      parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${SFX_GAIN[name] ?? 0}dB,adelay=${ms}|${ms}[s${k}]`);
      sfx.push(`[s${k}]`);
      k++;
    }
  });
  const graph = [
    ...parts,
    `${voices.join('')}amix=inputs=${voices.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total},asplit=2[voice][key]`,
    `[0:a]aresample=48000,volume=-12dB,atrim=0:${total}[mus]`,
    `[mus][key]sidechaincompress=threshold=0.03:ratio=4:attack=60:release=700[duck]`,
    `${sfx.join('')}amix=inputs=${sfx.length}:normalize=0,apad=whole_dur=${total},atrim=0:${total}[fx]`,
    `[voice][duck][fx]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`,
  ].join(';');
  ff([...inputs, '-filter_complex', graph, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', dst]);
}

// Regenerate only the caption layer (fast, no 3D), then composite it over the clean frames
async function renderCaptions() {
  const { chromium } = require('playwright');
  const port = 8000 + Math.floor(Math.random() * 900);
  const server = await startServer(port);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://localhost:${port}/film/index.html?w=${FILM.width}&h=${FILM.height}`);
  await page.waitForFunction(() => window.film?.ready, null, { timeout: 300000 });
  for (let i = 0; i < SHOTS.length; i++) {
    const n = Math.round(SHOTS[i].duration * FILM.fps);
    for (let f = 0; f < n; f++) {
      const url = await page.evaluate(([i, t]) => window.film.renderOverlay(i, t), [i, f / FILM.fps]);
      await writeFile(`${dir('captions', i)}/${pad(f)}.png`, Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`captions shot ${i} done`);
  }
  await browser.close();
  server.close();
  execFileSync('python3', [`${ROOT}film/composite.py`], { stdio: 'inherit' });
}

if (args.has('--captions-only')) {
  await renderCaptions();
  process.exit(0);
}
if (args.has('--audio-only')) {
  await mkdir(`${OUT}/source`, { recursive: true });
  mixAudio(`${OUT}/source/audio-mix.wav`);
  process.exit(0);
}
if (!args.has('--assemble-only')) await renderFrames();
if (!args.has('--frames-only')) {
  await mkdir(`${OUT}/source`, { recursive: true });
  const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p'];
  assembleLayer('final', `${OUT}/source/video-with-captions.mp4`, x264);
  assembleLayer('clean', `${OUT}/source/video-clean.mp4`, x264);
  assembleLayer('captions', `${OUT}/source/captions-layer.mov`, ['-c:v', 'qtrle'], true);
  mixAudio(`${OUT}/source/audio-mix.wav`);
  ff([
    '-i', `${OUT}/source/video-with-captions.mp4`, '-i', `${OUT}/source/audio-mix.wav`,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart',
    `${OUT}/prester-hat-case-film.mp4`,
  ]);
  console.log(`saved output/film/prester-hat-case-film.mp4 (${total.toFixed(1)} s)`);
}
