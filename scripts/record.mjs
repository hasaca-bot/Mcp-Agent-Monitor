// Record a short interaction video (hover, pause, focus, theme switch).
// usage: node scripts/record.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:7420/';
const dir = process.argv[3] || 'docs/video';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
await page.goto(`${base}?theme=phosphor`);
await page.waitForTimeout(2200);
const click = async () => { await page.mouse.down(); await page.waitForTimeout(110); await page.mouse.up(); };
const hover = async (sel, i = 0) => {
  const all = await page.locator(sel).all();
  const el = all[Math.min(i, all.length - 1)];
  if (!el) return console.log('skip', sel);
  const b = await el.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 }); };
await hover('[data-act="pause"]', 1); await page.waitForTimeout(600); await click(); await page.waitForTimeout(1400);
await hover('[data-act="resume"]', 0); await page.waitForTimeout(500); await click(); await page.waitForTimeout(1200);
await hover('[data-act="focus"]', 2); await page.waitForTimeout(400); await click(); await page.waitForTimeout(2600);
await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
for (const t of ['dusk', 'glacier', 'paper', 'amber']) {
  await hover('[data-act="theme-menu"]'); await click(); await page.waitForTimeout(600);
  await hover(`[data-act="theme"][data-id="${t}"]`); await page.waitForTimeout(250); await click(); await page.waitForTimeout(1500);
}
await page.waitForTimeout(800);
await ctx.close(); await browser.close();
console.log('video saved in', dir);
