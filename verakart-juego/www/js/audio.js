// =========================================================
// VERA KART — audio.js
// Sonido 100% sintetizado con Web Audio API (sin archivos de audio).
// Se inicia al pulsar "¡A CORRER!" (los navegadores exigen un gesto del usuario).
// =========================================================

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  init() {
    if (this.ready) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.35;
      this.master.connect(this.ctx.destination);

      // Motor: dos osciladores + filtro
      this.engFilter = this.ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass';
      this.engFilter.frequency.value = 500;
      this.engGain = this.ctx.createGain();
      this.engGain.gain.value = 0.0;
      this.osc1 = this.ctx.createOscillator(); this.osc1.type = 'sawtooth';
      this.osc2 = this.ctx.createOscillator(); this.osc2.type = 'square';
      this.osc1.connect(this.engFilter); this.osc2.connect(this.engFilter);
      this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
      this.osc1.start(); this.osc2.start();

      // Buffer de ruido para derrape / choques / viento
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // Ruido continuo para derrape/viento
      this.windSrc = this.ctx.createBufferSource();
      this.windSrc.buffer = this.noiseBuf; this.windSrc.loop = true;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 900; this.windFilter.Q.value = 0.8;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
      this.windSrc.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
      this.windSrc.start();

      this.ready = true;
    } catch (e) {
      console.warn('Audio no disponible:', e);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 0.35, this.ctx.currentTime, 0.05);
  }

  suspend() { if (this.ready) this.ctx.suspend(); }
  resume() { if (this.ready) this.ctx.resume(); }

  /** speedNorm 0..1.3, throttle 0..1 */
  setEngine(speedNorm, throttle, boosting, drifting, sliding) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = 55 + speedNorm * 150 + (boosting ? 25 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(350 + speedNorm * 1400 + throttle * 300, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.10 + throttle * 0.07 + speedNorm * 0.05, t, 0.08);
    this.windGain.gain.setTargetAtTime(Math.min(0.14, speedNorm * 0.06 + (drifting ? 0.07 : 0) + (sliding ? 0.05 : 0)), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(drifting ? 2200 : 500 + speedNorm * 900, t, 0.1);
  }

  silenceEngine() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0, t, 0.1);
    this.windGain.gain.setTargetAtTime(0, t, 0.1);
  }

  beep(freq = 440, dur = 0.25, type = 'square', vol = 0.35) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  hit(strength = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, 0.25 + strength * 0.08), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.3);
    this.beep(90, 0.18, 'sine', 0.5);
  }

  boost() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.55);
  }

  driftLevel(level) {
    this.beep(level >= 2 ? 1320 : 880, 0.12, 'triangle', 0.3);
  }

  lap() {
    this.beep(660, 0.12, 'triangle', 0.35);
    setTimeout(() => this.beep(990, 0.25, 'triangle', 0.35), 130);
  }
}
