// 2D asset yuvaları. assets/textures/<ad>.png varsa o kullanılır, yoksa prosedürel yedek çizilir.
// Kendi ürettiğin görselleri aynı adlarla bu klasöre koyman yeterli (bkz. prompts/ASSET_PROMPTS.md).
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function noise(ctx, w, h, amp, seed) {
  const R = rng(seed), img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

const FALLBACK = {
  asphalt(c) {
    const x = c.getContext('2d'); x.fillStyle = '#3b3b3f'; x.fillRect(0, 0, c.width, c.height);
    noise(x, c.width, c.height, 34, 7);
    const R = rng(3);
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${R() > 0.5 ? 200 : 10},${R() > 0.5 ? 200 : 10},${R() > 0.5 ? 200 : 12},0.10)`; x.fillRect(R() * c.width, R() * c.height, 1 + R() * 2, 1 + R() * 2); }
  },
  grass(c) {
    const x = c.getContext('2d'); x.fillStyle = '#3f7a2c'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? 'rgba(255,255,160,0.05)' : 'rgba(0,40,0,0.07)'; x.fillRect(i * c.width / 8, 0, c.width / 8, c.height); }
    noise(x, c.width, c.height, 40, 11);
    const R = rng(5);
    for (let i = 0; i < 2500; i++) { x.strokeStyle = `rgba(${40 + R() * 60},${110 + R() * 90},${30 + R() * 40},0.35)`; const px = R() * c.width, py = R() * c.height; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 3, py - 2 - R() * 4); x.stroke(); }
  },
  crowd(c) {
    const x = c.getContext('2d'); x.fillStyle = '#2a2d36'; x.fillRect(0, 0, c.width, c.height);
    const R = rng(21), rows = 16, rh = c.height / rows;
    const cols = ['#e33', '#fff', '#28f', '#fc2', '#222', '#f80', '#3b6', '#ddd', '#c9a', '#69c', '#a22', '#eee'];
    for (let r = 0; r < rows; r++) {
      x.fillStyle = r % 2 ? '#3a3e49' : '#30333d'; x.fillRect(0, r * rh, c.width, rh);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, r * rh + rh - 3, c.width, 3);
      for (let i = 0; i < 74; i++) {
        if (R() < 0.12) continue;
        const px = (i + 0.5) * c.width / 74 + (R() - 0.5) * 3, py = r * rh + rh * 0.62;
        x.fillStyle = cols[(R() * cols.length) | 0]; x.fillRect(px - 3.2, py - 4, 6.4, 9);
        x.fillStyle = ['#e8b796', '#c98d6a', '#8a5a3c', '#f1c9a8'][(R() * 4) | 0]; x.beginPath(); x.arc(px, py - 7, 2.7, 0, 7); x.fill();
        if (R() < 0.25) { x.fillStyle = cols[(R() * cols.length) | 0]; x.fillRect(px - 2.8, py - 10.5, 5.6, 2.2); }
      }
    }
  },
  crowd_row(c, seed = 1) {
    // yan yana oturan/ayakta seyirciler (şeffaf zemin, yatayda döşenebilir)
    const x = c.getContext('2d'), R = rng(seed * 911 + 3), w = c.width, h = c.height, n = 14, pw = w / n;
    const cols = ['#d22', '#fff', '#26c', '#fc2', '#222', '#f70', '#2a6', '#ddd', '#c9a', '#69c', '#a22', '#eee', '#7a3', '#e5a'];
    for (let i = 0; i < n; i++) {
      if (R() < 0.07) continue;
      const cx = (i + 0.5) * pw + (R() - 0.5) * pw * 0.2, stand = R() < 0.3, top = stand ? h * 0.06 : h * 0.26;
      const shirt = cols[(R() * cols.length) | 0], skin = ['#e8b796', '#c98d6a', '#8a5a3c', '#f1c9a8'][(R() * 4) | 0];
      x.fillStyle = shirt; x.beginPath(); x.roundRect(cx - pw * 0.34, top + h * 0.2, pw * 0.68, h, pw * 0.14); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(cx - pw * 0.34, top + h * 0.2, pw * 0.14, h);
      if (R() < 0.3) { x.fillStyle = shirt; x.fillRect(cx + pw * 0.26, top - h * 0.02, pw * 0.13, h * 0.36); x.fillStyle = skin; x.beginPath(); x.arc(cx + pw * 0.32, top - h * 0.04, pw * 0.08, 0, 7); x.fill(); }
      x.fillStyle = skin; x.beginPath(); x.arc(cx, top + h * 0.1, pw * 0.2, 0, 7); x.fill();
      const hr = R();
      if (hr < 0.45) { x.fillStyle = cols[(R() * cols.length) | 0]; x.beginPath(); x.arc(cx, top + h * 0.07, pw * 0.21, Math.PI, 0); x.fill(); x.fillRect(cx - pw * 0.21, top + h * 0.06, pw * 0.5, h * 0.03); }
      else { x.fillStyle = ['#221', '#532', '#111', '#a83', '#888'][(R() * 5) | 0]; x.beginPath(); x.arc(cx, top + h * 0.075, pw * 0.2, Math.PI * 0.95, Math.PI * 0.05); x.fill(); }
    }
  },
  tree(c, seed = 1) {
    const x = c.getContext('2d'), R = rng(seed * 97 + 5), w = c.width, h = c.height;
    x.fillStyle = '#4a3423'; x.fillRect(w * 0.47, h * 0.62, w * 0.06, h * 0.38);
    for (let i = 0; i < 260; i++) {
      const a = R() * 6.28, rr = Math.sqrt(R()) * w * 0.36;
      const px = w / 2 + Math.cos(a) * rr * (0.75 + 0.2 * seed % 1), py = h * 0.4 + Math.sin(a) * rr * 0.95;
      const lit = 0.55 + 0.45 * (1 - py / h) + (px / w - 0.5) * 0.5;
      x.fillStyle = `rgb(${(30 + 40 * lit) | 0},${(70 + 80 * lit + R() * 20) | 0},${(25 + 25 * lit) | 0})`;
      x.beginPath(); x.arc(px, py, w * (0.035 + R() * 0.045), 0, 7); x.fill();
    }
  },
  person(c, seed = 1) {
    const x = c.getContext('2d'), R = rng(seed * 131 + 9), w = c.width, h = c.height;
    const shirt = ['#d22', '#26c', '#eee', '#fb2', '#2a6', '#f70', '#333', '#a3c'][(R() * 8) | 0];
    const pants = ['#234', '#333', '#556', '#754', '#225'][(R() * 5) | 0];
    const skin = ['#e8b796', '#c98d6a', '#8a5a3c', '#f1c9a8'][(R() * 4) | 0];
    x.fillStyle = pants; x.fillRect(w * 0.36, h * 0.55, w * 0.12, h * 0.42); x.fillRect(w * 0.52, h * 0.55, w * 0.12, h * 0.42);
    x.fillStyle = '#111'; x.fillRect(w * 0.33, h * 0.95, w * 0.16, h * 0.05); x.fillRect(w * 0.51, h * 0.95, w * 0.16, h * 0.05);
    x.fillStyle = shirt; x.beginPath(); x.roundRect(w * 0.3, h * 0.22, w * 0.4, h * 0.37, w * 0.08); x.fill();
    const up = R() > 0.5;
    x.fillRect(w * 0.18, up ? h * 0.06 : h * 0.24, w * 0.11, h * 0.3); x.fillRect(w * 0.71, h * 0.24, w * 0.11, h * 0.3);
    x.fillStyle = skin; x.beginPath(); x.arc(w * 0.5, h * 0.13, w * 0.13, 0, 7); x.fill();
    if (R() > 0.4) { x.fillStyle = shirt; x.fillRect(w * 0.36, h * 0.03, w * 0.28, h * 0.06); x.fillRect(w * 0.36, h * 0.07, w * 0.4, h * 0.025); }
  },
  wall_banner(c) {
    const x = c.getContext('2d'); x.fillStyle = '#e9e9ea'; x.fillRect(0, 0, c.width, c.height);
    const names = [['APEX OIL', '#c1121f', '#fff'], ['NITRO COLA', '#0b3d91', '#ffd60a'], ['VOLT TIRES', '#111', '#f5cb5c'], ['TURBO PARTS', '#ffd60a', '#111']];
    const w = c.width / names.length;
    names.forEach((n, i) => {
      x.fillStyle = n[1]; x.fillRect(i * w + 6, c.height * 0.2, w - 12, c.height * 0.62);
      x.fillStyle = n[2]; x.font = `900 ${c.height * 0.4}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(n[0], i * w + w / 2, c.height * 0.53, w - 30);
    });
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, c.width, c.height * 0.06);
    x.fillStyle = '#b00'; x.fillRect(0, c.height * 0.9, c.width, c.height * 0.1);
    noise(x, c.width, c.height, 14, 2);
  },
  billboard(c, seed = 1) {
    const x = c.getContext('2d');
    const v = [['SPEEDWAY', 'FUEL', '#0b3d91', '#fff', '#ffd60a'], ['GRIP MAX', 'RACING TIRES', '#c1121f', '#fff', '#111'], ['THUNDER', 'ENERGY', '#111', '#7CFC00', '#fff']][seed % 3];
    const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, v[2]); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = v[3]; x.font = `900 italic ${c.height * 0.42}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(v[0], c.width / 2, c.height * 0.38, c.width * 0.9);
    x.fillStyle = v[4]; x.font = `700 ${c.height * 0.2}px Arial`; x.fillText(v[1], c.width / 2, c.height * 0.76, c.width * 0.9);
    x.strokeStyle = '#fff'; x.lineWidth = 8; x.strokeRect(4, 4, c.width - 8, c.height - 8);
  },
  horizon(c) {
    const x = c.getContext('2d'), R = rng(77), w = c.width, h = c.height;
    for (let layer = 0; layer < 3; layer++) {
      const base = h * (0.55 + layer * 0.13), col = [`rgba(120,140,150,0.85)`, `rgba(60,95,70,0.95)`, `rgba(38,70,42,1)`][layer];
      x.fillStyle = col; x.beginPath(); x.moveTo(0, h);
      const n = 90; const ph = R() * 6;
      for (let i = 0; i <= n; i++) {
        const u = i / n * Math.PI * 2;
        const y = base - (Math.sin(u * 3 + ph) + Math.sin(u * 7 + ph * 2) * 0.6 + Math.sin(u * 19 + ph) * 0.35 + Math.sin(u * 41) * 0.2) * h * 0.035 - h * 0.03;
        x.lineTo(i / n * w, y);
      }
      x.lineTo(w, h); x.fill();
    }
    if (true) { // uzak binalar
      for (let i = 0; i < 26; i++) { const bx = R() * w, bw = 8 + R() * 22, bh = 10 + R() * 46; x.fillStyle = `rgba(${150 + R() * 40},${160 + R() * 40},${175 + R() * 40},0.8)`; x.fillRect(bx, h * 0.62 - bh, bw, bh); }
      x.fillStyle = 'rgba(38,70,42,1)'; x.fillRect(0, h * 0.8, w, h * 0.2);
    }
  },
  cloud(c, seed = 1) {
    const x = c.getContext('2d'), R = rng(seed * 53 + 1), w = c.width, h = c.height;
    for (let i = 0; i < 26; i++) {
      const px = w * (0.2 + R() * 0.6), py = h * (0.4 + R() * 0.25), r = w * (0.08 + R() * 0.14);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
  },
  infield_logo(c) {
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.font = `900 italic ${c.height * 0.5}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 14; x.strokeStyle = '#c1121f'; x.strokeText('DAYTONA', c.width / 2, c.height / 2, c.width * 0.92);
    x.fillText('DAYTONA', c.width / 2, c.height / 2, c.width * 0.92);
  },
};

const SIZES = { asphalt: [512, 512], grass: [512, 512], crowd: [1024, 512], tree: [256, 384], person: [128, 256], wall_banner: [2048, 128], billboard: [1024, 512], horizon: [4096, 512], cloud: [512, 256], infield_logo: [1024, 256], crowd_row: [1024, 128] };

function loadImage(url) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}

// ad: dosya adı (uzantısız), kind: yedek tipi, seed: varyant
// isteğe bağlı görsel (yoksa null): gökyüzü panoraması, menü/yükleme arka planları
export function tryImage(path) { return loadImage(path); }

export async function getImage(name, kind, seed) {
  const im = await loadImage(`assets/textures/${name}.png`);
  if (im) return im;
  const [w, h] = SIZES[kind];
  const c = canvas(w, h);
  FALLBACK[kind](c, seed);
  return c;
}

export function tex(img, { repeat = false, srgb = true, aniso = 4 } = {}) {
  const t = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}

export async function loadAssets(time = 1) {
  const A = {};
  const jobs = [
    ['asphalt', 'asphalt'], ['grass', 'grass'], ['crowd', 'crowd'], ['wall_banner', 'wall_banner'], ['horizon', 'horizon'], ['infield_logo', 'infield_logo'],
    ['tree1', 'tree', 1], ['tree2', 'tree', 2], ['tree3', 'tree', 3],
    ['person1', 'person', 1], ['person2', 'person', 2], ['person3', 'person', 3], ['person4', 'person', 4],
    ['billboard1', 'billboard', 0], ['billboard2', 'billboard', 1], ['billboard3', 'billboard', 2],
    ['cloud1', 'cloud', 1], ['cloud2', 'cloud', 2],
    ['crowd_row1', 'crowd_row', 1], ['crowd_row2', 'crowd_row', 2], ['crowd_row3', 'crowd_row', 3],
  ];
  await Promise.all(jobs.map(async ([n, k, s]) => { A[n] = await getImage(n, k, s); }));
  const sn = ['sky_day', 'sky_afternoon', 'sky_sunset', 'sky_night'][time] || 'sky_afternoon';
  A.sky = await loadImage(`assets/textures/${sn}.png`) || await loadImage(`assets/textures/${sn}.jpg`);
  return A;
}

// pist yüzeyi kompozit dokusu: asfalt + çizgiler + lastik izleri
export function roadTexture(asphaltImg, apronFrac) {
  const S = 1024, c = canvas(S, S), x = c.getContext('2d');
  const tile = 256;
  for (let i = 0; i < S; i += tile) for (let j = 0; j < S; j += tile) x.drawImage(asphaltImg, i, j, tile, tile);
  const u0 = apronFrac * S;
  // apron biraz açık ton
  x.fillStyle = 'rgba(160,160,160,0.10)'; x.fillRect(0, 0, u0, S);
  // yarış çizgisi lastik izleri
  const lane = (S - u0);
  for (const [f, a] of [[0.17, 0.3], [0.42, 0.22], [0.68, 0.16]]) {
    const g = x.createLinearGradient(u0 + lane * (f - 0.1), 0, u0 + lane * (f + 0.1), 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(u0 + lane * (f - 0.1), 0, lane * 0.2, S);
  }
  // serim derzleri
  x.fillStyle = 'rgba(0,0,0,0.22)';
  for (const f of [0.25, 0.5, 0.75]) x.fillRect(u0 + lane * f, 0, 2, S);
  // çizgiler
  x.fillStyle = '#e8c21a'; x.fillRect(u0 - 14, 0, 6, S); x.fillRect(u0 - 4, 0, 6, S);
  x.fillStyle = '#e9e9e9'; x.fillRect(10, 0, 8, S); x.fillRect(S - 16, 0, 7, S);
  return c;
}

export function fenceTexture() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(190,195,200,0.75)'; x.lineWidth = 1.6;
  for (let i = -256; i < 512; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 256, 256); x.stroke(); x.beginPath(); x.moveTo(i + 256, 0); x.lineTo(i, 256); x.stroke(); }
  x.fillStyle = 'rgba(150,155,160,1)'; x.fillRect(0, 0, 9, 256); x.fillRect(0, 0, 256, 7); x.fillRect(0, 124, 256, 4);
  return c;
}

export function blobTexture() {
  const c = canvas(64, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 64, 4, 32, 64, 60);
  x.save(); x.scale(1, 1);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 128); x.restore();
  return c;
}

export function checkerTexture() {
  const c = canvas(256, 32), x = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; x.fillRect(i * 8, j * 8, 8, 8); }
  return c;
}
