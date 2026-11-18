// SOLMAR BAY — audio.js
// All sound is synthesized with WebAudio: no audio files, no network.
// Engine hum, gunshots, sirens, pickups, mission jingles and a simple
// bass groove. Everything is guarded so the game plays silently until
// the player first interacts (browser autoplay rules).
export class SoundBank {
  constructor() {
    this.ctx = null; this.master = null; this.engineOsc = null;
    this.engineGain = null; this.sirenOn = false; this.sirenNodes = null;
    this.musicTimer = null; this.muted = false;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      this.startEngine();
      this.startMusic();
    } catch (e) { this.ctx = null; }
  }
  startEngine() {
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 50;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 400;
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0.0;
    this.engineOsc.connect(filt); filt.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start();
  }
  setEngine(speed01, inCar) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(45 + speed01 * 130, t, 0.1);
    this.engineGain.gain.setTargetAtTime(inCar ? 0.05 + speed01 * 0.09 : 0.0, t, 0.1);
  }
  blip(freq, dur, type, vol) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur);
  }
  noiseBurst(dur, vol, lowpass) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass || 3000;
    const g = this.ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  gunshot() { this.noiseBurst(0.14, 0.5, 2500); this.blip(120, 0.08, 'square', 0.2); }
  punch() { this.noiseBurst(0.08, 0.25, 900); }
  pickup() { this.blip(660, 0.12, 'sine', 0.2); setTimeout(() => this.blip(990, 0.18, 'sine', 0.2), 90); }
  crash() { this.noiseBurst(0.25, 0.4, 1200); }
  missionComplete() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.22), i * 110));
  }
  missionFail() { [400, 300, 200].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'sawtooth', 0.15), i * 130)); }
  siren(start) {
    if (!this.ctx) return;
    if (start && !this.sirenOn) {
      this.sirenOn = true;
      const o = this.ctx.createOscillator(); o.type = 'sine';
      const g = this.ctx.createGain(); g.gain.value = 0.05;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.7;
      const lg = this.ctx.createGain(); lg.gain.value = 300;
      lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 800;
      o.connect(g); g.connect(this.master); o.start(); lfo.start();
      this.sirenNodes = { o, lfo, g };
    } else if (!start && this.sirenOn) {
      this.sirenOn = false;
      try { this.sirenNodes.o.stop(); this.sirenNodes.lfo.stop(); } catch (e) {}
      this.sirenNodes = null;
    }
  }
  // A lazy bass groove: one bar looped, notes from the Solmar scale.
  startMusic() {
    if (this.musicTimer) return;
    const notes = [55, 0, 65.4, 0, 49, 0, 58.3, 73.4];
    let i = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
      const f = notes[i % notes.length]; i++;
      if (f) this.blip(f, 0.32, 'triangle', 0.07);
    }, 260);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }
}
