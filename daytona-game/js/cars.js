// Araç görselleştirme: tek GLB modelinden 40 araç (InstancedMesh).
// Gövde: clearcoat'lu fiziksel boya + ortam yansıması; camlar doku renginden maskelenip parlak yapılır.
// Rakip renkleri: örnek başına aPaint (rgb + alpha) ve aAccent ile doku üzerinde yeniden boyanır.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR } from './physics.js';
import { tex, blobTexture } from './assets.js';

const SCALE = new THREE.Vector3(1.8, 2.15, 2.3);     // modeli NASCAR ölçülerine getir (~1.97 x 1.22 x 5.18 m)
const WHEEL_SCALE = 2.1;
const ZOFF = 0.16;                                   // ağırlık merkezi kaydırması
const F = {};

export async function loadCarModel() {
  const gltf = await new GLTFLoader().loadAsync('assets/models/car.glb');
  gltf.scene.updateMatrixWorld(true);
  const parts = [], wheels = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    const isWheel = /wheel/i.test(o.name);
    if (isWheel) {
      g.computeBoundingBox();
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      g.translate(-c.x, -c.y, -c.z); g.scale(WHEEL_SCALE, WHEEL_SCALE, WHEEL_SCALE);
      wheels.push({ g, mat: o.material, c });
    } else {
      g.scale(SCALE.x, SCALE.y, SCALE.z); g.translate(0, 0, ZOFF);
      parts.push({ g, mat: o.material, name: o.name });
    }
  });
  return { parts, wheels };
}

function paintMaterial(src, q) {
  const map = src.map; map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.anisotropy = q.aniso; map.needsUpdate = true;
  const m = new THREE.MeshPhysicalMaterial({
    map, metalness: 0.55, roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.5,
    side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,   // model çift taraflı: tek taraflı çizimde yan paneller kayboluyordu
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPaint;\nattribute vec3 aAccent;\nvarying vec4 vPaint;\nvarying vec3 vAccent;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint; vAccent = aAccent;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPaint;\nvarying vec3 vAccent;\nfloat gGlass;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 t = diffuseColor.rgb;
          vec3 sg = pow(t, vec3(1.0 / 2.2));
          float mx = max(sg.r, max(sg.g, sg.b)), mn = min(sg.r, min(sg.g, sg.b));
          // kırmızı gövde boyası maskesi
          float red = smoothstep(0.18, 0.32, sg.r) * (1.0 - smoothstep(0.30, 0.42, sg.g / max(sg.r, 0.001))) * (1.0 - smoothstep(0.38, 0.52, sg.b / max(sg.r, 0.001)));
          // sarı/turuncu şerit maskesi
          float yel = smoothstep(0.6, 0.8, sg.r) * smoothstep(0.42, 0.58, sg.g) * (1.0 - smoothstep(0.3, 0.45, sg.b));
          // koyu lacivert cam maskesi
          gGlass = (1.0 - smoothstep(0.22, 0.3, mx)) * step(sg.r, sg.b);
          float shade = clamp(sg.r / 0.80, 0.3, 1.15);
          vec3 repaint = vPaint.rgb * shade * shade;
          t = mix(t, repaint, red * vPaint.a);
          t = mix(t, vAccent * (0.75 + 0.35 * sg.g), yel * vPaint.a);
          t = mix(t, vec3(0.012, 0.016, 0.022), gGlass);
          diffuseColor.rgb = t;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.04, gGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, gGlass);');
  };
  return m;
}

export function hsl(h, s, l) { return new THREE.Color().setHSL(h, s, l); }

export class CarRenderer {
  constructor(scene, model, cars, T, q) {
    this.T = T; this.cars = cars; this.q = q;
    const n = cars.length; this.n = n;
    this.mat = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    this.mat.setUsage(THREE.DynamicDrawUsage);
    const paint = new Float32Array(n * 4), accent = new Float32Array(n * 3);
    // renk paleti: oyuncu orijinal (alpha 0), rakipler alpha ile yeniden boyanır
    const PAL = [];
    for (let i = 0; i < n; i++) {
      const hue = (0.07 + (i * 0.61803) % 0.86), dark = i % 7 === 3, light = i % 9 === 5;
      PAL.push({ p: dark ? hsl(hue, 0.25, 0.06) : light ? hsl(hue, 0.1, 0.85) : hsl(hue, 0.92, 0.42 + (i % 3) * 0.07), a: hsl((hue + 0.33 + (i % 4) * 0.12) % 1, 0.95, 0.55), alpha: 0.9 + (i % 3) * 0.05 });
    }
    cars.forEach((c, i) => {
      const P = PAL[c.id];
      const al = c.isPlayer ? 0 : P.alpha;
      paint.set([P.p.r, P.p.g, P.p.b, al], i * 4); accent.set([P.a.r, P.a.g, P.a.b], i * 3);
      c.color = c.isPlayer ? '#d0122f' : '#' + P.p.getHexString();
    });
    this.meshes = [];
    const matCache = new Map();
    for (const p of model.parts) {
      let m = matCache.get(p.mat);
      if (!m) {
        if (/Main_body/i.test(p.mat.name)) m = paintMaterial(p.mat, q);
        else {
          m = new THREE.MeshStandardMaterial({ map: p.mat.map, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.9, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
          if (/light/i.test(p.mat.name)) { m.emissive = new THREE.Color(/rear/i.test(p.mat.name) ? 0x660000 : 0x554422); m.emissiveMap = p.mat.map; m.roughness = 0.15; }
          if (/exhaust|Aircooler/i.test(p.mat.name)) { m.metalness = 0.85; m.roughness = 0.3; }
        }
        matCache.set(p.mat, m);
      }
      const g = p.g;
      if (/Main_body/i.test(p.mat.name)) {
        g.setAttribute('aPaint', new THREE.InstancedBufferAttribute(paint, 4));
        g.setAttribute('aAccent', new THREE.InstancedBufferAttribute(accent, 3));
      }
      const im = new THREE.InstancedMesh(g, m, n);
      im.instanceMatrix = this.mat; im.frustumCulled = false;
      im.castShadow = q.shadows && g.attributes.position.count > 100; im.receiveShadow = q.shadows;
      scene.add(im); this.meshes.push(im);
    }
    // tekerlekler: sol (+x) ve sağ (-x) örnek geometri
    const wl = model.wheels.find((w) => w.c.x > 0), wr = model.wheels.find((w) => w.c.x < 0);
    const wm = new THREE.MeshStandardMaterial({ map: wl.mat.map, roughness: 0.6, metalness: 0.25, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
    this.wL = new THREE.InstancedMesh(wl.g, wm, n * 2); this.wR = new THREE.InstancedMesh(wr.g, wm, n * 2);
    for (const w of [this.wL, this.wR]) { w.frustumCulled = false; w.castShadow = q.shadows; w.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(w); }
    // tekerlek konumları (model uzayı, ölçekli)
    const cs = model.wheels.map((w) => w.c);
    const fz = Math.max(...cs.map((c) => c.z)) * SCALE.z + ZOFF, rz = Math.min(...cs.map((c) => c.z)) * SCALE.z + ZOFF;
    this.wx = Math.abs(wl.c.x) * SCALE.x; this.wy = wl.c.y * WHEEL_SCALE; this.fz = fz; this.rz = rz;
    // gölge lekesi (gölge haritası kapalıyken)
    {   // temas gölgesi (her kalitede; gölge haritasını tamamlar)
      const bg = new THREE.PlaneGeometry(2.7, 6.0); bg.rotateX(-Math.PI / 2);
      this.blob = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ map: tex(blobTexture()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: q.shadows ? 0.7 : 0.95 }), n);
      this.blob.frustumCulled = false; scene.add(this.blob);
    }
    this.m4 = new THREE.Matrix4(); this.w4 = new THREE.Matrix4(); this.t4 = new THREE.Matrix4();
    this.pos = cars.map(() => new THREE.Vector3()); this.fwd = cars.map(() => new THREE.Vector3()); this.up = cars.map(() => new THREE.Vector3());
    this.eul = new THREE.Euler();
  }

  update() {
    const T = this.T, e = this.m4.elements, arr = this.mat.array;
    for (let i = 0; i < this.n; i++) {
      const c = this.cars[i];
      T.frame(c.s, c.d, F);
      const bank = T.bankLocal(c.s, c.d), cb = Math.cos(bank), sb = Math.sin(bank);
      // yüzey ekseni: Ls = O cosb + Y sinb ; N = Y cosb - O sinb
      const lx = F.ox * cb, ly = sb, lz = F.oz * cb;
      const nx = -F.ox * sb, ny = cb, nz = -F.oz * sb;
      const cp = Math.cos(c.psi), sp = Math.sin(c.psi);
      // ileri = T cos - Ls sin ; sol = -(Ls cos + T sin)
      const fx = F.tx * cp - lx * sp, fy = -ly * sp, fz = F.tz * cp - lz * sp;
      const sx = -(lx * cp + F.tx * sp), sy = -(ly * cp), sz = -(lz * cp + F.tz * sp);
      // gövde yatış/yunuslama (yük transferi)
      const roll = Math.max(-0.05, Math.min(0.05, c.ayF * 0.0022)), pitch = Math.max(-0.03, Math.min(0.03, -c.axF * 0.002));
      const h = 0.02;
      let ux = nx + sx * roll + fx * pitch, uy = ny + sy * roll + fy * pitch, uz = nz + sz * roll + fz * pitch;
      const px = F.px + nx * h, py = F.py + ny * h, pz = F.pz + nz * h;
      e[0] = sx; e[1] = sy; e[2] = sz; e[3] = 0;
      e[4] = ux; e[5] = uy; e[6] = uz; e[7] = 0;
      e[8] = fx; e[9] = fy; e[10] = fz; e[11] = 0;
      e[12] = px; e[13] = py; e[14] = pz; e[15] = 1;
      arr.set(e, i * 16);
      this.pos[i].set(px, py, pz); this.fwd[i].set(fx, fy, fz); this.up[i].set(nx, ny, nz);
      // tekerlekler (yatış uygulanmadan)
      e[4] = nx; e[5] = ny; e[6] = nz;
      for (let w = 0; w < 4; w++) {
        const front = w < 2, left = (w & 1) === 0;
        this.eul.set(c.spin, front ? c.steer * 1.0 : 0, 0, 'YXZ');
        this.w4.makeRotationFromEuler(this.eul);
        this.w4.setPosition(left ? this.wx : -this.wx, this.wy, front ? this.fz : this.rz);
        this.t4.multiplyMatrices(this.m4, this.w4);
        (left ? this.wL : this.wR).setMatrixAt(i * 2 + (front ? 0 : 1), this.t4);
      }
      if (this.blob) {
        e[12] = F.px + nx * 0.04; e[13] = F.py + ny * 0.04; e[14] = F.pz + nz * 0.04;
        this.blob.setMatrixAt(i, this.m4);
      }
    }
    this.mat.needsUpdate = true;
    this.wL.instanceMatrix.needsUpdate = true; this.wR.instanceMatrix.needsUpdate = true;
    if (this.blob) this.blob.instanceMatrix.needsUpdate = true;
  }
}

// ---------- parçacıklar: lastik dumanı + kıvılcım ----------
export class Particles {
  constructor(scene, max = 500) {
    this.max = max; this.i = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.kind = new Float32Array(max);
    this.a = new Float32Array(max * 2);   // alpha, size
    this.col = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.a, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec2 aA; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA=aA.x; vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=aA.y*uScale/max(1.0,-mv.z); }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard; gl_FragColor=vec4(vC, vA*(1.0-r)); }`,
    });
    this.pts = new THREE.Points(g, m); this.pts.frustumCulled = false; this.pts.renderOrder = 3; scene.add(this.pts);
    this.g = g;
  }
  emit(x, y, z, vx, vy, vz, kind) {
    const i = this.i; this.i = (i + 1) % this.max;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.life[i] = kind ? 0.5 : 1.6; this.kind[i] = kind;
    if (kind) this.col.set([1, 0.75, 0.3], i * 3); else this.col.set([0.86, 0.86, 0.86], i * 3);
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.a[i * 2] = 0; continue; }
      this.life[i] -= dt;
      const k = this.kind[i];
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (k) { this.v[i * 3 + 1] -= 9.8 * dt; this.a[i * 2] = Math.min(1, this.life[i] * 4); this.a[i * 2 + 1] = 0.14; }
      else { const f = Math.exp(-dt * 1.5); this.v[i * 3] *= f; this.v[i * 3 + 2] *= f; const t = 1.6 - this.life[i]; this.a[i * 2] = 0.3 * Math.min(1, this.life[i]); this.a[i * 2 + 1] = 1.2 + t * 3.5; }
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.aA.needsUpdate = true; this.g.attributes.color.needsUpdate = true;
  }
}
