// Renders PNG views, exports the GLB and re-opens it to check materials/textures.
// Usage (from the hat-case folder):  node tools/render.mjs
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${ROOT}output`;
const SIZE = { width: 1600, height: 1600 };
const VIEWS = { front: 'front', side: 'side', 'three-quarter': 'threeQuarter', back: 'back' };

// PNG straight from the WebGL canvas (the page keeps its drawing buffer)
async function grab(p) {
  const url = await p.evaluate(() => {
    window.hatCase.renderNow();
    return document.querySelector('canvas').toDataURL('image/png');
  });
  return Buffer.from(url.split(',')[1], 'base64');
}

const port = 8000 + Math.floor(Math.random() * 900);
const server = await startServer(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: SIZE });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));

try {
  await page.goto(`http://localhost:${port}/index.html?capture=1`);
  await page.waitForFunction(() => window.hatCase?.ready, null, { timeout: 120000 });
  await mkdir(`${OUT}/renders`, { recursive: true });

  console.log('parts:', JSON.stringify(await page.evaluate(() => window.hatCase.stats()), null, 1));

  for (const [file, view] of Object.entries(VIEWS)) {
    await page.evaluate((v) => {
      window.hatCase.setView(v);
      window.hatCase.renderNow();
    }, view);
    await writeFile(`${OUT}/renders/${file}.png`, await grab(page));
    console.log(`saved output/renders/${file}.png`);
  }

  const b64 = await page.evaluate(() => window.hatCase.exportBase64());
  const glb = Buffer.from(b64, 'base64');
  await writeFile(`${OUT}/hat-case.glb`, glb);
  console.log(`saved output/hat-case.glb (${(glb.length / 1024 / 1024).toFixed(2)} MB)`);

  // Re-open the exported file in a fresh page and check what came back
  await page.close();
  const check = await browser.newPage({ viewport: SIZE });
  await check.goto(`http://localhost:${port}/index.html?capture=1`);
  await check.waitForFunction(() => window.hatCase?.ready, null, { timeout: 120000 });
  const report = await check.evaluate((data) => window.hatCase.loadGLB(data), b64);
  console.log('re-import:', JSON.stringify(report, null, 1));
  const verifyDir = process.env.VERIFY_DIR;
  if (verifyDir) {
    for (const view of ['front', 'threeQuarter']) {
      await check.evaluate((v) => {
        window.hatCase.setView(v);
        window.hatCase.renderNow();
      }, view);
      await writeFile(`${verifyDir}/glb-reimport-${view}.png`, await grab(check));
    }
  }
  if (!report.textures.length) throw new Error('GLB re-import: logo texture missing');
} finally {
  if (errors.length) console.log('browser messages:\n' + errors.join('\n'));
  await browser.close();
  server.close();
}
