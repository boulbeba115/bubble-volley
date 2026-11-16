// Fully synthesised audio (WebAudio): sound effects, ocean ambience and a
// small generative tropical music loop. No audio files required.
export class AudioSys {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.musicOn = false;
    this.step = 0;
    this.nextTime = 0;
  }

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      const c = this.ctx;
      this.master = c.createDynamicsCompressor();
      this.master.threshold.value = -14; this.master.ratio.value = 5;
      this.master.connect(c.destination);
      this.sfxGain = c.createGain(); this.sfxGain.connect(this.master);
      this.musicGain = c.createGain(); this.musicGain.connect(this.master);
      this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.startOcean();
      this.timer = setInterval(() => this.schedule(), 60);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.sfxGain.gain.value = this.settings.sfx * 0.9;
    this.musicGain.gain.value = this.settings.music * 0.5;
  }

  // ---------------------------------------------------------------- helpers
  tone(freq, dur, { type = 'sine', vol = 0.2, to = null, at = 0, dest = null, attack = 0.004 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.2, freq = 1200, q = 0.8, type = 'bandpass', to = null, at = 0, dest = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfxGain);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- effects
  bounce(power = 0.5) {
    const f = 300 + power * 260 + Math.random() * 40;
    this.tone(f, 0.16, { type: 'sine', vol: 0.28, to: f * 0.55 });
    this.tone(f * 2.02, 0.07, { type: 'triangle', vol: 0.1 });
    this.noise(0.05, { vol: 0.12 + power * 0.1, freq: 2400 });
  }
  smash() {
    this.tone(180, 0.2, { type: 'sine', vol: 0.4, to: 60 });
    this.noise(0.14, { vol: 0.32, freq: 1800, to: 400 });
    this.tone(720, 0.1, { type: 'square', vol: 0.07, to: 300 });
  }
  wall() { this.tone(220, 0.09, { type: 'sine', vol: 0.16, to: 150 }); }
  net() { this.noise(0.12, { vol: 0.18, freq: 500, q: 2 }); this.tone(140, 0.12, { type: 'triangle', vol: 0.12, to: 90 }); }
  jump() { this.tone(260, 0.14, { type: 'sine', vol: 0.1, to: 520 }); }
  land(power = 0.5) { this.noise(0.12, { vol: 0.06 + power * 0.1, freq: 700, type: 'lowpass', to: 200 }); }
  sandHit() { this.noise(0.3, { vol: 0.3, freq: 900, type: 'lowpass', to: 150 }); this.tone(110, 0.2, { vol: 0.3, to: 50 }); }
  whistle() {
    for (const at of [0, 0.02]) {
      this.tone(2350, 0.42, { type: 'sine', vol: 0.09, at });
      this.tone(2480, 0.42, { type: 'sine', vol: 0.07, at });
    }
    this.noise(0.4, { vol: 0.04, freq: 2400, q: 6 });
  }
  point(won) {
    const n = won ? [660, 880, 1320] : [440, 370, 294];
    n.forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.16, at: 0.28 + i * 0.1 }));
  }
  dash() { this.noise(0.18, { vol: 0.16, freq: 900, q: 1.2, to: 3200 }); }
  superSpike() {
    this.tone(90, 0.5, { type: 'sawtooth', vol: 0.3, to: 40 });
    this.noise(0.5, { vol: 0.4, freq: 300, type: 'lowpass', to: 4000 });
    this.tone(440, 0.35, { type: 'square', vol: 0.1, to: 1760 });
    this.noise(0.25, { vol: 0.3, freq: 2500, to: 500, at: 0.05 });
  }
  boom() { this.tone(70, 0.6, { vol: 0.5, to: 30 }); this.noise(0.5, { vol: 0.4, freq: 600, type: 'lowpass', to: 80 }); }
  charged() { [784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.13, at: i * 0.055 })); }
  spawn() { this.tone(520, 0.2, { vol: 0.1, to: 1040 }); this.tone(1560, 0.12, { vol: 0.05, at: 0.1 }); }
  pickup() {
    this.noise(0.08, { vol: 0.2, freq: 3000 });
    [660, 990, 1320].forEach((f, i) => this.tone(f, 0.14, { type: 'square', vol: 0.08, at: i * 0.06 }));
  }
  block() { this.tone(300, 0.25, { type: 'square', vol: 0.14, to: 900 }); this.noise(0.15, { vol: 0.25, freq: 1500 }); }
  click() { this.tone(880, 0.06, { type: 'triangle', vol: 0.12, to: 1320 }); }
  hover() { this.tone(660, 0.03, { type: 'sine', vol: 0.04 }); }
  count(final) { this.tone(final ? 1047 : 523, final ? 0.35 : 0.14, { type: 'square', vol: 0.09 }); }
  win() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => {
      this.tone(f, 0.3, { type: 'triangle', vol: 0.2, at: i * 0.13 });
      this.tone(f / 2, 0.3, { type: 'sine', vol: 0.12, at: i * 0.13 });
    });
  }
  lose() {
    [392, 370, 330, 262].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.18, at: i * 0.22 }));
  }
  cheer() {
    this.noise(1.6, { vol: 0.1, freq: 1500, q: 0.4, to: 900 });
    this.noise(1.2, { vol: 0.06, freq: 3200, q: 0.6, at: 0.1 });
  }

  // ---------------------------------------------------------------- ambience
  startOcean() {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
    const lg = c.createGain(); lg.gain.value = 0.035;
    lfo.connect(lg).connect(g.gain);
    const lf = c.createGain(); lf.gain.value = 250; lfo.connect(lf).connect(f.frequency);
    s.connect(f).connect(g).connect(this.musicGain);
    s.start(); lfo.start();
  }

  // ---------------------------------------------------------------- music
  setMusic(on) { this.musicOn = on; if (this.ctx) this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.1); }

  schedule() {
    if (!this.ctx || !this.musicOn || this.settings.music <= 0) return;
    const c = this.ctx;
    const spb = 60 / 108 / 2;                       // eighth notes
    if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.05;
    while (this.nextTime < c.currentTime + 0.25) {
      this.playStep(this.step, this.nextTime - c.currentTime, spb);
      this.step = (this.step + 1) % 64;
      this.nextTime += spb * (this.step % 2 ? 1.14 : 0.86);  // light swing
    }
  }

  playStep(i, at, spb) {
    const chords = [[60, 64, 67, 71], [57, 60, 64, 67], [65, 69, 72, 76], [67, 71, 74, 77]];   // Cmaj7 Am7 Fmaj7 G7
    const bar = Math.floor(i / 16) % 4, s = i % 16;
    const ch = chords[bar];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const d = this.musicGain;
    // marimba arpeggio
    const pat = [0, -1, 2, 1, -1, 3, 2, -1, 1, 2, -1, 3, 2, 1, -1, 2];
    const n = pat[s];
    if (n >= 0) {
      const f = hz(ch[n] + 12);
      this.tone(f, 0.32, { type: 'sine', vol: 0.16, at, dest: d, attack: 0.003 });
      this.tone(f * 4, 0.06, { type: 'sine', vol: 0.05, at, dest: d, attack: 0.002 });
    }
    // bass
    if (s === 0 || s === 6 || s === 10) this.tone(hz(ch[0] - 24), spb * 2.4, { type: 'triangle', vol: 0.2, at, dest: d, attack: 0.01 });
    // soft pad on bar start
    if (s === 0) for (const m of ch) this.tone(hz(m), spb * 15, { type: 'sine', vol: 0.03, at, dest: d, attack: 0.4 });
    // shaker + kick-ish thump
    if (s % 2 === 1) this.noise(0.05, { vol: s % 4 === 3 ? 0.05 : 0.025, freq: 6500, q: 1, at, dest: d });
    if (s === 0 || s === 8) this.tone(95, 0.16, { type: 'sine', vol: 0.22, to: 45, at, dest: d });
    if (s === 4 || s === 12) this.noise(0.09, { vol: 0.05, freq: 1800, q: 0.7, at, dest: d });
  }
}
