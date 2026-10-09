// Renders still views of the plastic case: node tools/plastic_preview.mjs views.json outdir
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { startServer } from '../serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [viewsFile, outDir, size = '1280x720', extra = ''] = process.argv.slice(2);
const views = JSON.parse(await readFile(viewsFile, 'utf8'));
const [w, h] = size.split('x').map(Number);
await mkdir(outDir, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = await startServer(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.error(m.text()));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/film/plastic/preview.html?w=${w}&h=${h}&${extra}`);
await page.waitForFunction(() => window.preview?.ready, null, { timeout: 300000 });
console.log('ready in', Date.now() - t0, 'ms', 'hat lift', await page.evaluate(() => window.preview.hatLift));
for (const [name, v] of Object.entries(views)) {
  const r = await page.evaluate((v) => window.preview.view(v), v);
  await writeFile(`${outDir}/${name}.jpg`, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(name, JSON.stringify(r.ms), 'ms');
}
await browser.close();
server.close();
