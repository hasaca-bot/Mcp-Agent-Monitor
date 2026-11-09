// Daytona International Speedway — 2.5 mil (4023 m) tri-oval, saf matematik (THREE bağımsız).
// Referans çizgi (d = 0) yarış yüzeyinin iç kenarıdır. d dışa doğru (duvara) artar.
const DEG = Math.PI / 180;

export const TRACK = {
  length: 4023.36,        // 2.5 mil
  width: 12.2,            // 40 ft yarış yüzeyi
  apron: 9,               // düz apron genişliği (d: -9..0)
  innerWall: -34,         // iç bariyer
  bankTurn: 31 * DEG,
  bankTri: 18 * DEG,
  bankFront: 6 * DEG,
  bankBack: 3 * DEG,
  R: 318,                 // viraj yarıçapı (~1000 ft)
  Rt: 560,                // tri-oval yarıçapı
  alpha: 14 * DEG,        // tri-oval yarım açısı
  ds: 1,
};

function boxSmooth(a, half) {
  const n = a.length, out = new Float64Array(n);
  let sum = 0;
  for (let i = -half; i <= half; i++) sum += a[(i + n) % n];
  const w = 2 * half + 1;
  for (let i = 0; i < n; i++) {
    out[i] = sum / w;
    sum += a[(i + half + 1) % n] - a[(i - half + n) % n];
  }
  return out;
}

function profile(Lb, Lf) {
  const { R, Rt, alpha } = TRACK;
  // s=0 tri-oval tepe noktası (start/finiş)
  const segs = [
    [Rt * alpha, 1 / Rt, TRACK.bankTri],
    [Lf, 0, TRACK.bankFront],
    [R * (Math.PI - alpha), 1 / R, TRACK.bankTurn],
    [Lb, 0, TRACK.bankBack],
    [R * (Math.PI - alpha), 1 / R, TRACK.bankTurn],
    [Lf, 0, TRACK.bankFront],
    [Rt * alpha, 1 / Rt, TRACK.bankTri],
  ];
  let total = 0;
  for (const s of segs) total += s[0];
  const n = Math.round(total);
  const ds = total / n;
  let kap = new Float64Array(n), bank = new Float64Array(n);
  let acc = 0, si = 0;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * ds;
    while (si < segs.length - 1 && s > acc + segs[si][0]) { acc += segs[si][0]; si++; }
    kap[i] = segs[si][1]; bank[i] = segs[si][2];
  }
  // geçiş eğrileri (spiral) — iki kez kutu filtresi
  kap = boxSmooth(boxSmooth(kap, 45), 45);
  bank = boxSmooth(boxSmooth(bank, 70), 70);
  return { n, ds, kap, bank, total };
}

function integrate(p) {
  const { n, ds, kap } = p;
  const x = new Float64Array(n + 1), z = new Float64Array(n + 1), th = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const thm = th[i] - kap[i] * ds * 0.5;
    x[i + 1] = x[i] + Math.cos(thm) * ds;
    z[i + 1] = z[i] + Math.sin(thm) * ds;
    th[i + 1] = th[i] - kap[i] * ds;
  }
  return { x, z, th };
}

export function buildTrack() {
  let Lb = 1000, Lf = 480, p, g;
  for (let outer = 0; outer < 6; outer++) {
    let lo = 100, hi = 1200;
    for (let it = 0; it < 50; it++) {
      Lf = (lo + hi) / 2;
      p = profile(Lb, Lf); g = integrate(p);
      // kapanış hatası başlangıç teğeti (+x) yönünde
      if (g.x[p.n] < 0) lo = Lf; else hi = Lf;   // ön düzlük uzadıkça x[n] artar
    }
    Lb += (TRACK.length - p.total) / 2.03;
  }
  const n = p.n, ds = p.ds;
  // artık kapanış hatasını dağıt
  const ex = g.x[n], ez = g.z[n];
  const x = new Float64Array(n), z = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n);
  const kap = new Float64Array(n), bank = new Float64Array(n);
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    x[i] = g.x[i] - ex * i / n; z[i] = g.z[i] - ez * i / n;
    tx[i] = Math.cos(g.th[i]); tz[i] = Math.sin(g.th[i]);
    // düğüm noktasındaki eğrilik/eğim: komşu hücre ortalaması
    kap[i] = 0.5 * (p.kap[i] + p.kap[(i - 1 + n) % n]);
    bank[i] = 0.5 * (p.bank[i] + p.bank[(i - 1 + n) % n]);
    cx += x[i]; cz += z[i];
  }
  cx /= n; cz /= n;
  for (let i = 0; i < n; i++) { x[i] -= cx; z[i] -= cz; }
  const L = n * ds;
  const T = { n, ds, L, x, z, tx, tz, kap, bank, W: TRACK.width, apron: TRACK.apron, innerWall: TRACK.innerWall, Lb, Lf };

  T.wrap = (s) => { s %= L; return s < 0 ? s + L : s; };
  // imzalı en kısa s farkı (a - b)
  T.delta = (a, b) => { let d = (a - b) % L; if (d > L / 2) d -= L; else if (d < -L / 2) d += L; return d; };
  T.kappaAt = (s) => {
    const f = T.wrap(s) / ds, i = Math.floor(f) % n, j = (i + 1) % n, u = f - Math.floor(f);
    return kap[i] + (kap[j] - kap[i]) * u;
  };
  T.bankAt = (s) => {
    const f = T.wrap(s) / ds, i = Math.floor(f) % n, j = (i + 1) % n, u = f - Math.floor(f);
    return bank[i] + (bank[j] - bank[i]) * u;
  };
  // yerel eğim: apron düz, yarış yüzeyi eğimli (kısa geçiş)
  T.bankLocal = (s, d) => {
    const b = T.bankAt(s);
    if (d >= 0.5) return b;
    if (d <= -1.5) return 0;
    return b * (d + 1.5) / 2;
  };
  // çerçeve: out = {px,py,pz, tx,tz, ox,oz(dışa yatay), bank, hd(yatay ofset), h(yükseklik)}
  T.frame = (s, d, out) => {
    const f = T.wrap(s) / ds, i = Math.floor(f) % n, j = (i + 1) % n, u = f - Math.floor(f);
    let ax = tx[i] + (tx[j] - tx[i]) * u, az = tz[i] + (tz[j] - tz[i]) * u;
    const il = 1 / Math.hypot(ax, az); ax *= il; az *= il;
    const b = bank[i] + (bank[j] - bank[i]) * u;
    const ox = -az, oz = ax;
    let hd, h;
    if (d >= 0) { hd = d * Math.cos(b); h = d * Math.sin(b); } else { hd = d; h = 0; }
    out.tx = ax; out.tz = az; out.ox = ox; out.oz = oz; out.bank = b; out.hd = hd; out.h = h;
    out.px = x[i] + (x[j] - x[i]) * u + ox * hd;
    out.py = h;
    out.pz = z[i] + (z[j] - z[i]) * u + oz * hd;
    out.kappa = kap[i] + (kap[j] - kap[i]) * u;
    return out;
  };
  return T;
}
