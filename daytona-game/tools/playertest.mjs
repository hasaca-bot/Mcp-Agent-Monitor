import { buildTrack } from '../js/track.js';
import { Race } from '../js/game.js';
const T = buildTrack();
for (const mode of ['hands-off', 'steer-pulses', 'no-assist-handsoff']) {
  const race = new Race(T, { laps: 3, nCars: 40, gridPos: 20, difficulty: 1, assist: mode !== 'no-assist-handsoff' });
  const p = race.player; let walls = 0, hits = 0, minD = 99, maxD = -99, maxPsi = 0; const inp = { steer: 0, thr: 1, brk: 0 };
  for (let f = 0; f < 60 * 110; f++) {
    const t = race.t;
    if (mode === 'steer-pulses') { const ph = Math.floor(t / 2.5) % 4; const tg = ph === 0 ? 1 : ph === 2 ? -1 : 0; inp.steer += Math.max(-0.045, Math.min(0.045, tg - inp.steer)); }
    race.update(1 / 60, inp);
    for (const e of race.world.events) { if (e.car === p || e.other === p) { if (e.type === 'wall') walls++; else hits++; } }
    race.world.events.length = 0;
    if (race.phase === 'race') { minD = Math.min(minD, p.d); maxD = Math.max(maxD, p.d); maxPsi = Math.max(maxPsi, Math.abs(p.psi)); }
    if (mode === 'steer-pulses' && f % 150 === 0 && t > 20 && t < 45) console.log(`   t=${t.toFixed(1)} steer=${inp.steer.toFixed(2)} d=${p.d.toFixed(2)} psi=${p.psi.toFixed(3)} v=${(p.speed * 3.6).toFixed(0)}`);
  }
  console.log(mode, `place=${p.place} lap=${p.lap} v=${(p.speed * 3.6).toFixed(0)} d∈[${minD.toFixed(1)},${maxD.toFixed(1)}] maxPsi=${maxPsi.toFixed(2)} walls=${walls} hits=${hits} best=${p.bestLap.toFixed(2)}`);
}
