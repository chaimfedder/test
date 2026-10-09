// Preview frames of the plastic film: node tools/plastic_film_preview.mjs outdir WxH shot:t [shot:t ...]
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { startServer } from '../serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [outDir, size, ...items] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
await mkdir(outDir, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = await startServer(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && !m.text().includes('GPU stall') && console.error(m.text()));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/film/plastic/index.html?w=${w}&h=${h}`);
await page.waitForFunction(() => window.film?.ready, null, { timeout: 600000 });
console.log('ready in', Date.now() - t0, 'ms; phiRest', await page.evaluate(() => window.film.phiRest));
const shots = await page.evaluate(() => window.film.shots);
for (const it of items) {
  const [id, t] = it.split(':');
  const i = shots.findIndex((s) => s.id === id);
  const t1 = Date.now();
  const url = await page.evaluate(([i, t]) => window.film.renderPreview(i, t), [i, Number(t)]);
  await writeFile(`${outDir}/${id}_${t}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(it, Date.now() - t1, 'ms');
}
await browser.close();
server.close();
