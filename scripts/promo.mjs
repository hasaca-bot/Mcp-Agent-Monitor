// Capture a short promo clip (CDP screencast → H.264 MP4) and a cover image.
// usage: node scripts/promo.mjs [baseUrl] [outDir] [seconds]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.argv[2] || 'http://127.0.0.1:7420/';
const out = process.argv[3] || 'docs/promo';
const seconds = Number(process.argv[4] || 5);
const frames = join(out, 'frames');
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

// cover: crisp 2x still
const cover = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await cover.goto(`${base}?theme=phosphor&mode=full`, { waitUntil: 'networkidle' });
await cover.waitForTimeout(2500);
await cover.screenshot({ path: join(out, 'cover.png') });
await cover.close();

await page.goto(`${base}?theme=phosphor&mode=full`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
const cdp = await page.context().newCDPSession(page);
const shots = [];
cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
  shots.push({ data, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const ms = seconds * 1000;
// one moment of motion: switch theme mid-clip (view-transition crossfade)
await page.waitForTimeout(ms * 0.55);
await page.keyboard.press('t'); // phosphor → amber
await page.waitForTimeout(ms * 0.45);
await cdp.send('Page.stopScreencast');
await browser.close();

// write frames + ffconcat with real durations
let list = 'ffconcat version 1.0\n';
shots.forEach((s, i) => {
  const f = `f${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(join(frames, f), Buffer.from(s.data, 'base64'));
  const d = i < shots.length - 1 ? Math.max(0.001, shots[i + 1].t - s.t) : 0.04;
  list += `file ${f}\nduration ${d.toFixed(4)}\n`;
});
writeFileSync(join(frames, 'list.txt'), list);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'),
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', join(out, 'promo.mp4')]);
console.log(`frames: ${shots.length} → ${join(out, 'promo.mp4')}, cover → ${join(out, 'cover.png')}`);
