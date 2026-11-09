// Statik dünya: pist şeritleri, duvarlar, tribünler, 2D billboard çevre (ağaç, insan, bulut, ufuk), göl, gökyüzü.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, roadTexture, fenceTexture, checkerTexture } from './assets.js';

const F = {};
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// pts: [{d, out, dy, absY, u}]
function ribbon(T, s0, s1, step, pts, vLen = 20, wantUp = true) {
  const n = Math.max(1, Math.round((s1 - s0) / step)), m = pts.length;
  const pos = new Float32Array((n + 1) * m * 3), uv = new Float32Array((n + 1) * m * 2);
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * i / n;
    for (let j = 0; j < m; j++) {
      const p = pts[j];
      T.frame(s, p.d, F);
      const k = (i * m + j) * 3, out = p.out || 0;
      pos[k] = F.px + F.ox * out; pos[k + 2] = F.pz + F.oz * out;
      pos[k + 1] = p.absY !== undefined ? p.absY : F.py + (p.dy || 0);
      uv[(i * m + j) * 2] = p.u; uv[(i * m + j) * 2 + 1] = s / vLen;
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (wantUp) {
    // yukarı bakan yüz garanti
    const nm = g.attributes.normal;
    let sy = 0; for (let i = 0; i < Math.min(nm.count, 60); i++) sy += nm.getY(i);
    if (sy < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.computeVertexNormals(); }
  }
  return g;
}

function crossQuad(w, h, single) {
  // tabanı y=0'da, 2 çapraz düzlem (veya tek)
  const g = new THREE.BufferGeometry();
  const hw = w / 2;
  const P = single ? [[-hw, 0, 0], [hw, 0, 0], [hw, h, 0], [-hw, h, 0]] :
    [[-hw, 0, 0], [hw, 0, 0], [hw, h, 0], [-hw, h, 0], [0, 0, -hw], [0, 0, hw], [0, h, hw], [0, h, -hw]];
  const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const pos = [], uv = [], idx = [], nor = [];
  P.forEach((p, i) => { pos.push(...p); uv.push(...U[i % 4]); nor.push(0, 1, 0); });
  for (let q = 0; q < P.length / 4; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));   // yukarı normal: düz, yumuşak ışık
  g.setIndex(idx);
  return g;
}

// Günün saati ön ayarları: güneş/ay konumu, ışık renkleri, sis, pozlama
export const TIMES = [
  { name: 'Gündüz', elev: 52, az: 124, sunCol: 0xfff6e8, sunI: 4.4, hemiSky: 0xbfd8ff, hemiGnd: 0x4a5a3a, hemiI: 0.26, env: 0.85, fog: 0xc9daee, fogNear: 900, fogFar: 8000, turb: 3.0, ray: 1.0, exposure: 0.52, tint: 0xffffff, crowd: 0xdcdcdc, cloud: 0.9, flare: true },
  { name: 'İkindi', elev: 24, az: 124, sunCol: 0xffe9c8, sunI: 4.8, hemiSky: 0xbfd8ff, hemiGnd: 0x4a5a3a, hemiI: 0.22, env: 0.8, fog: 0xc4d4e6, fogNear: 700, fogFar: 6500, turb: 5.5, ray: 1.6, exposure: 0.58, tint: 0xffffff, crowd: 0xd8d8d8, cloud: 0.85, flare: true },
  { name: 'Gün batımı', elev: 6, az: 124, sunCol: 0xff9a4d, sunI: 4.2, hemiSky: 0x8fa0d8, hemiGnd: 0x4a3a3a, hemiI: 0.2, env: 0.9, fog: 0xe0b89a, fogNear: 500, fogFar: 5500, turb: 9, ray: 3.2, exposure: 0.66, tint: 0xffc8a0, crowd: 0xd0a890, cloud: 0.9, cloudCol: 0xffb48a, flare: true },
  { name: 'Gece', night: true, elev: 58, az: 300, sunCol: 0xeaf2ff, sunI: 2.6, hemiSky: 0x2a3a66, hemiGnd: 0x10141c, hemiI: 0.42, env: 1.0, fog: 0x070a12, fogNear: 400, fogFar: 4500, turb: 2, ray: 0.2, exposure: 0.85, tint: 0x30384a, crowd: 0x8c8f99, cloud: 0.12, flare: false },
];

export function buildScene(T, A, q, time = 1) {
  const TM = TIMES[time] || TIMES[1];
  const scene = new THREE.Scene();
  const W = T.W, AP = T.apron, L = T.L;
  const aniso = q.aniso;

  // ---------- gökyüzü + güneş ----------
  const sky = new Sky(); sky.scale.setScalar(9000);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - TM.elev), THREE.MathUtils.degToRad(TM.az));
  const su = sky.material.uniforms;
  su.turbidity.value = TM.turb; su.rayleigh.value = TM.ray; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sunDir);
  if (A.sky) {     // kullanıcı panoraması (2:1 equirectangular)
    const st = tex(A.sky); st.mapping = THREE.EquirectangularReflectionMapping; scene.background = st; scene.backgroundIntensity = TM.night ? 1.0 : 1.6;
  } else if (TM.night) {
    // gece: koyu gökyüzü + yıldızlar (ışık kaynağı stadyum projektörleri)
    scene.background = new THREE.Color(0x05070e);
    const sp = new Float32Array(1800 * 3), SR = rng(99);
    for (let i = 0; i < 1800; i++) { const a = SR() * 6.283, e = Math.asin(SR() * 0.95 + 0.03), r = 6000; sp.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    stars.frustumCulled = false; scene.add(stars);
  } else scene.add(sky);
  scene.fog = new THREE.Fog(TM.fog, TM.fogNear, TM.fogFar);
  scene.environmentIntensity = TM.env;

  const sun = new THREE.DirectionalLight(TM.sunCol, TM.sunI);
  sun.position.copy(sunDir).multiplyScalar(300);
  scene.add(sun, sun.target);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const c = sun.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 50; c.far = 700;
    c.updateProjectionMatrix();     // (eksikti: gölge kutusu varsayılan ±5 m kalıyordu → araç gölgeleri oluşmuyordu)
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2.2;
  }
  scene.add(new THREE.HemisphereLight(TM.hemiSky, TM.hemiGnd, TM.hemiI));

  // ---------- zemin ----------
  const grassT = tex(A.grass, { repeat: true, aniso }); grassT.repeat.set(700, 700);
  const grassM = new THREE.MeshStandardMaterial({ map: grassT, roughness: 1, envMapIntensity: 0.35 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), grassM);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.45; scene.add(ground);

  const grassR = tex(A.grass, { repeat: true, aniso });
  const grassRM = new THREE.MeshStandardMaterial({ map: grassR, roughness: 1, envMapIntensity: 0.35 });
  // iç saha çimi (apron iç kenarından içeri)
  const inf = new THREE.Mesh(ribbon(T, 0, L, 6, [{ d: -AP, u: 0 }, { d: -34, u: 2 }, { d: -70, absY: -0.45, u: 5 }], 12), grassRM);
  inf.receiveShadow = true; scene.add(inf);

  // ---------- yarış yüzeyi + apron ----------
  const tot = AP + W;
  const roadT = tex(roadTexture(A.asphalt, AP / tot), { repeat: true, aniso });
  const roadM = new THREE.MeshStandardMaterial({ map: roadT, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.42 });
  // Asfalt shader'ı: lastik izlerinde parlak (düşük pürüzlülük) yüzey → güneşin zeminden yansıması (glare),
  // prosedürel mikro-normal ile ışıltı, sıyırma açılarında gökyüzü yansıması.
  const u0 = (AP / tot).toFixed(4);
  roadM.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWp;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float lf = (vMapUv.x - ${u0}) / (1.0 - ${u0});
          float groove = exp(-pow((lf - 0.17) / 0.085, 2.0)) + 0.8 * exp(-pow((lf - 0.42) / 0.085, 2.0)) + 0.6 * exp(-pow((lf - 0.68) / 0.085, 2.0));
          groove *= step(0.0, lf);
          float n1 = vn(vWp.xz * 0.23), n2 = vn(vWp.xz * 3.1);
          roughnessFactor = clamp(mix(0.74, 0.3, clamp(groove, 0.0, 1.0)) + (n1 - 0.5) * 0.22 + (n2 - 0.5) * 0.1, 0.18, 1.0);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 q = vWp.xz * 14.0;
          vec3 dn = vec3(vn(q) - 0.5, 0.0, vn(q + 31.7) - 0.5);
          float fade = clamp(1.0 - length(vViewPosition) / 90.0, 0.0, 1.0);
          normal = normalize(normal + dn * 0.16 * fade);
        }`);
  };
  const road = new THREE.Mesh(ribbon(T, 0, L, 3, [{ d: -AP, u: 0 }, { d: 0, u: AP / tot }, { d: W, u: 1 }], tot), roadM);
  road.receiveShadow = true; scene.add(road);

  // start/finiş çizgisi
  const chk = tex(checkerTexture()); chk.magFilter = THREE.NearestFilter;
  const fin = new THREE.Mesh(ribbon(T, -0.9, 0.9, 1.8, [{ d: 0, dy: 0.02, u: 0 }, { d: W, dy: 0.02, u: 1 }], 1.8 / 1),
    new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }));
  fin.material.map.wrapT = THREE.RepeatWrapping; fin.material.map.repeat.set(1, 0.999);
  scene.add(fin);

  // pit yolu (ön düzlük iç tarafı) + pit duvarı
  const pitM = new THREE.MeshStandardMaterial({ map: tex(A.asphalt, { repeat: true, aniso }), roughness: 0.9, color: 0xb9b9b9 });
  const pit = new THREE.Mesh(ribbon(T, -520, 520, 6, [{ d: -30, dy: 0.03, u: 0 }, { d: -17, dy: 0.03, u: 3 }], 4), pitM);
  pit.receiveShadow = true; scene.add(pit);
  const concM = new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  scene.add(new THREE.Mesh(ribbon(T, -480, 480, 6, [{ d: -16.2, dy: 0, u: 0 }, { d: -16.2, dy: 0.9, u: 1 }, { d: -15.8, dy: 0.9, u: 1 }, { d: -15.8, dy: 0, u: 0 }], 20, false), concM));

  // tri-oval çim logosu
  const logoT = tex(A.infield_logo);
  const lg = new THREE.Mesh(ribbon(T, -60, 60, 6, [{ d: -14.2, dy: 0.05, u: 0 }, { d: -9.8, dy: 0.05, u: 1 }], 1, true),
    new THREE.MeshBasicMaterial({ map: logoT, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }));
  { // uv: v boyunca 0..1, u enine → logoyu boyuna yay
    const uv = lg.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (v + 60) / 120, u); }
  }
  scene.add(lg);

  // ---------- duvarlar + tel çit ----------
  const banT = tex(A.wall_banner, { repeat: true, aniso });
  const wallM = new THREE.MeshStandardMaterial({ map: banT, roughness: 0.7, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(ribbon(T, 0, L, 4, [{ d: W, dy: 0, u: 0 }, { d: W, dy: 1.15, u: 1 }], 1, false), wallM);
  { const uv = wall.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, 0, 0); wall.geometry.attributes.uv.setXY(i, -(i >> 1) * 4 / 36, u); } }
  wall.castShadow = q.shadows; wall.receiveShadow = true; scene.add(wall);
  scene.add(new THREE.Mesh(ribbon(T, 0, L, 4, [{ d: W, dy: 1.15, u: 0 }, { d: W, out: 0.5, dy: 1.15, u: 1 }, { d: W, out: 0.5, dy: -0.2, u: 0 }], 20, false), concM));
  const fenT = tex(fenceTexture(), { repeat: true, aniso });
  const fenceM = new THREE.MeshBasicMaterial({ map: fenT, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xcfd4d8 });
  const fence = new THREE.Mesh(ribbon(T, 0, L, 4, [{ d: W, out: 0.25, dy: 1.15, u: 0 }, { d: W, out: 0.25, dy: 5.4, u: 1.5 }, { d: W, out: -0.9, dy: 6.3, u: 1.9 }], 3, false), fenceM);
  fence.renderOrder = 2; scene.add(fence);
  // iç bariyer
  const inner = new THREE.Mesh(ribbon(T, 0, L, 6, [{ d: T.innerWall, dy: -0.3, u: 0 }, { d: T.innerWall, dy: 0.95, u: 1 }, { d: T.innerWall - 0.4, dy: 0.95, u: 1 }, { d: T.innerWall - 0.4, dy: -0.4, u: 0 }], 20, false), concM);
  scene.add(inner);

  // ---------- dış set / servis yolu ----------
  const emb = new THREE.Mesh(ribbon(T, 0, L, 6, [{ d: W, out: 0.5, dy: -0.2, u: 0 }, { d: W, out: 5, dy: -0.2, u: 0.5 }, { d: W, out: 34, absY: -0.45, u: 3 }], 12), grassRM);
  scene.add(emb);

  // ---------- tribünler ----------
  const steelM = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9, side: THREE.DoubleSide });
  const seatM = new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.9, flatShading: true });
  const rowGeos = [[], [], []];
  let rowSeed = 0;
  // Basamaklı tribün: her basamağa (merdiven gibi) dikey bir seyirci şeridi yerleştirilir → gerçek derinlik/paralaks
  function stand(s0, s1, depth, height, rows) {
    if (q.rows < 1) rows = Math.max(4, Math.round(rows * q.rows));
    const front = 6, rd = depth / rows, rh = height / rows, base = 1.2;
    const prof = [];
    for (let r = 0; r < rows; r++) { prof.push({ d: W, out: front + r * rd, dy: base + r * rh, u: r }); prof.push({ d: W, out: front + (r + 1) * rd, dy: base + r * rh, u: r + 0.5 }); }
    prof.push({ d: W, out: front + depth, dy: base + height, u: rows });
    scene.add(new THREE.Mesh(ribbon(T, s0, s1, 8, prof, 26), seatM));
    for (let r = 0; r < rows; r++) {
      const g = ribbon(T, s0, s1, 8, [{ d: W, out: front + (r + 0.62) * rd, dy: base + r * rh, u: 0 }, { d: W, out: front + (r + 0.62) * rd, dy: base + r * rh + Math.max(1.25, rh * 1.12), u: 1 }], 8.2, false);
      const uv = g.attributes.uv, off = ((rowSeed++ * 0.37) % 1);
      for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v + off, u); }
      g.deleteAttribute('normal');
      rowGeos[rowSeed % 3].push(g);
    }
    // ön korkuluk, arka duvar, çatı
    scene.add(new THREE.Mesh(ribbon(T, s0, s1, 8, [{ d: W, out: 6, dy: -0.2, u: 0 }, { d: W, out: 6, dy: 1.3, u: 1 }], 20, false), darkM));
    scene.add(new THREE.Mesh(ribbon(T, s0, s1, 8, [{ d: W, out: 6 + depth, dy: 1.2 + height, u: 0 }, { d: W, out: 6 + depth + 1, absY: -0.45, u: 1 }], 20, false), steelM));
    scene.add(new THREE.Mesh(ribbon(T, s0, s1, 8, [{ d: W, out: 6 + depth * 0.45, dy: height + 9, u: 0 }, { d: W, out: 6 + depth + 2, dy: height + 6.5, u: 1 }], 20, false), steelM));
    scene.add(new THREE.Mesh(ribbon(T, s0, s1, 8, [{ d: W, out: 6 + depth + 1.5, dy: height + 6.6, u: 0 }, { d: W, out: 6 + depth + 1.5, dy: 1.2 + height, u: 1 }], 20, false), darkM));
  }
  stand(-760, 760, 46, 30, 26);                     // ana tribün (ön düzlük + tri-oval)
  stand(L / 2 - 330, L / 2 + 330, 22, 13, 12);      // arka düzlük
  stand(905, 1085, 18, 11, 10);                      // 1. viraj girişi
  stand(L - 1085, L - 905, 18, 11, 10);             // 4. viraj çıkışı
  rowGeos.forEach((gl, i) => {
    if (!gl.length) return;
    const t = tex(A['crowd_row' + (i + 1)], { repeat: true, aniso: Math.min(4, aniso) });
    const mm = new THREE.Mesh(mergeGeometries(gl), new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, color: TM.crowd }));
    scene.add(mm);
  });

  // ---------- billboard instancing yardımcıları ----------
  const dummy = new THREE.Object3D();
  function instanced(img, geo, list, opts = {}) {
    if (!list.length) return;
    const m = new THREE.MeshLambertMaterial({ map: tex(img, { aniso: 2 }), alphaTest: 0.45, side: THREE.DoubleSide, ...opts });
    const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((it, i) => { dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry || 0, 0); dummy.scale.set(it.sx, it.sy, it.sx); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
    scene.add(im); return im;
  }
  const inStand = (s) => { s = T.wrap(s); return s < 790 || s > L - 790 || Math.abs(s - L / 2) < 360 || (s > 880 && s < 1110) || (s > L - 1110 && s < L - 880); };

  // ağaçlar
  const R = rng(1234);
  const trees = [[], [], []];
  const nTrees = q.trees;
  for (let i = 0; i < nTrees; i++) {
    const s = R() * L;
    const outside = R() < 0.72;
    let out;
    if (outside) { out = (inStand(s) ? 75 : 40) + R() * R() * 320; T.frame(s, W, F); }
    else { out = -(46 + R() * 150); T.frame(s, 0, F); if (T.kappaAt(s) > 0.0005 && -out > 230) continue; }
    const x = F.px + F.ox * out, z = F.pz + F.oz * out;
    if (!outside) { const sFront = T.wrap(s); if (sFront < 560 || sFront > L - 560) continue; }
    const sc = 0.8 + R() * 0.9;
    trees[(R() * 3) | 0].push({ x, y: -0.45, z, ry: R() * 3.14, sx: sc, sy: sc * (0.9 + R() * 0.3) });
  }
  const treeG = crossQuad(9, 13.5);
  trees.forEach((l, i) => instanced(A['tree' + (i + 1)], treeG, l));

  // insanlar: iç saha çit kenarı, pit duvarı, set üstü
  const people = [[], [], [], []];
  const nP = q.people;
  for (let i = 0; i < nP; i++) {
    const s = R() * L, r = R();
    let d, out = 0, dy = 0, face;
    const sw = T.wrap(s), front = sw < 500 || sw > L - 500;
    if (r < 0.55) { d = T.innerWall - 1.5 - R() * 5; face = 1; if (front) continue; }
    else if (r < 0.75 && front) { d = -17.5 - R() * 3; face = 1; }
    else if (r < 0.75) continue;
    else { if (inStand(s)) continue; d = W; out = 2.2 + R() * 2.2; dy = -0.2; face = -1; }
    T.frame(s, d, F);
    const x = F.px + F.ox * out, z = F.pz + F.oz * out;
    const y = d < 0 ? (d < -AP ? Math.max(-0.45, -0.45 * (-d - AP) / 61) : 0) : F.py + dy;
    const sc = 0.92 + R() * 0.2;
    people[(R() * 4) | 0].push({ x, y, z, ry: Math.atan2(F.ox * face, F.oz * face), sx: sc, sy: sc });
  }
  const perG = crossQuad(0.9, 1.8, true);
  people.forEach((l, i) => instanced(A['person' + (i + 1)], perG, l));

  // reklam panoları (arka düzlük ve virajlar dışı)
  const bbG = new THREE.PlaneGeometry(22, 9);
  const postG = new THREE.BoxGeometry(0.6, 12, 0.6);
  let bi = 0;
  for (const s of [1150, 1330, 1500, L / 2 - 480, L / 2 + 480, L - 1500, L - 1330, L - 1150]) {
    T.frame(s, W, F);
    const out = 30, x = F.px + F.ox * out, z = F.pz + F.oz * out, y = F.py + 9;
    const m = new THREE.Mesh(bbG, new THREE.MeshStandardMaterial({ map: tex(A['billboard' + (bi++ % 3 + 1)], { aniso }), roughness: 0.6, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = Math.atan2(-F.ox, -F.oz); scene.add(m);
    for (const k of [-8, 8]) { const p = new THREE.Mesh(postG, steelM); p.position.set(x + F.tx * k, y - 9, z + F.tz * k); scene.add(p); }
  }

  // ---------- iç saha: göl, skor kulesi, garajlar ----------
  T.frame(L / 2, 0, F);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x1d4f6e, roughness: 0.06, metalness: 0.85, envMapIntensity: 1.6 }));
  lake.rotation.x = -Math.PI / 2; lake.scale.set(330, 95, 1); lake.position.set(F.px + F.ox * -200, -0.4, F.pz + F.oz * -200);
  lake.rotation.z = Math.atan2(F.tz, F.tx) * -1; scene.add(lake);

  T.frame(0, 0, F);
  const pyl = new THREE.Mesh(new THREE.BoxGeometry(5, 46, 5), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.3, metalness: 0.6, emissive: 0x331100, emissiveIntensity: 0.6 }));
  pyl.position.set(F.px + F.ox * -52, 23, F.pz + F.oz * -52); scene.add(pyl);
  const garM = new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.5, metalness: 0.2 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, metalness: 0.3 });
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    const s = i * 72; T.frame(s, 0, F);
    const g = new THREE.Mesh(new THREE.BoxGeometry(58, 6, 14), garM);
    g.position.set(F.px + F.ox * -48, 2.6, F.pz + F.oz * -48); g.rotation.y = -Math.atan2(F.tz, F.tx); scene.add(g);
    const r = new THREE.Mesh(new THREE.BoxGeometry(60, 0.6, 16), roofM); r.position.copy(g.position); r.position.y = 5.9; r.rotation.y = g.rotation.y; scene.add(r);
  }
  // start köprüsü (bayrak standı)
  T.frame(0, W, F);
  const gantry = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 22), steelM);
  { T.frame(0, W * 0.5, F); gantry.position.set(F.px + F.ox * 6, F.py + 13, F.pz + F.oz * 6); gantry.rotation.y = -Math.atan2(F.tz, F.tx); scene.add(gantry); }

  // ışık direkleri
  const poleG = new THREE.CylinderGeometry(0.35, 0.5, 38, 6), headG = new THREE.BoxGeometry(7, 3, 1.2);
  const poles = [];
  for (let s = 0; s < L; s += 170) { T.frame(s, W, F); const out = inStand(s) ? 62 : 26; poles.push([F.px + F.ox * out, F.pz + F.oz * out, Math.atan2(-F.ox, -F.oz)]); }
  const pim = new THREE.InstancedMesh(poleG, steelM, poles.length), him = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xf5f5f0, emissive: 0xffffff, emissiveIntensity: TM.night ? 9 : 0.25 }), poles.length);
  poles.forEach((p, i) => { dummy.scale.set(1, 1, 1); dummy.position.set(p[0], 18.5, p[1]); dummy.rotation.set(0, p[2], 0); dummy.updateMatrix(); pim.setMatrixAt(i, dummy.matrix); dummy.position.y = 38; dummy.updateMatrix(); him.setMatrixAt(i, dummy.matrix); });
  scene.add(pim, him);

  // ---------- ufuk halkası + bulutlar ----------
  const horT = tex(A.horizon, { repeat: true }); horT.repeat.set(4, 1);
  const hor = new THREE.Mesh(new THREE.CylinderGeometry(3300, 3300, 330, 64, 1, true), new THREE.MeshBasicMaterial({ map: horT, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false, color: TM.tint }));
  hor.position.y = 150; hor.renderOrder = -1; scene.add(hor);
  for (let i = 0; i < 22; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(A['cloud' + (i % 2 + 1)]), transparent: true, opacity: TM.cloud, color: TM.cloudCol || (TM.night ? 0x556080 : 0xffffff), fog: false, depthWrite: false }));
    const a = R() * 6.28, rr = 1500 + R() * 2200;
    sp.position.set(Math.cos(a) * rr, 420 + R() * 500, Math.sin(a) * rr); const sc = 600 + R() * 700; sp.scale.set(sc, sc * 0.45, 1); sp.renderOrder = -1;
    scene.add(sp);
  }

  return { scene, sun, sunDir, sky, TM };
}
