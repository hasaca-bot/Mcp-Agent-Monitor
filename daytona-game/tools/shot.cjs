const { chromium } = require('playwright');
(async () => {
  const args = process.argv.slice(2);
  const url = args[0], out = args[1], waits = (args[2] || '8000').split(',').map(Number), keys = args[3] || '';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 640 } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await p.goto(url);
  let i = 0;
  for (const w of waits) {
    await p.waitForTimeout(w);
    for (const k of keys.split(',').filter(Boolean)) await p.keyboard.press(k);
    await p.screenshot({ timeout: 120000, path: out.replace('.png', (i ? '_' + i : '') + '.png') }); i++;
    const info = await p.evaluate(() => window.__G ? { t: __G.race.t.toFixed(1), phase: __G.race.phase, v: (__G.race.player.speed * 3.6).toFixed(0), place: __G.race.player.place, calls: __G.renderer.info.render.calls, tris: __G.renderer.info.render.triangles } : null);
    console.log(JSON.stringify(info));
  }
  await b.close();
})();
