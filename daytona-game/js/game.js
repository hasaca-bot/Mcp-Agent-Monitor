// Yarış yönetimi: grid, tempo turu → yeşil bayrak, tur sayımı, sıralama, bitiş.
import { World, makeCar, CAR } from './physics.js';
import { makeDriver, driveAI, playerSteerLimit } from './ai.js';

export const NUM_CARS = 40;          // Daytona 500 gridi
const LL = CAR.a + CAR.b;
const PACE = 52;                     // m/s tempo hızı

export class Race {
  constructor(track, opts = {}) {
    this.T = track;
    this.laps = opts.laps ?? 5;
    this.difficulty = opts.difficulty ?? 1;
    this.assist = opts.assist ?? true;
    this.autopilot = opts.autopilot ?? false;
    const n = opts.nCars ?? NUM_CARS;
    const gridPos = Math.max(1, Math.min(n, opts.gridPos ?? 20));
    this.world = new World(track);
    this.phase = 'pace';             // pace → race → done
    this.t = 0; this.greenAt = 4.5; this.raceTime = 0;
    this.standings = [];
    this.player = null;
    this.finishOrder = [];
    const seed = opts.seed ?? 1;
    for (let i = 0; i < n; i++) {
      const c = makeCar(i);
      const row = Math.floor(i / 2), col = i % 2;
      c.s = track.wrap(track.L - 230 - row * 8.6 - col * 1.2);
      c.d = col === 0 ? 2.0 : 5.2;
      c.vx = PACE; c.gear = 3; c.lap = 0;
      c.gridPos = i + 1;
      c.number = 0;
      makeDriver(c, i * 31 + seed * 101, this.difficulty);
      c.ai.lane = col; c.ai.dCur = c.d;
      if (i === gridPos - 1) { c.isPlayer = true; c.powerK = 1.0; c.gripK = 1.0; this.player = c; }
      this.world.cars.push(c);
    }
    this.world.sortCars();
    this.updateStandings();
  }

  // input: {steer:-1..1 (sol +), thr:0..1, brk:0..1}
  update(dt, input) {
    const w = this.world;
    this.t += dt;
    if (this.phase === 'pace' && this.t >= this.greenAt) { this.phase = 'race'; this.justGreen = true; }
    if (this.phase !== 'pace') this.raceTime += dt;
    w.sortCars();
    const o = w.order;
    for (let i = 0; i < o.length; i++) {
      const c = o[i];
      if (c.isPlayer && !this.autopilot && this.phase === 'race' && !c.finished) this.drivePlayer(c, input, dt);
      else {
        driveAI(w, c, i, dt);
        // hafif lastik-bant: yarış oyuncunun çevresinde kalsın
        if (!c.isPlayer && this.player && c.basePower) {
          const rel = c.progress - this.player.progress;
          c.powerK = c.basePower * (1 - Math.max(-1, Math.min(1, rel / 500)) * 0.03);
        }
      }
      if (this.phase === 'pace') {
        // tempo: hız sabitleyici
        const e = PACE - c.speed;
        c.thr = Math.max(0, Math.min(1, 0.32 + e * 0.5)); c.brk = e < -3 ? 0.3 : 0;
        c.ai.lane = c.gridPos % 2 === 1 ? 0 : 1;
      }
    }
    w.step(dt);
    for (const c of w.cars) {
      if (c._crossed) {
        c._crossed = 0;
        if (c.lap > 1) { c.lastLap = w.time - c.lapStart; if (!c.bestLap || c.lastLap < c.bestLap) c.bestLap = c.lastLap; }
        c.lapStart = w.time;
        if (c.lap > this.laps && !c.finished) {
          c.finished = true; c.finishTime = this.raceTime; this.finishOrder.push(c);
          if (c.isPlayer) this.phase = 'done';
        }
      }
    }
    this.updateStandings();
  }

  drivePlayer(c, input, dt) {
    const v = c.speed, T = this.T;
    const lim = playerSteerLimit(v);
    let cmd;
    if (this.assist && Math.abs(c.psi) < 0.6 && c.vx > 6) {
      // yardım açık: giriş bir rota açısı (yanal hız) hedefler; pist eğriliği ileri beslenir → dengeli şerit kontrolü
      const k = T.kappaAt(c.s + v * 0.12), bank = T.bankLocal(c.s, c.d);
      const chiMax = Math.max(0.05, Math.min(0.32, 4.2 / Math.max(v, 1)));
      let chiDes = input.steer * chiMax;
      // direksiyon bırakılınca şeridi tut
      if (Math.abs(input.steer) > 0.08 || this.holdD === undefined) this.holdD = c.d;
      else chiDes += Math.max(-0.02, Math.min(0.02, (c.d - this.holdD) * 0.02));
      this.holdD = Math.max(1.3, Math.min(T.W - 1.9, this.holdD));
      if (c.d > T.W - 1.7 && chiDes < 0.01) chiDes = Math.max(chiDes, 0) + 0.04 * (c.d - (T.W - 1.7)) + (c.wallHit > 0.05 ? 0.03 : 0);   // duvar koruması
      const chi = c.psi + Math.atan2(c.vy, Math.max(c.vx, 5));
      const rDes = k * Math.cos(bank) * c.vx;
      // düzeltme yetkisi ~7 m/s² yanal ivmeyle sınırlı (yüksek hızda ani direksiyon spin attırır)
      const vv = Math.max(v, 8), auth = Math.min(CAR.maxSteer, (LL * 7 / (vv * vv) * 2.5 + 0.002) * (c.wallHit > 0.05 ? 4 : 1));
      let corr = 1.5 * (chiDes - chi) + 0.05 * (rDes - c.r);
      corr = Math.max(-auth, Math.min(auth, corr));
      cmd = LL * k * Math.cos(bank) * 1.05 + corr;
      c.stab = 0.7;
    } else {
      cmd = input.steer * (this.assist ? CAR.maxSteer * Math.min(1, 0.25 + 30 / (v * v + 30)) + lim * 0 : lim);
      c.stab = 0;
    }
    c.steerCmd = Math.max(-CAR.maxSteer, Math.min(CAR.maxSteer, cmd));
    c.thr = input.thr; c.brk = input.brk;
  }

  updateStandings() {
    const st = this.standings;
    if (st.length !== this.world.cars.length) { st.length = 0; for (const c of this.world.cars) st.push(c); }
    st.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.progress - a.progress;
    });
    for (let i = 0; i < st.length; i++) st[i].place = i + 1;
  }

  // oyuncuyu piste geri koy
  resetPlayer() {
    const c = this.player, T = this.T;
    let d = 2.0;
    for (const dd of [2.0, 5.2, 8.5, -4]) {
      let ok = true;
      for (const o of this.world.cars) if (o !== c && Math.abs(T.delta(o.s, c.s)) < 14 && Math.abs(o.d - dd) < 2.6) ok = false;
      if (ok) { d = dd; break; }
    }
    c.d = d; c.psi = 0; c.vy = 0; c.r = 0; c.vx = Math.max(25, Math.min(c.vx, 40)); c.gear = 2; c.steer = 0;
  }
}
