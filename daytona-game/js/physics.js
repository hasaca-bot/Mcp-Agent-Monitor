// Araç dinamiği: pist yüzeyine bağlı 3 serbestlik dereceli (boyuna, yanal, sapma) rijit gövde,
// 4 teker Pacejka lastik modeli, yük transferi, eğim (banking) kuvvetleri, aero + slipstream,
// motor/şanzıman, araç-araç OBB çarpışmaları ve duvar temasları.
export const CAR = {
  m: 1540, Iz: 3000, a: 1.42, b: 1.56, tw: 1.62, h: 0.43,
  len: 5.15, wid: 1.96, rw: 0.36,
  CdA: 0.88, ClA: 1.45, mu0: 1.36,
  B: 16, C: 1.4,
  gears: [10.6, 7.3, 5.4, 4.25, 3.47],
  Tmax: 522, eta: 0.9, idle: 1800, redline: 9200,
  maxSteer: 0.42,
};
const G = 9.81, RHO = 1.225;
const TQ = [[1000, 0.5], [2000, 0.62], [4000, 0.86], [6000, 1.0], [7500, 0.96], [8500, 0.86], [9200, 0.72], [9800, 0.3]];
function torqueAt(rpm) {
  if (rpm <= TQ[0][0]) return TQ[0][1];
  for (let i = 1; i < TQ.length; i++) {
    if (rpm <= TQ[i][0]) {
      const u = (rpm - TQ[i - 1][0]) / (TQ[i][0] - TQ[i - 1][0]);
      return TQ[i - 1][1] + (TQ[i][1] - TQ[i - 1][1]) * u;
    }
  }
  return 0;
}

export function makeCar(id) {
  return {
    id, s: 0, d: 3, psi: 0, vx: 0, vy: 0, r: 0,
    lap: 0, progress: 0, finished: false, finishTime: 0, place: 0,
    thr: 0, brk: 0, steerCmd: 0, steer: 0,       // steerCmd: hedef direksiyon açısı (rad)
    gear: 1, rpm: 2000, shiftT: 0,
    axF: 0, ayF: 0, draft: 0, push: 0,
    slip: 0, spin: 0, hit: 0, wallHit: 0, onGrass: false,
    powerK: 1, gripK: 1, stab: 0, isPlayer: false,
    lapStart: 0, lastLap: 0, bestLap: 0,
    speed: 0, stuckT: 0,
  };
}

const WX = [CAR.a, CAR.a, -CAR.b, -CAR.b];
const WY = [CAR.tw / 2, -CAR.tw / 2, CAR.tw / 2, -CAR.tw / 2];
const L = CAR.a + CAR.b;

export class World {
  constructor(track) {
    this.T = track;
    this.cars = [];
    this.time = 0;
    this.order = [];
    this.frozen = false;     // tur öncesi: gaz kilidi
    this.events = [];        // {type:'hit'|'wall', car, v}
    this._sub = 0;
  }

  stepCar(c, dt) {
    const T = this.T;
    const k = T.kappaAt(c.s);
    const bank = T.bankLocal(c.s, c.d);
    const cb = Math.cos(bank), sb = Math.sin(bank);
    const lat = c.d >= 0 ? c.d * cb : c.d;
    const kDen = 1 + k * lat;
    const cp = Math.cos(c.psi), sp = Math.sin(c.psi);
    let vx = c.vx, vy = c.vy, r = c.r;
    const vt = vx * cp - vy * sp;
    const gN = Math.max(2, G * cb + vt * vt * (k / kDen) * sb);

    // yüzey
    let surf = 1, rollK = 0.013;
    c.onGrass = false;
    if (c.d < -T.apron) { surf = 0.55; rollK = 0.09; c.onGrass = true; }
    else if (c.d < 0) surf = 0.97;
    surf *= c.gripK;

    // direksiyon gecikmesi
    const sr = 1.6 * dt;
    const dsr = c.steerCmd - c.steer;
    c.steer += Math.abs(dsr) < sr ? dsr : Math.sign(dsr) * sr;
    const cd = Math.cos(c.steer), sd = Math.sin(c.steer);

    // aero
    const v2 = vx * vx + vy * vy, v = Math.sqrt(v2);
    const dragK = 0.5 * RHO * CAR.CdA * (1 - c.draft) * (1 - c.push);
    const DF = 0.5 * RHO * CAR.ClA * vx * vx * (1 - 0.35 * c.draft);

    // motor / şanzıman
    const ratio = CAR.gears[c.gear - 1];
    const rpmW = Math.abs(vx) / CAR.rw * ratio * 9.5493;
    let rpm = Math.max(CAR.idle + c.thr * 1500 * Math.max(0, 1 - rpmW / 3000), rpmW);
    c.shiftT -= dt;
    if (c.shiftT <= 0) {
      if (rpm > 8750 && c.gear < CAR.gears.length) { c.gear++; c.shiftT = 0.14; }
      else if (c.gear > 1 && rpmW * CAR.gears[c.gear - 2] / ratio < 7300 && rpm < 5600) { c.gear--; c.shiftT = 0.14; }
    }
    c.rpm += (Math.min(rpm, 9600) - c.rpm) * Math.min(1, dt * 14);
    let Fdrive = 0;
    const thr = this.frozen ? 0 : c.thr;
    if (c.shiftT <= 0 && rpm < CAR.redline + 300) {
      Fdrive = thr * torqueAt(rpm) * CAR.Tmax * ratio * CAR.eta / CAR.rw * c.powerK;
    }
    if (thr < 0.05 && vx > 3) Fdrive -= 0.05 * CAR.m * G * (rpm / 8000);     // motor freni
    let Fbrk = c.brk * CAR.m * 12.5;
    // geri vites
    if (c.brk > 0.1 && thr < 0.05 && vx < 1.2 && !this.frozen) {
      Fbrk = 0; Fdrive = vx > -11 ? -c.brk * 5500 : 0;
    }

    // teker yükleri
    const Wf = CAR.m * gN * CAR.b / L + DF * 0.43, Wr = CAR.m * gN * CAR.a / L + DF * 0.57;
    const dLong = CAR.m * c.axF * CAR.h / L;
    const dLat = CAR.m * c.ayF * CAR.h / CAR.tw;
    const N0 = Wf / 2 - dLong / 2 - dLat * 0.56, N1 = Wf / 2 - dLong / 2 + dLat * 0.56;
    const N2 = Wr / 2 + dLong / 2 - dLat * 0.44, N3 = Wr / 2 + dLong / 2 + dLat * 0.44;

    let FX = 0, FY = 0, MZ = 0, slipMax = 0;
    for (let i = 0; i < 4; i++) {
      const N = Math.max(0, i === 0 ? N0 : i === 1 ? N1 : i === 2 ? N2 : N3);
      if (N <= 0) continue;
      const wvx = vx - r * WY[i], wvy = vy + r * WX[i];
      let cx, cy;
      const front = i < 2;
      if (front) { cx = wvx * cd + wvy * sd; cy = -wvx * sd + wvy * cd; } else { cx = wvx; cy = wvy; }
      const mu = CAR.mu0 * surf * (1 - 0.06 * (N / 4200 - 1));
      const lim = mu * N;
      const alpha = Math.atan2(cy, Math.abs(cx) + 4);
      let fy = -lim * Math.sin(CAR.C * Math.atan(CAR.B * alpha));
      let fx;
      const dir = cx >= 0 ? 1 : -1;
      if (front) fx = -dir * Fbrk * 0.31;
      else fx = Fdrive * 0.5 - dir * Fbrk * 0.19;
      if (Math.abs(cx) < 0.3 && Fdrive === 0) fx = -cx * 0.3 * lim;       // dururken kilit
      const ux = fx / lim;
      if (Math.abs(ux) > 1) { fx = Math.sign(fx) * lim * 0.92; fy *= 0.3; slipMax = Math.max(slipMax, Math.abs(ux)); }
      else fy *= Math.sqrt(1 - ux * ux * 0.85);
      const sa = Math.abs(alpha);
      if (sa > 0.11 && v > 8) slipMax = Math.max(slipMax, sa * 6);
      let bx, by;
      if (front) { bx = fx * cd - fy * sd; by = fx * sd + fy * cd; } else { bx = fx; by = fy; }
      FX += bx; FY += by; MZ += WX[i] * by - WY[i] * bx;
    }
    c.slip += (slipMax - c.slip) * Math.min(1, dt * 10);

    // lastiklerin hissettiği ivme (yük transferi için filtreli)
    c.axF += (FX / CAR.m - c.axF) * Math.min(1, dt * 8);
    c.ayF += (FY / CAR.m - c.ayF) * Math.min(1, dt * 8);

    // yerçekimi (eğimden aşağı = içe/sola), sürükleme, yuvarlanma
    FX += CAR.m * G * sb * sp; FY += CAR.m * G * sb * cp;
    FX -= dragK * v * vx; FY -= dragK * 3.2 * v * vy;
    if (Math.abs(vx) > 0.2) FX -= Math.sign(vx) * rollK * CAR.m * gN;
    MZ -= r * Math.abs(r) * 900;      // gövde aero sönümü
    if (c.stab > 0 && vx > 15) MZ -= c.stab * CAR.Iz * 2.6 * (r - k * cb * vt / kDen);   // sürücü/denge yardımı

    vx += (FX / CAR.m + r * vy) * dt;
    vy += (FY / CAR.m - r * vx) * dt;
    r += MZ / CAR.Iz * dt;
    if (v < 1.2) { const f = Math.exp(-dt * 4); vy *= f; r *= f; if (c.thr < 0.05 && c.brk < 0.05) vx *= f; }

    const vt2 = vx * cp - vy * sp, vl2 = vx * sp + vy * cp;
    const sdot = vt2 / kDen;
    const ns = c.s + sdot * dt;
    if (ns >= T.L) { c.s = ns - T.L; c.lap++; c._crossed = 1; }
    else if (ns < 0) { c.s = ns + T.L; c.lap--; }
    else c.s = ns;
    c.d -= vl2 * dt;
    c.psi += (r - k * cb * sdot) * dt;
    if (c.psi > Math.PI) c.psi -= 2 * Math.PI; else if (c.psi < -Math.PI) c.psi += 2 * Math.PI;
    c.vx = vx; c.vy = vy; c.r = r;
    c.spin += vx / CAR.rw * dt;
    c.speed = Math.sqrt(vx * vx + vy * vy);
    this.walls(c);
  }

  walls(c) {
    const T = this.T;
    const hl = CAR.len / 2, hw = CAR.wid / 2;
    const cp = Math.cos(c.psi), sp = Math.sin(c.psi);
    const outer = T.W - 0.1, inner = T.innerWall;
    for (let i = 0; i < 4; i++) {
      const bx = i < 2 ? hl : -hl, by = (i & 1) ? -hw : hw;
      const X = bx * cp - by * sp, Y = bx * sp + by * cp;     // pist düzlemi: X ileri, Y sol(iç)
      const dc = c.d - Y;
      let n = 0, pen = 0;
      if (dc > outer) { n = 1; pen = dc - outer; } else if (dc < inner) { n = -1; pen = inner - dc; }
      if (!n) continue;
      const vt = c.vx * cp - c.vy * sp, vl = c.vx * sp + c.vy * cp;
      const vcx = vt - c.r * Y, vcy = vl + c.r * X;
      const vn = vcy * n;
      c.d -= n * pen;
      if (vn >= 0) continue;
      const kn = 1 / CAR.m + X * X / CAR.Iz;
      const j = -(1.12) * vn / kn;
      const kt = 1 / CAR.m + Y * Y / CAR.Iz;
      let jt = -vcx / kt;
      const mx = 0.28 * j;
      if (jt > mx) jt = mx; else if (jt < -mx) jt = -mx;
      const JX = jt, JY = j * n;
      const dvt = JX / CAR.m, dvl = JY / CAR.m;
      c.vx += dvt * cp + dvl * sp; c.vy += -dvt * sp + dvl * cp;
      c.r += 0.5 * (X * JY - Y * JX) / CAR.Iz;
      if (-vn > 0.6) { c.wallHit = Math.max(c.wallHit, -vn); this.events.push({ type: 'wall', car: c, v: -vn, side: n }); }
      else c.wallHit = Math.max(c.wallHit, 0.3);
    }
  }

  // sıralı tarama: slipstream + çarpışmalar
  sortCars() {
    const o = this.order;
    if (o.length !== this.cars.length) { o.length = 0; for (const c of this.cars) o.push(c); }
    o.sort((a, b) => a.s - b.s);
  }

  drafts() {
    const T = this.T, o = this.order, n = o.length;
    for (const c of o) { c._dk = 1; c._push = 0; }
    for (let i = 0; i < n; i++) {
      const a = o[i];
      for (let q = 1; q < n; q++) {
        const b = o[(i + q) % n];
        const gap = T.delta(b.s, a.s) - CAR.len;
        if (gap > 60 || gap < -CAR.len) break;
        const dd = (b.d - a.d) / 1.45;
        const latF = Math.exp(-dd * dd);
        if (gap > -1) {
          const g0 = Math.max(0, gap);
          const sp = Math.min(1, b.speed / 40);
          a._dk *= 1 - 0.27 * Math.exp(-g0 / 18) * latF * sp;
          b._push = Math.max(b._push, 0.06 * Math.exp(-g0 / 3.5) * latF);
        }
      }
    }
    for (const c of o) {
      const d = Math.min(0.36, 1 - c._dk);
      c.draft += (d - c.draft) * 0.08;
      c.push += (c._push - c.push) * 0.08;
    }
  }

  collide() {
    const T = this.T, o = this.order, n = o.length;
    const hl = CAR.len / 2, hw = CAR.wid / 2;
    for (let i = 0; i < n; i++) {
      const A = o[i];
      for (let q = 1; q < n; q++) {
        const B = o[(i + q) % n];
        const dsAB = T.delta(B.s, A.s);
        if (dsAB > 6.2 || dsAB < -0.01) break;
        const dY = -(B.d - A.d);
        if (Math.abs(dY) > 6.2) continue;
        this.pair(A, B, dsAB, dY, hl, hw);
      }
    }
  }

  pair(A, B, dX, dY, hl, hw) {
    const ca = Math.cos(A.psi), sa = Math.sin(A.psi), cb = Math.cos(B.psi), sb = Math.sin(B.psi);
    // eksenler: A ileri, A sol, B ileri, B sol
    const ax = [ca, -sa, cb, -sb], ay = [sa, ca, sb, cb];
    let best = 1e9, bi = -1, bsign = 1;
    for (let k = 0; k < 4; k++) {
      const nx = ax[k], ny = ay[k];
      const ra = hl * Math.abs(ca * nx + sa * ny) + hw * Math.abs(-sa * nx + ca * ny);
      const rb = hl * Math.abs(cb * nx + sb * ny) + hw * Math.abs(-sb * nx + cb * ny);
      const dist = dX * nx + dY * ny;
      const ov = ra + rb - Math.abs(dist);
      if (ov <= 0) return;
      if (ov < best) { best = ov; bi = k; bsign = dist >= 0 ? 1 : -1; }
    }
    const nx = ax[bi] * bsign, ny = ay[bi] * bsign;   // A'dan B'ye
    // temas noktası: eksen A'nınsa B'nin en derin köşesi, değilse A'nın
    let px = 0, py = 0, cnt = 0, bestD = 1e9;
    const fromB = bi < 2;
    const c0 = fromB ? cb : ca, s0 = fromB ? sb : sa;
    const ox = fromB ? dX : 0, oy = fromB ? dY : 0, sg = fromB ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const bx = k < 2 ? hl : -hl, by = (k & 1) ? -hw : hw;
      const X = ox + bx * c0 - by * s0, Y = oy + bx * s0 + by * c0;
      const dd = (X * nx + Y * ny) * sg;
      if (dd < bestD - 0.08) { bestD = dd; px = X; py = Y; cnt = 1; }
      else if (dd < bestD + 0.08) { px += X; py += Y; cnt++; }
    }
    px /= cnt; py /= cnt;
    const rax = px, ray = py, rbx = px - dX, rby = py - dY;
    const vAt = A.vx * ca - A.vy * sa, vAl = A.vx * sa + A.vy * ca;
    const vBt = B.vx * cb - B.vy * sb, vBl = B.vx * sb + B.vy * cb;
    const rvx = (vBt - B.r * rby) - (vAt - A.r * ray);
    const rvy = (vBl + B.r * rbx) - (vAl + A.r * rax);
    const vn = rvx * nx + rvy * ny;
    // ayrıştırma
    const T = this.T, sep = best * 0.5 + 0.005;
    A.s = T.wrap(A.s - nx * sep); A.d += ny * sep;
    B.s = T.wrap(B.s + nx * sep); B.d -= ny * sep;
    if (vn >= 0) return;
    const m = CAR.m, I = CAR.Iz;
    const ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx;
    const kn = 2 / m + (ran * ran + rbn * rbn) / I;
    const j = -(1.05) * vn / kn;
    const tx = -ny, ty = nx;
    const vtn = rvx * tx + rvy * ty;
    const rat = rax * ty - ray * tx, rbt = rbx * ty - rby * tx;
    const kt = 2 / m + (rat * rat + rbt * rbt) / I;
    let jt = -vtn / kt;
    const mx = 0.1 * j;
    if (jt > mx) jt = mx; else if (jt < -mx) jt = -mx;
    const JX = j * nx + jt * tx, JY = j * ny + jt * ty;
    const YAW = 0.4;   // temas sonrası spin eğilimini yumuşat
    let dvt = -JX / m, dvl = -JY / m;
    A.vx += dvt * ca + dvl * sa; A.vy += -dvt * sa + dvl * ca; A.r -= YAW * (rax * JY - ray * JX) / I;
    dvt = JX / m; dvl = JY / m;
    B.vx += dvt * cb + dvl * sb; B.vy += -dvt * sb + dvl * cb; B.r += YAW * (rbx * JY - rby * JX) / I;
    if (-vn > 2) {
      A.hit = Math.max(A.hit, -vn); B.hit = Math.max(B.hit, -vn);
      this.events.push({ type: 'hit', car: A, other: B, v: -vn });
    }
  }

  // dt: kare süresi. Sabit 1/240 alt adımlar.
  step(frameDt) {
    const h = 1 / 240;
    let nsub = Math.round(frameDt / h);
    if (nsub < 1) nsub = 1; if (nsub > 12) nsub = 12;
    this.sortCars();
    this.drafts();
    for (let i = 0; i < nsub; i++) {
      for (const c of this.cars) this.stepCar(c, h);
      if (i & 1 || i === nsub - 1) { this.sortCars(); this.collide(); }
      this.time += h;
    }
    for (const c of this.cars) {
      c.progress = (c.lap - 1) * this.T.L + c.s;
      c.hit *= 0.9; c.wallHit *= 0.85;
    }
  }
}
