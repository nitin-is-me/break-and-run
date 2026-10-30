/* Tiny procedural sound effects — no audio files needed. */

class SoundBoard {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('pool.sound') !== 'off';
    this.noise = null;
    this.lastPlay = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.noise = buf;
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('pool.sound', on ? 'on' : 'off');
  }

  burst(gain, freq, q, duration) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  tone(freq, gain, duration, type = 'sine', slideTo = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  play(ev) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') return;

    const now = performance.now();
    if (now - this.lastPlay < 12 && ev.type !== 'pocket') return;
    this.lastPlay = now;

    const s = Math.min(1, (ev.s || 200) / 1900);
    if (ev.type === 'ball') {
      const gain = 0.03 + s * 0.22;
      this.tone(760 + s * 1250, gain, 0.055, 'triangle');
      this.burst(gain * 0.55, 2400 + s * 1800, 1.4, 0.035);
    } else if (ev.type === 'rail') {
      const gain = 0.02 + s * 0.13;
      this.tone(150 + s * 90, gain, 0.09, 'sine', 90);
      this.burst(gain * 0.7, 900, 0.8, 0.05);
    } else if (ev.type === 'pocket') {
      this.tone(420, 0.16, 0.22, 'sine', 90);
      this.burst(0.14, 700, 0.7, 0.18);
      this.tone(120, 0.1, 0.3, 'sine', 55);
    }
  }

  cue(power) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = Math.max(0.1, Math.min(1, power));
    this.burst(0.09 + p * 0.12, 1600 + p * 900, 1.1, 0.05);
    this.tone(320 + p * 180, 0.05 + p * 0.07, 0.06, 'triangle');
  }
}

export const sound = new SoundBoard();
