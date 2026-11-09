// Post-processing: HDR bloom → sinematik geçiş (hıza bağlı radyal hareket bulanıklığı, kromatik sapma,
// güneş parlaması/ışık sızması, renk derecelendirme, vinyet, film greni) → ACES ton eşleme + sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uSun: { value: new THREE.Vector3(0.5, 0.5, 0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed, uHit, uTime; uniform vec2 uRes; uniform vec3 uSun; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      // hıza bağlı radyal bulanıklık (merkez net, kenarlar akar)
      float amt = uSpeed * 0.085 * smoothstep(0.03, 0.42, r2);
      float j = hash(vUv * uRes + uTime) - 0.5;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 8; i++) { float t = (float(i) + j) / 8.0; col += texture2D(tDiffuse, vUv - c * amt * t).rgb; }
      col /= 8.0;
      // kromatik sapma (kenarlarda, çarpışmada artar)
      float ca = (0.0012 + 0.008 * uHit + 0.0012 * uSpeed) * (0.3 + r2 * 4.0);
      col.r = mix(col.r, texture2D(tDiffuse, vUv + c * ca).r, 0.75);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - c * ca).b, 0.75);
      // güneş ışığı sızması: güneş kadrajdayken sıcak hale + anamorfik çizgi
      if (uSun.z > 0.0) {
        vec2 d = (vUv - uSun.xy) * vec2(uRes.x / uRes.y, 1.0);
        float halo = exp(-dot(d, d) * 5.0) * 0.16 + exp(-abs(d.y) * 55.0) * exp(-abs(d.x) * 1.8) * 0.10;
        col += vec3(1.0, 0.78, 0.5) * halo * uSun.z;
      }
      // renk derecelendirme: hafif kontrast + doygunluk, sıcak parlaklar / soğuk gölgeler
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.14);
      col *= mix(vec3(0.93, 0.98, 1.07), vec3(1.06, 1.0, 0.93), smoothstep(0.0, 0.9, l));
      col = max(vec3(0.0), (col - 0.18) * 1.07 + 0.18);
      // vinyet + gren
      col *= 1.0 - smoothstep(0.12, 0.62, r2) * 0.42;
      col += (hash(vUv * uRes * 0.7 + uTime * 3.1) - 0.5) * 0.02 * (0.4 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function buildPost(renderer, scene, camera, q, pr, hf) {
  const w = innerWidth * pr, h = innerHeight * pr;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: q.msaa ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.24, 0.6, 0.95); composer.addPass(bloom); }
  const grade = new ShaderPass(GradeShader); grade.uniforms.uRes.value.set(w, h); composer.addPass(grade);
  composer.addPass(new OutputPass());
  const sv = new THREE.Vector3();
  return {
    composer, grade,
    resize() { composer.setSize(innerWidth, innerHeight); grade.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr); },
    update(dt, speed, hit, sunDir, flare = true) {
      const u = grade.uniforms;
      u.uTime.value = (u.uTime.value + dt) % 100; u.uSpeed.value = Math.max(0, Math.min(1, (speed - 35) / 60)); u.uHit.value = hit;
      // güneşin ekran konumu
      sv.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      const vis = sv.z < 1 && Math.abs(sv.x) < 1.3 && Math.abs(sv.y) < 1.3 ? Math.max(0, 1 - Math.max(Math.abs(sv.x), Math.abs(sv.y)) / 1.3) : 0;
      u.uSun.value.set(sv.x * 0.5 + 0.5, sv.y * 0.5 + 0.5, flare ? vis : 0);
    },
  };
}
