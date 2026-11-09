// Yapay zekâ sürücüleri: şerit seçimi, slipstream arama, geçiş, yan yana güvenlik,
// takip mesafesi/bump-draft, spin kurtarma. Aynı fizik modelini kullanır.
import { CAR } from './physics.js';

const LANES = [2.0, 5.1, 8.2, 10.1];
const LL = CAR.a + CAR.b;

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function makeDriver(car, seed, difficulty) {
  const R = rnd(seed * 7919 + 13);
  const skill = 0.55 + 0.45 * R();
  car.ai = {
    skill,
    aggr: 0.3 + 0.7 * R(),
    lane: 1, dT: car.d, dCur: car.d,
    think: R() * 0.3, laneHold: 0, stuck: 0,
    eInt: 0, recover: 0, wobble: R() * 6.28,
    follow: null,
  };
  // güç dağılımı: zorluk + sürücü
  const base = [0.955, 0.985, 1.005][difficulty] ?? 0.985;
  car.powerK = car.basePower = base + 0.02 * (skill - 0.5);
  car.gripK = 0.97 + 0.04 * skill;
  car.stab = 0.8 + 0.4 * skill;
}

// komşu taraması: order s'e göre sıralı dizi
function scan(world, car, idx) {
  const T = world.T, o = world.order, n = o.length;
  const res = car.ai._nb || (car.ai._nb = []);
  res.length = 0;
  for (let q = 1; q < n; q++) {
    const b = o[(idx + q) % n];
    const ds = T.delta(b.s, car.s);
    if (ds > 90 || ds < 0) break;
    res.push(b, ds);
  }
  for (let q = 1; q < n; q++) {
    const b = o[(idx - q + n) % n];
    const ds = T.delta(b.s, car.s);
    if (ds < -45 || ds > 0) break;
    res.push(b, ds);
  }
  return res;
}

// şerit boşluğu ve o şeritteki öndeki araç
function laneInfo(car, nb, laneD) {
  let free = true, aheadGap = 1e9, aheadV = 0, ahead = null;
  const v = car.speed;
  for (let i = 0; i < nb.length; i += 2) {
    const b = nb[i], ds = nb[i + 1];
    if (Math.abs(b.d - laneD) > 1.9 && !(b.ai && Math.abs(b.ai.dT - laneD) < 1.9 && Math.abs(b.d - laneD) < 4)) continue;
    const rel = b.speed - v;
    if (ds >= 0) {
      const gap = ds - CAR.len;
      if (gap < aheadGap) { aheadGap = gap; aheadV = b.speed; ahead = b; }
      if (gap < 4 - Math.min(0, rel) * 1.3) free = false;
    } else {
      const gap = -ds - CAR.len;
      if (gap < 4 + Math.max(0, rel) * 1.6) free = false;
    }
  }
  return { free, aheadGap, aheadV, ahead };
}

export function driveAI(world, car, idx, dt) {
  const T = world.T, ai = car.ai;
  const v = car.speed;
  const nb = scan(world, car, idx);

  // ---- kurtarma modu ----
  const absPsi = Math.abs(car.psi);
  if (absPsi > 0.9 || (car.vx < 4 && !world.frozen && world.time > 6)) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt * 2);
  if (ai.stuck > 5) {       // uzun süre takıldı: pisti yönüne çevir
    ai.stuck = 0; car.psi = 0; car.vy = 0; car.r = 0; car.vx = 22; car.gear = 2; car.steer = 0;
    if (car.d < 1.3) car.d = Math.max(car.d, -6);
    ai.recover = 0;
  }
  if (absPsi > 0.55 || ai.recover > 0) {
    if (absPsi > 0.55) ai.recover = 1.0;
    ai.recover -= dt;
    car.brk = 0;
    if (absPsi > 1.2 && car.speed > 12) { car.thr = 0; car.brk = 1; car.steerCmd = 0; }       // spin: kilitle ve dur
    else {
      const want = Math.max(-CAR.maxSteer, Math.min(CAR.maxSteer, -car.psi * 1.4 - car.r * 0.25));
      if (car.vx >= -0.5) { car.steerCmd = want; car.thr = absPsi > 1.2 ? 0.9 : 0.55; }
      else { car.steerCmd = -want; car.thr = 1; }
    }
    ai.dCur = car.d;
    let bl = 0; for (let l = 1; l < 3; l++) if (Math.abs(LANES[l] - car.d) < Math.abs(LANES[bl] - car.d)) bl = l;
    ai.lane = bl;
    return;
  }

  // ---- şerit kararı ----
  ai.think -= dt; ai.laneHold -= dt;
  const cur = laneInfo(car, nb, LANES[ai.lane]);
  if (ai.think <= 0 && !world.frozen) {
    ai.think = 0.22 + 0.1 * (1 - ai.skill);
    let bestLane = ai.lane, bestScore = -1e9;
    for (let l = 0; l < LANES.length; l++) {
      if (Math.abs(l - ai.lane) > 1) continue;
      const info = l === ai.lane ? cur : laneInfo(car, nb, LANES[l]);
      if (l !== ai.lane && (!info.free || ai.laneHold > 0)) continue;
      // skor: öndeki boşluk + önde çekiş (draft) veren hızlı araç
      let score = 0;
      const gap = info.aheadGap;
      if (gap > 70) score = 4;                       // temiz hava
      else if (gap > 6) score = 6 + (info.aheadV - v) * 0.6 - gap * 0.03;    // çekiş
      else score = (info.aheadV - v) * 1.6 + gap * 0.5 - 2.5 * ai.aggr;      // sıkışık
      score -= l * 0.9;                              // iç şerit daha kısa
      if (l === 3) score -= 7;
      if (l !== ai.lane) score -= 1.6 - ai.aggr;     // şerit değiştirme maliyeti
      else score -= Math.min(ai.held || 0, 3) * 2.2 * (0.5 + ai.aggr);   // arkada tutuluyorsa çık ve geç
      if (score > bestScore) { bestScore = score; bestLane = l; }
    }
    if (bestLane !== ai.lane) { ai.lane = bestLane; ai.laneHold = 1.6 + 1.5 * (1 - ai.aggr); }
  }
  let dT = LANES[ai.lane];
  // hedef şeride ulaşılamıyorsa bulunduğun şeridi benimse
  if (Math.abs(car.d - dT) > 1.9) { ai.offT = (ai.offT || 0) + dt; if (ai.offT > 1.2) { let bl = 0; for (let l = 1; l < LANES.length; l++) if (Math.abs(LANES[l] - car.d) < Math.abs(LANES[bl] - car.d)) bl = l; ai.lane = bl; dT = LANES[bl]; ai.offT = 0; ai.laneHold = 1.5; } } else ai.offT = 0;

  // ---- yan yana güvenlik: boyuna çakışan araçlardan yanal mesafe ----
  let lo = 1.25, hi = T.W - 1.95, squeezed = false, ovAhead = false;
  for (let i = 0; i < nb.length; i += 2) {
    const b = nb[i], ds = nb[i + 1];
    if (Math.abs(ds) > CAR.len + 1.2) continue;
    const dd = b.d - car.d;
    if (Math.abs(dd) < 4.5 && ds > 0.3) ovAhead = true;
    if (dd > 0 && dd < 4.5) hi = Math.min(hi, b.d - 2.55);
    else if (dd <= 0 && dd > -4.5) lo = Math.max(lo, b.d + 2.55);
  }
  if (lo > hi) { const m = Math.max(1.25, Math.min(T.W - 1.95, car.d)); lo = hi = m; squeezed = true; }
  dT = Math.max(lo, Math.min(hi, dT));
  ai.dT = dT;
  // hedef çizgiyi sınırlı yanal hızla kaydır
  const maxLat = (1.3 + 1.2 * ai.aggr) * dt;
  const dd = dT - ai.dCur;
  ai.dCur += Math.abs(dd) < maxLat ? dd : Math.sign(dd) * maxLat;
  ai.wobble += dt * 0.7;
  const target = ai.dCur + Math.sin(ai.wobble) * 0.12 * (1.2 - ai.skill);

  // ---- direksiyon: rota açısı kontrolü + eğrilik ileri beslemesi ----
  const k = T.kappaAt(car.s + v * 0.12), bank = T.bankLocal(car.s, car.d);
  const vv = Math.max(v, 8);
  const e = car.d - target;                       // + : fazla dışta → sola
  const look = 0.75 * vv + 6;
  let chiDes = Math.atan2(e, look);
  if (chiDes > 0.09) chiDes = 0.09; else if (chiDes < -0.09) chiDes = -0.09;
  const chi = car.psi + Math.atan2(car.vy, Math.max(car.vx, 5));
  const rDes = k * Math.cos(bank) * car.vx;
  ai.eInt = Math.max(-3, Math.min(3, ai.eInt + e * dt));
  let delta = LL * k * Math.cos(bank) * 1.05 + 1.5 * (chiDes - chi) + 0.05 * (rDes - car.r) + 0.0012 * ai.eInt;
  const mx = Math.min(CAR.maxSteer, 0.05 + 12 / (vv * vv) * 9);
  car.steerCmd = Math.max(-mx, Math.min(mx, delta));

  // ---- gaz/fren: takip ----
  let thr = 1, brk = 0;
  const ahead = cur.ahead;
  // gerçek hizadaki en yakın araç (şerit değiştirirken de)
  let gap = 1e9, av = 0;
  for (let i = 0; i < nb.length; i += 2) {
    const b = nb[i], ds = nb[i + 1];
    if (ds <= 0 || Math.abs(b.d - car.d) > 2.05) continue;
    const g = ds - CAR.len;
    if (g < gap) { gap = g; av = b.speed; }
  }
  if (gap < 45) {
    // araç takip yasası (dalga büyümesini önleyen yumuşak kontrol)
    const closing = v - av;
    const gDes = 1.8 + (1 - ai.aggr) * 2.0;
    const aDes = 0.22 * (gap - gDes) - 1.25 * closing;
    if (aDes < 1.2) {
      thr = Math.max(0, Math.min(1, 0.72 + aDes * 0.3));
      if (aDes < -3.2) brk = Math.min(1, (-aDes - 3.2) * 0.09);
    }
  }
  ai.held = thr < 0.85 ? (ai.held || 0) + dt : Math.max(0, (ai.held || 0) - dt * 2);
  if (squeezed && ovAhead) { thr = Math.min(thr, 0.3); brk = Math.max(brk, 0.08); }   // sıkışınca arkadaki yol verir
  if (car.d > T.W - 1.6) car.steerCmd += 0.012 * (car.d - (T.W - 1.6));
  if (car.onGrass) thr = Math.min(thr, 0.6);
  car.thr = thr; car.brk = gap < 2.5 ? brk : Math.min(brk, 0.55);
  ai.follow = ahead;
}

// ---- oyuncu yardımcıları ----
export function playerSteerLimit(v) {
  return Math.min(CAR.maxSteer, 0.022 + 13 / (Math.max(v, 4) ** 2) * 9);
}
