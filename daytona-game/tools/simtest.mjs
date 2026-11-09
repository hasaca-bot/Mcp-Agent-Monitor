import { buildTrack } from '../js/track.js';
import { Race } from '../js/game.js';
const T = buildTrack();
const laps = +(process.argv[2] || 3), n = +(process.argv[3] || 40);
const race = new Race(T, { laps, autopilot: true, nCars: n, gridPos: 20, difficulty: 1 });
const dt = 1 / 60; let hits = 0, walls = 0, maxPsi = 0, t0 = Date.now(), spins = 0;
const spun = new Set();
for (let f = 0; f < 60 * 60 * 12; f++) {
  race.update(dt, { steer: 0, thr: 0, brk: 0 });
  for (const e of race.world.events) { if (e.type === 'hit') hits++; else walls++; }
  race.world.events.length = 0;
  for (const c of race.world.cars) { const a = Math.abs(c.psi); if (a > maxPsi) maxPsi = a; if (a > 0.6 && !spun.has(c.id)) { spun.add(c.id); spins++; console.log('SPIN t', race.t.toFixed(1), 'car', c.id, 's', c.s.toFixed(0), 'd', c.d.toFixed(1), 'v', c.speed.toFixed(0)); } if (a < 0.1) spun.delete(c.id); if (isNaN(c.s)||isNaN(c.vx)) { console.log('NaN', c.id); process.exit(1);} }
  if (f % 600 === 0) {
    const st = race.standings; const l = st[0], p = race.player;
    const sp = race.world.cars.map(c => c.speed); 
    console.log(`t=${race.t.toFixed(0)} lead#${l.id} lap${l.lap} v=${(l.speed * 3.6).toFixed(0)} | player P${p.place} v=${(p.speed*3.6).toFixed(0)} d=${p.d.toFixed(1)} draft=${p.draft.toFixed(2)} | avg=${(sp.reduce((a,b)=>a+b)/sp.length*3.6).toFixed(0)} min=${(Math.min(...sp)*3.6).toFixed(0)} spread=${((st[0].progress-st[st.length-1].progress)).toFixed(0)}m hits=${hits} walls=${walls}`);
  }
  if (race.phase === "done") break;
}
console.log('done t', race.t.toFixed(1), 'ms', Date.now() - t0, 'hits', hits, 'walls', walls, 'spins', spins, 'maxPsi', maxPsi.toFixed(2));
console.log(race.standings.slice(0, 8).map(c => `#${c.id} best ${c.bestLap.toFixed(2)} (${(T.L / c.bestLap * 3.6).toFixed(0)}kmh)`).join('\n'));
