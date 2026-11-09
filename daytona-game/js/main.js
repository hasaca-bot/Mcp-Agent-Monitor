import * as THREE from 'three';
import { buildPost } from './post.js';
import { buildTrack } from './track.js';
import { Race, NUM_CARS } from './game.js';
import { CAR } from './physics.js';
import { loadAssets, tryImage } from './assets.js';
import { buildScene } from './scene.js';
import { loadCarModel, CarRenderer, Particles } from './cars.js';
import { GameAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
addEventListener('error', (e) => { const l = document.getElementById('loadTxt'); if (l) l.textContent = 'Hata: ' + (e.message || e.type); });
addEventListener('unhandledrejection', (e) => { const l = document.getElementById('loadTxt'); if (l) l.textContent = 'Hata: ' + (e.reason && e.reason.message || e.reason); });
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');
const params = new URLSearchParams(location.search);

// ---------------- ayarlar ----------------
const DEF = { laps: 5, difficulty: 1, gridPos: 20, quality: isTouch ? 1 : 2, assist: 1, autoGas: isTouch ? 1 : 0, tilt: 0, time: 1, cam: 0 };
let opts = { ...DEF };
try { Object.assign(opts, JSON.parse(localStorage.getItem('daytona40') || '{}')); } catch (e) { /* yok say */ }
for (const k of Object.keys(DEF)) if (params.has(k)) opts[k] = +params.get(k);
document.querySelectorAll('.opt').forEach((el) => {
  const k = el.dataset.k;
  const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === +opts[k]));
  el.addEventListener('click', (e) => { if (e.target.dataset.v === undefined) return; opts[k] = +e.target.dataset.v; sync(); try { localStorage.setItem('daytona40', JSON.stringify(opts)); } catch (e2) { /* */ } });
  sync();
});

const QUALITY = [
  { pr: 1, shadows: false, shadowSize: 0, post: false, bloom: false, aniso: 2, trees: 500, people: 260, msaa: false, rows: 0.45, envEvery: 0 },
  { pr: 1.5, shadows: true, shadowSize: 1024, post: true, bloom: false, aniso: 4, trees: 900, people: 500, msaa: false, rows: 0.75, envEvery: 0 },
  { pr: 2, shadows: true, shadowSize: 2048, post: true, bloom: true, aniso: 8, trees: 1400, people: 800, msaa: true, rows: 1, envEvery: isTouch ? 0 : 240 },
];

// ---------------- girişler ----------------
const keys = {};
const input = { steer: 0, thr: 0, brk: 0 };
let steerTarget = 0, tiltSteer = 0;
const touch = { l: 0, r: 0, gas: 0, brk: 0 };
addEventListener('keydown', (e) => { keys[e.code] = 1; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); if (G) { if (e.code === 'KeyC') nextCam(); if (e.code === 'KeyR') G.race.resetPlayer(); if (e.code === 'KeyP' || e.code === 'Escape') togglePause(); } });
addEventListener('keyup', (e) => { keys[e.code] = 0; });
function bindTouch(id, key) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); touch[key] = 1; el.classList.add('down'); }, off = (e) => { e.preventDefault(); touch[key] = 0; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
bindTouch('tL', 'l'); bindTouch('tR', 'r'); bindTouch('tGas', 'gas'); bindTouch('tBrk', 'brk');
addEventListener('deviceorientation', (e) => {
  if (e.beta == null) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let t = ang === 90 ? -e.beta : ang === 270 || ang === -90 ? e.beta : -e.gamma;
  tiltSteer = Math.max(-1, Math.min(1, t / 22));
});
function readInput(dt, speed) {
  const kl = keys.ArrowLeft || keys.KeyA || touch.l, kr = keys.ArrowRight || keys.KeyD || touch.r;
  steerTarget = (kl ? 1 : 0) - (kr ? 1 : 0);
  if (opts.tilt && !kl && !kr) input.steer = tiltSteer;
  else {
    const rate = (steerTarget === 0 ? 4.5 : 2.6) * dt;
    const d = steerTarget - input.steer; input.steer += Math.abs(d) < rate ? d : Math.sign(d) * rate;
  }
  const brk = keys.ArrowDown || keys.KeyS || keys.Space || touch.brk ? 1 : 0;
  let thr = keys.ArrowUp || keys.KeyW || touch.gas ? 1 : 0;
  if (opts.autoGas && !brk) thr = 1;
  input.thr += (thr - input.thr) * Math.min(1, dt * 8); input.brk += (brk - input.brk) * Math.min(1, dt * 10);
}

// ---------------- oyun durumu ----------------
let G = null, paused = false, camMode = 0;
const audio = new GameAudio();
const CAMS = ['Takip', 'Uzak', 'Kaput', 'TV'];
function nextCam() { camMode = (camMode + 1) % CAMS.length; flash(CAMS[camMode], 700); }
function togglePause() { if (!G || G.race.phase === 'done') return; paused = !paused; $('pause').classList.toggle('hidden', !paused); audio.mute(paused); G.clock.getDelta(); }
let msgT = 0;
function flash(t, ms = 1800, color = '#fff') { const m = $('msg'); m.textContent = t; m.style.color = color; m.classList.add('show'); clearTimeout(msgT); msgT = setTimeout(() => m.classList.remove('show'), ms); }
const fmt = (t) => { if (!t) return '-'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };

$('start').onclick = () => startGame();
$('bCam').onclick = nextCam; $('bReset').onclick = () => G && G.race.resetPlayer(); $('bPause').onclick = togglePause;
$('resume').onclick = togglePause;
const toMenu = () => { sessionStorage.removeItem('d40auto'); location.reload(); };
$('toMenu').onclick = toMenu; $('toMenu2').onclick = toMenu;
$('again').onclick = () => { sessionStorage.setItem('d40auto', '1'); location.reload(); };

async function startGame() {
  $('menu').classList.add('hidden'); $('loading').classList.remove('hidden');
  audio.start();
  if (opts.tilt && window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) { try { await DeviceOrientationEvent.requestPermission(); } catch (e) { /* */ } }
  await new Promise((r) => setTimeout(r, 30));
  try { G = await init(); } catch (e) { $('loadTxt').textContent = 'Hata: ' + e.message; console.error(e); return; }
  $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
  window.__G = G;
  G.clock.getDelta();
  requestAnimationFrame(frame);
}

async function init() {
  const q = { ...(QUALITY[opts.quality] || QUALITY[1]) };
  q.samples = q.msaa ? (isTouch ? 2 : 4) : 0;
  camMode = opts.cam | 0;
  const T = buildTrack();
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.post, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, q.pr);
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = q.shadows; renderer.shadowMap.type = isTouch ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;   // mobilde ucuz filtre
  q.aniso = Math.min(q.aniso, renderer.capabilities.getMaxAnisotropy());

  $('loadTxt').textContent = 'Dokular yükleniyor';
  const [A, model] = await Promise.all([loadAssets(opts.time), loadCarModel()]);
  $('loadTxt').textContent = 'Pist kuruluyor';
  await new Promise((r) => setTimeout(r, 20));
  const { scene, sun, sunDir, TM } = buildScene(T, A, q, opts.time);
  renderer.toneMappingExposure = TM.exposure;

  // ortam yansıması: pist üzerinden küp harita → PMREM
  const F = {}; T.frame(260, 5, F);
  const hf = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType });
  const cubeCam = new THREE.CubeCamera(1, 12000, cubeRT); cubeCam.position.set(F.px, F.py + 2.2, F.pz);
  cubeCam.update(renderer, scene);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromCubemap(cubeRT.texture).texture;

  const race = new Race(T, { laps: opts.laps, difficulty: opts.difficulty, gridPos: opts.gridPos, assist: !!opts.assist, nCars: NUM_CARS, autopilot: params.has('demo'), seed: (Math.random() * 1000) | 0 });
  const cars = new CarRenderer(scene, model, race.world.cars, T, q);
  const parts = new Particles(scene, 500);

  const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.6, 12000);
  const post = q.post ? buildPost(renderer, scene, camera, q, pr, hf) : null;
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (post) post.resize(renderer.getPixelRatio()); });

  // TV kameraları
  const tvCams = [];
  for (let s = 100; s < T.L; s += 330) { T.frame(s, T.W, F); tvCams.push({ s, p: new THREE.Vector3(F.px + F.ox * 9, F.py + 9, F.pz + F.oz * 9) }); }

  // mini harita
  const map = $('map'), mctx = map.getContext('2d');
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (let i = 0; i < T.n; i += 8) { mnx = Math.min(mnx, T.x[i]); mxx = Math.max(mxx, T.x[i]); mnz = Math.min(mnz, T.z[i]); mxz = Math.max(mxz, T.z[i]); }
  const msc = Math.min((map.width - 16) / (mxx - mnx), (map.height - 16) / (mxz - mnz));
  const mx = (x) => 8 + (x - mnx) * msc + (map.width - 16 - (mxx - mnx) * msc) / 2, mz = (z) => map.height - 8 - (z - mnz) * msc - (map.height - 16 - (mxz - mnz) * msc) / 2;
  const mapBg = document.createElement('canvas'); mapBg.width = map.width; mapBg.height = map.height;
  { const c = mapBg.getContext('2d'); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4; c.beginPath(); for (let i = 0; i <= T.n; i += 8) { const j = i % T.n; c.lineTo(mx(T.x[j]), mz(T.z[j])); } c.closePath(); c.stroke(); c.fillStyle = '#ffcc00'; c.fillRect(mx(T.x[0]) - 1.5, mz(T.z[0]) - 6, 3, 12); }

  $('posN').textContent = '/' + race.world.cars.length; $('lapN').textContent = '/' + race.laps;
  flash('TEMPO TURU', 2500, '#ffcc00');
  return { T, renderer, scene, camera, post, cubeCam, pm, q, TM, race, cars, parts, sun, sunDir, tvCams, clock: new THREE.Clock(), mctx, map, mapBg, mx, mz, F,
    camPos: new THREE.Vector3(), camFwd: new THREE.Vector3(1, 0, 0), camUp: new THREE.Vector3(0, 1, 0), camInit: false, lastPlace: 99, shake: 0, hudT: 0, lastLap: 0, frameN: 0, fpsT: 0, fpsN: 0, prBase: pr, prScale: 1, prCap: 1, good: 0, warm: 0, raised: false, hud: { kmh: -1, rpm: -1, elK: $('kmh'), elR: $('rpmBar') }, fps: 60 };
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

function frame() {
  requestAnimationFrame(frame);
  const g = G; if (!g) return;
  let dt = Math.min(0.05, g.clock.getDelta());
  if (paused) return;
  const race = g.race, p = race.player, T = g.T;
  readInput(dt, p.speed);
  race.update(dt, input);
  if (race.justGreen) { race.justGreen = false; flash('YEŞİL BAYRAK!', 2200, '#3ddc84'); audio.beep(880, 0.6); audio.cheer(1.2); }

  // olaylar → parçacık / ses / sarsıntı
  const ev = race.world.events;
  for (const e of ev) {
    const c = e.car, i = c.id, P = g.cars.pos[i];
    const near = P.distanceTo(g.camPos) < 120;
    if (near) {
      const n = Math.min(10, 2 + e.v);
      for (let k = 0; k < n; k++) g.parts.emit(P.x + (Math.random() - 0.5) * 2, P.y + 0.4, P.z + (Math.random() - 0.5) * 2, g.cars.fwd[i].x * c.speed * 0.7 + (Math.random() - 0.5) * 8, 1 + Math.random() * 4, g.cars.fwd[i].z * c.speed * 0.7 + (Math.random() - 0.5) * 8, 1);
    }
    if (c === p || e.other === p) { g.shake = Math.min(1, g.shake + e.v * 0.08); audio.hit(e.v); if (navigator.vibrate) navigator.vibrate(Math.min(120, e.v * 12)); }
    else if (near) audio.hit(e.v * 0.3);
  }
  ev.length = 0;

  g.cars.update();
  // duman: kayan / çimdeki araçlar
  g.frameN++;
  // uyarlanabilir çözünürlük: kare hızı düşerse iç çözünürlüğü kıs, toparlanınca geri aç (akıcılık > keskinlik)
  g.fpsT += dt; g.fpsN++;
  if (g.fpsT >= 1) {
    const fps = g.fpsN / g.fpsT; g.fpsT = 0; g.fpsN = 0; g.fps = fps; g.warm++;
    if (g.warm > 3) {
      let sc = g.prScale;
      if (fps < 50) { if (g.raised) g.prCap = Math.max(0.5, sc * 0.94); sc = Math.max(0.5, sc * (fps < 38 ? 0.8 : 0.9)); g.good = 0; g.raised = false; }
      else if (fps > 57) { g.raised = false; if (++g.good >= 4 && sc < g.prCap - 0.01) { sc = Math.min(g.prCap, sc * 1.07); g.good = 0; g.raised = true; } }
      else g.good = 0;
      if (sc !== g.prScale) { g.prScale = sc; const npr = g.prBase * sc; g.renderer.setPixelRatio(npr); g.renderer.setSize(innerWidth, innerHeight, false); if (g.post) g.post.resize(npr); }
    }
  }
  for (const c of race.world.cars) {
    if ((c.slip > 1.1 || (c.onGrass && c.speed > 12)) && (g.frameN + c.id) % 2 === 0) {
      const P = g.cars.pos[c.id], Fw = g.cars.fwd[c.id];
      if (P.distanceToSquared(g.camPos) < 250 * 250) g.parts.emit(P.x - Fw.x * 1.8 + (Math.random() - 0.5), P.y + 0.3, P.z - Fw.z * 1.8 + (Math.random() - 0.5), Fw.x * c.speed * 0.25, 1.2, Fw.z * c.speed * 0.25, 0);
    }
  }
  g.parts.update(dt);

  // ---------- kamera ----------
  const cam = g.camera, P = g.cars.pos[p.id], Fw = g.cars.fwd[p.id], Up = g.cars.up[p.id];
  const sp = p.speed, k = 1 - Math.exp(-dt * 6);
  if (!g.camInit) { g.camFwd.copy(Fw); g.camUp.copy(UP); }
  g.camFwd.lerp(Fw, 1 - Math.exp(-dt * 5)).normalize();
  g.camUp.lerp(v1.copy(UP).lerp(Up, 0.7), 1 - Math.exp(-dt * 3)).normalize();
  const sf = Math.min(1, sp / 90);
  let hfov = 80 + sf * 8, fov = 0;       // yatay FOV (derece); dikey FOV ekran oranından türetilir
  if (camMode === 0 || camMode === 1) {
    const dist = camMode === 0 ? 5.2 : 8.2, h = camMode === 0 ? 1.95 : 3.0;      // takip: araç merkezinin ~5 m arkası
    v1.copy(P).addScaledVector(g.camFwd, -dist - sf * 0.5).addScaledVector(g.camUp, h);
    if (!g.camInit) g.camPos.copy(v1); else g.camPos.lerp(v1, 1 - Math.exp(-dt * 14));
    cam.position.copy(g.camPos); cam.up.copy(g.camUp);
    cam.lookAt(v2.copy(P).addScaledVector(Fw, 4).addScaledVector(g.camUp, 0.35));   // araç kadrajın orta-üstünde, gösterge altında kalmasın
  } else if (camMode === 2) {
    g.camPos.copy(P).addScaledVector(Fw, 0.75).addScaledVector(Up, 1.32);
    cam.position.copy(g.camPos); cam.up.copy(Up); cam.lookAt(v2.copy(g.camPos).addScaledVector(Fw, 10)); hfov += 10;
  } else {
    let best = g.tvCams[0], bd = 1e9;
    for (const c of g.tvCams) { const d = T.delta(c.s, p.s); const dd = d > -60 ? d + 60 : d + T.L; if (dd < bd) { bd = dd; best = c; } }
    g.camPos.copy(best.p); cam.position.copy(best.p); cam.up.copy(UP); cam.lookAt(P);
    fov = Math.max(9, Math.min(46, 2200 / Math.max(30, best.p.distanceTo(P))));
  }
  g.camInit = true;
  if (g.shake > 0.01) { cam.position.x += (Math.random() - 0.5) * g.shake * 0.5; cam.position.y += (Math.random() - 0.5) * g.shake * 0.5; g.shake *= Math.exp(-dt * 6); }
  if (camMode !== 3 && sp > 60) { const s = (sp - 60) * 0.0006; cam.position.y += (Math.random() - 0.5) * s; }
  if (!fov) fov = Math.max(36, Math.min(74, 2 * Math.atan(Math.tan(hfov * Math.PI / 360) / cam.aspect) * 180 / Math.PI));
  cam.fov += (fov - cam.fov) * k; cam.updateProjectionMatrix();

  // gölge kamerası oyuncuyu izler
  g.sun.target.position.copy(P); g.sun.position.copy(P).addScaledVector(g.sunDir, 300);

  // canlı ortam yansıması (Yüksek kalite): küp haritayı oyuncunun konumundan seyrek yenile
  if (g.q.envEvery && g.frameN % g.q.envEvery === g.q.envEvery - 1) {
    g.cubeCam.position.copy(P).addScaledVector(Up, 2.2);
    g.cubeCam.update(g.renderer, g.scene);
    const old = g.scene.environment; g.scene.environment = g.pm.fromCubemap(g.cubeCam.renderTarget.texture).texture; if (old) old.dispose();
  }
  if (g.post) { g.post.update(dt, sp, g.shake, g.sunDir, g.TM.flare); g.post.composer.render(); } else g.renderer.render(g.scene, cam);

  // ---------- ses ----------
  let pack = 0, prpm = 6000;
  for (const c of race.world.cars) { if (c === p) continue; const d = Math.abs(T.delta(c.s, p.s)); if (d < 80) { pack += 1 - d / 80; prpm = c.rpm; } }
  // tribüne yakınlık → yankı + kalabalık
  const ds0 = Math.abs(T.delta(p.s, 0)), dsB = Math.abs(T.delta(p.s, T.L / 2));
  const stand = Math.max(1 - Math.max(0, ds0 - 600) / 300, 0.6 * (1 - Math.max(0, dsB - 250) / 200), 0) * (0.6 + 0.4 * Math.max(0, p.d) / T.W);
  audio.update(dt, p.rpm, race.phase === 'pace' ? 0.4 : p.thr, sp, p.slip, pack, prpm, Math.max(0, Math.min(1, stand)));
  if (p.place < g.lastPlace && race.phase === 'race') audio.cheer(p.place <= 3 ? 0.8 : 0.25);
  g.lastPlace = p.place;

  // ---------- HUD ----------
  const kmh = Math.round(sp * 3.6), rp = Math.round(Math.min(1, p.rpm / 9200) * 50);
  if (kmh !== g.hud.kmh) { g.hud.kmh = kmh; g.hud.elK.textContent = kmh; }
  if (rp !== g.hud.rpm) { g.hud.rpm = rp; g.hud.elR.style.transform = `scaleX(${rp / 50})`; }
  g.hudT -= dt;
  if (g.hudT <= 0) {
    g.hudT = 0.2;
    $('gear').textContent = p.vx < -0.5 ? 'R' : p.gear;
    $('pos').textContent = p.place;
    $('lap').textContent = Math.max(1, Math.min(race.laps, p.lap));
    $('draftBar').style.width = Math.min(100, p.draft / 0.36 * 100) + '%';
    $('tCur').textContent = p.lap >= 1 ? fmt(race.world.time - p.lapStart) : '-';
    $('tLast').textContent = fmt(p.lastLap); $('tBest').textContent = fmt(p.bestLap);
    if (p.lap !== g.lastLap) { g.lastLap = p.lap; if (p.lap === race.laps && race.laps > 1) { flash('SON TUR!', 2200, '#ffcc00'); audio.cheer(1); } }
    if (race.phase === 'race' && Math.abs(p.psi) > 2 && sp > 5 && p.vx > 0) flash('TERS YÖN!', 600, '#ff3b3b');
    // sıralama kulesi
    const st = race.standings, me = p.place - 1; const rows = new Set([0, 1, 2]);
    for (let i = me - 2; i <= me + 2; i++) if (i >= 0 && i < st.length) rows.add(i);
    let h = '';
    for (const i of [...rows].sort((a, b) => a - b)) {
      const c = st[i]; const gap = c === p ? '' : ((c.progress - p.progress) / Math.max(20, p.speed));
      h += `<div class="${c === p ? 'me' : ''}"><b>${i + 1}</b><i style="background:${c.color}"></i><span>${c === p ? 'SEN' : '#' + (c.id + 2)}</span><em>${c === p ? '' : (gap > 0 ? '+' : '') + gap.toFixed(1)}</em></div>`;
    }
    $('tower').innerHTML = h;
    // mini harita
    const m = g.mctx; m.clearRect(0, 0, g.map.width, g.map.height); m.drawImage(g.mapBg, 0, 0);
    for (const c of race.world.cars) { if (c === p) continue; const P2 = g.cars.pos[c.id]; m.fillStyle = c.color; m.fillRect(g.mx(P2.x) - 2, g.mz(P2.z) - 2, 4, 4); }
    m.fillStyle = '#fff'; m.strokeStyle = '#000'; m.beginPath(); m.arc(g.mx(P.x), g.mz(P.z), 4.5, 0, 7); m.fill(); m.stroke();
  }
  if (race.phase === 'done' && !g.shown) {
    g.shown = true; audio.cheer(1.5);
    setTimeout(() => showResults(g), 2500);
    flash(p.place === 1 ? 'KAZANDIN!' : `${p.place}. BİTİRDİN`, 2500, '#ffcc00');
  }
}

function showResults(g) {
  const race = g.race, st = race.standings, p = race.player;
  $('resTitle').textContent = p.place === 1 ? '🏁 Birinci oldun!' : `🏁 ${p.place}. sırada bitirdin`;
  let h = '';
  st.forEach((c, i) => { if (i < 10 || c === p) h += `<div class="${c === p ? 'me' : ''}"><b>${i + 1}.</b><span>${c === p ? 'SEN' : 'Araç #' + (c.id + 2)}</span><em>en iyi tur ${fmt(c.bestLap)}</em></div>`; });
  $('resTable').innerHTML = h;
  $('result').classList.remove('hidden');
}

// isteğe bağlı arayüz görselleri (assets/ui/*.png) — yoksa varsayılan stil
tryImage('assets/ui/menu_bg.png').then((im) => { if (im) for (const id of ['menu', 'pause', 'result']) { $(id).style.backgroundImage = "linear-gradient(rgba(5,7,12,.45),rgba(5,7,12,.8)),url('assets/ui/menu_bg.png')"; $(id).style.backgroundSize = 'cover'; $(id).style.backgroundPosition = 'center'; } });
tryImage('assets/ui/loading.png').then((im) => { if (im) { const l = $('loading'); l.style.backgroundImage = "linear-gradient(rgba(5,7,12,.2),rgba(5,7,12,.7)),url('assets/ui/loading.png')"; l.style.backgroundSize = 'cover'; l.style.backgroundPosition = 'center'; } });
tryImage('assets/ui/logo.png').then((im) => { if (im) { const h = document.querySelector('#menu h1'); h.innerHTML = ''; im.style.cssText = 'max-width:100%;max-height:22vh;display:block'; h.appendChild(im); } });

if (sessionStorage.getItem('d40auto') || params.has('auto')) { sessionStorage.removeItem('d40auto'); startGame(); }
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !paused) togglePause(); });
