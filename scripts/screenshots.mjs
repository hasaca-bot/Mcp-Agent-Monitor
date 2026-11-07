// Capture the dashboard in every theme at desktop resolution.
// usage: node scripts/screenshots.mjs [baseUrl] [outDir] [scale]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:7420/';
const out = process.argv[3] || 'docs/screenshots';
const scale = Number(process.argv[4] || 1);
const themes = (process.env.THEMES || 'phosphor,amber,glacier,dusk,graphite,paper').split(',');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
for (const t of themes) {
  await page.goto(`${base}${base.includes('?') ? '&' : '?'}theme=${t}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/theme-${t}.png` });
  console.log('saved', t);
}
if (process.env.FOCUS) {
  await page.goto(`${base}${base.includes('?') ? '&' : '?'}theme=${themes[0]}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.keyboard.press('3');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/focus-mode.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.click('[data-act="theme-menu"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/theme-menu.png` });
  console.log('saved focus + menu');
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
