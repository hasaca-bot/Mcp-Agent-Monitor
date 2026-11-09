const { chromium, devices } = require('playwright');
(async () => {
  const [url, out, wait] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('[err]', m.text().slice(0, 300)); });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await p.goto(url); await p.waitForTimeout(800);
  await p.screenshot({ path: out.replace('.png', '_menu.png') });
  await p.tap('#start'); await p.waitForTimeout(+wait);
  await p.screenshot({ path: out });
  console.log(JSON.stringify(await p.evaluate(() => window.__G ? { t: __G.race.t.toFixed(1), phase: __G.race.phase, v: (__G.race.player.speed * 3.6).toFixed(0), calls: __G.renderer.info.render.calls, tris: __G.renderer.info.render.triangles, load: document.getElementById('loadTxt').textContent } : { load: document.getElementById('loadTxt').textContent })));
  await b.close();
})();
