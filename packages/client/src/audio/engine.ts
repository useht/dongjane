export interface BellPartial {
  ratio: number;
  gain: number;
  decay: number;
}

export const BELL_FUNDAMENTAL_HZ = 146.8;

export const BELL_PARTIALS: readonly BellPartial[] = [
  { ratio: 1, gain: 1, decay: 7 },
  { ratio: 2.01, gain: 0.55, decay: 5.2 },
  { ratio: 2.76, gain: 0.34, decay: 3.8 },
  { ratio: 5.43, gain: 0.16, decay: 2.2 },
  { ratio: 8.93, gain: 0.07, decay: 1.2 },
];

export const BELL_STRIKES = 3;
export const BELL_GAP_SECONDS = 5.5;

type AudioContextCtor = typeof AudioContext;

function contextClass(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

// All sound is synthesized: sine partials with exponential decay for the bell, filtered noise for wind.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private volume = 0.7;
  private sound = true;
  private wind = true;
  bellCount = 0;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  configure(volume: number, sound: boolean, wind: boolean): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.sound = sound;
    this.wind = wind;
    this.applyLevels();
  }

  unlock(): void {
    const Ctor = contextClass();
    if (!Ctor) return;
    if (!this.ctx) {
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.startWind();
      this.applyLevels();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  bell(strikes: number = BELL_STRIKES): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sound) return;
    this.bellCount += 1;
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < strikes; i += 1) this.strike(start + i * BELL_GAP_SECONDS, 1 - i * 0.12);
  }

  knock(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sound) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private strike(at: number, strength: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    for (const partial of BELL_PARTIALS) {
      const freq = BELL_FUNDAMENTAL_HZ * partial.ratio;
      if (freq > ctx.sampleRate / 2.2) continue;
      for (const detune of partial.ratio === 1 ? [0, 0.7] : [0]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq + detune;
        const peak = 0.22 * partial.gain * strength * (detune === 0 ? 1 : 0.6);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + partial.decay);
        osc.connect(gain).connect(master);
        osc.start(at);
        osc.stop(at + partial.decay + 0.1);
      }
    }
    const burst = ctx.createBufferSource();
    burst.buffer = this.noise(0.05);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1400;
    band.Q.value = 0.8;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.18 * strength, at);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    burst.connect(band).connect(burstGain).connect(master);
    burst.start(at);
  }

  private startWind(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise(4);
    source.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 520;
    low.Q.value = 0.4;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 380;
    band.Q.value = 0.6;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.35;
    lfo.connect(lfoDepth).connect(swell.gain);
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.043;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 140;
    sweep.connect(sweepDepth).connect(band.frequency);

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    source.connect(low).connect(band).connect(swell).connect(this.windGain).connect(master);
    source.start();
    lfo.start();
    sweep.start();
  }

  private noise(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = (white * 0.35 + last * 6) * 0.5;
    }
    return buffer;
  }

  private applyLevels(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.sound ? this.volume : 0, now, 0.05);
    if (this.windGain) {
      this.windGain.gain.cancelScheduledValues(now);
      this.windGain.gain.setTargetAtTime(this.wind ? 0.55 : 0, now, 0.4);
    }
  }
}
