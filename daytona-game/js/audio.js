// Ses motoru (WebAudio, tamamı sentez — dosya gerekmez):
//  • V8 motor (devire bağlı 3 osilatör + doyum + alçak geçiren), rakip paket uğultusu
//  • Stadyum yankısı: üretilmiş dürtü yanıtlı konvolüsyon reverb + tribünden dönen slapback ekolar
//  • Kalabalık: formant filtreli gürültü katmanları + yavaş dalgalanma + tezahürat patlamaları
//  • Rüzgâr, lastik çığlığı, çarpma
// assets/audio/crowd_loop.mp3 ve cheer.mp3 varsa sentez yerine onlar kullanılır (bkz. prompts/ASSET_PROMPTS.md).
export class GameAudio {
  constructor() { this.ok = false; this.cheerT = 0; }
  start() {
    if (this.ok) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(), sr = ctx.sampleRate;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(ctx.destination);
    const master = this.master = ctx.createGain(); master.gain.value = 0.6; master.connect(comp);

    // --- stadyum reverb + eko ---
    const len = Math.floor(sr * 2.8), ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.55) * 0.5 * (t < 0.02 ? t / 0.02 : 1); }
      // tribün/duvar yansımaları (slapback)
      for (const [t0, a] of [[0.11 + ch * 0.013, 0.7], [0.23 - ch * 0.011, 0.45], [0.37 + ch * 0.017, 0.3], [0.58, 0.18]]) {
        const i0 = Math.floor(t0 * sr); for (let k = 0; k < 400; k++) d[i0 + k] += (Math.random() * 2 - 1) * a * Math.exp(-k / 90);
      }
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const wet = this.wet = ctx.createGain(); wet.gain.value = 0.25; conv.connect(wet); wet.connect(master);
    const send = this.send = ctx.createGain(); send.gain.value = 0.3; send.connect(conv);

    const nb = ctx.createBuffer(1, sr * 3, sr), nd = nb.getChannelData(0);
    let b0 = 0; for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.985 * b0 + 0.15 * w; nd[i] = w * 0.5 + b0 * 2.2; }   // beyaz + kahverengi karışım
    this.noiseBuf = nb;
    const noise = (type, freq, q, dest) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(dest || master); s.start(0, Math.random() * 2); return { f, g }; };

    // --- motor ---
    const lp = this.lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1.4;
    const eg = this.eg = ctx.createGain(); eg.gain.value = 0; lp.connect(eg); eg.connect(master); eg.connect(send);
    const ws = ctx.createWaveShaper(); const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 2.8); } ws.curve = cv; ws.connect(lp);
    this.osc = [['sawtooth', 1, 0.5], ['square', 0.5, 0.38], ['sawtooth', 2.01, 0.16], ['sawtooth', 1.503, 0.1]].map(([t, m, g]) => { const o = ctx.createOscillator(); o.type = t; const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg); gg.connect(ws); o.start(); return { o, m }; });
    // motor hırıltısı (gürültü, devirle açılan bant)
    this.rasp = noise('bandpass', 300, 1.2, ws);

    // --- rakip paketi (ağırlıklı olarak yankıya gider) ---
    const pg = this.pg = ctx.createGain(); pg.gain.value = 0; const plp = ctx.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 800; plp.connect(pg); pg.connect(master); pg.connect(send);
    this.pack = [1, 1.07, 0.93, 1.21, 0.86].map((m) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(plp); o.start(); return { o, m }; });

    // --- kalabalık ---
    const cg = this.cg = ctx.createGain(); cg.gain.value = 0; cg.connect(master); cg.connect(send);
    this.crowd = [[420, 0.9, 0.9], [780, 1.1, 1.0], [1250, 1.3, 0.7], [2300, 1.6, 0.35], [3400, 2.0, 0.16]].map(([f, q, a], i) => {
      const n = noise('bandpass', f, q, cg); n.g.gain.value = a; n.base = a;
      // yavaş dalgalanma (insan kalabalığının nefes alan uğultusu)
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + i * 0.053; const lg = ctx.createGain(); lg.gain.value = a * 0.35; lfo.connect(lg); lg.connect(n.g.gain); lfo.start();
      return n;
    });
    this.loadLoop('assets/audio/crowd_loop.mp3', (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const g = ctx.createGain(); g.gain.value = 2.2; s.connect(g); g.connect(cg); s.start(); for (const n of this.crowd) { n.base = 0; n.g.gain.value = 0; } });
    this.loadLoop('assets/audio/cheer.mp3', (buf) => { this.cheerBuf = buf; });

    this.wind = noise('bandpass', 700, 0.5); this.tire = noise('bandpass', 1500, 3); this.crash = noise('lowpass', 520, 0.7);
    this.tire.g.connect(send); this.crash.g.connect(send);
    this.ok = true;
  }
  loadLoop(url, cb) { fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => this.ctx.decodeAudioData(b)).then(cb).catch(() => { /* dosya yok: sentez */ }); }

  // stand: 0..1 tribüne yakınlık (yankı + kalabalık şiddeti)
  update(dt, rpm, thr, speed, slip, packLevel, packRpm, stand) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, f = rpm / 60 * 4;      // V8 ateşleme frekansı
    for (const { o, m } of this.osc) o.frequency.setTargetAtTime(f * m * 0.5, t, 0.03);
    this.lp.frequency.setTargetAtTime(450 + rpm * 0.15 + thr * 1500, t, 0.05);
    this.eg.gain.setTargetAtTime(0.15 + thr * 0.17, t, 0.05);
    this.rasp.f.frequency.setTargetAtTime(200 + rpm * 0.09, t, 0.05); this.rasp.g.gain.setTargetAtTime(0.1 + thr * 0.25, t, 0.05);
    for (const { o, m } of this.pack) o.frequency.setTargetAtTime(packRpm / 60 * 2 * m, t, 0.1);
    this.pg.gain.setTargetAtTime(Math.min(0.12, packLevel * 0.03), t, 0.15);
    this.wind.g.gain.setTargetAtTime(Math.min(0.32, (speed / 90) ** 2 * 0.28), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(400 + speed * 9, t, 0.1);
    this.tire.g.gain.setTargetAtTime(Math.min(0.3, Math.max(0, slip - 0.7) * 0.25), t, 0.05);
    // yankı: tribün/duvar önünde artar
    this.send.gain.setTargetAtTime(0.22 + stand * 0.5, t, 0.3);
    this.wet.gain.setTargetAtTime(0.2 + stand * 0.22, t, 0.3);
    // kalabalık: tribün önünde yüksek, tezahüratla kabarır
    this.cheerT = Math.max(0, this.cheerT - dt * 0.35);
    this.cg.gain.setTargetAtTime(0.012 + stand * 0.05 + this.cheerT * 0.12, t, 0.25);
    for (const n of this.crowd) n.f.frequency.setTargetAtTime(n.f.frequency.value * 0 + (n.f0 || (n.f0 = n.f.frequency.value)) * (1 + this.cheerT * 0.25), t, 0.3);
  }
  cheer(a = 1) {
    if (!this.ok) return;
    this.cheerT = Math.min(1.5, this.cheerT + a);
    if (this.cheerBuf) { const s = this.ctx.createBufferSource(); s.buffer = this.cheerBuf; const g = this.ctx.createGain(); g.gain.value = 0.5 * a; s.connect(g); g.connect(this.master); g.connect(this.send); s.start(); }
  }
  hit(v) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, g = this.crash.g.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.min(0.9, 0.15 + v * 0.06), t); g.exponentialRampToValueAtTime(0.001, t + 0.4);
  }
  beep(freq, dur) {
    if (!this.ok) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.frequency.value = freq; g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); g.connect(this.send); o.start(); o.stop(t + dur);
  }
  mute(m) { if (this.ok) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05); }
}
