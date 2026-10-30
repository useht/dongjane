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

// A recorded wooden-fish strike; the synthesized knock below stands in until it has loaded or if it cannot.
export const MOKT_SAMPLE_URL = "/audio/mokt.mp3";
// The recording peaks near full scale, far above the synthesized knock, so it is trimmed to sit beside the bell.
export const MOKT_SAMPLE_GAIN = 0.5;

type AudioContextCtor = typeof AudioContext;

function contextClass(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

// The bell and the wind are synthesized (sine partials with exponential decay, filtered noise); only the knock uses a
// recording. Other recordings, the 법당 sutra, are played by other modules into `output`, so the ambient volume covers them.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private effects: GainNode | null = null;
  private ambience: GainNode | null = null;
  private ambientVolume = 0.7;
  private effectVolume = 0.7;
  private windGain: GainNode | null = null;
  private windAllowed = true;
  private readonly unlockListeners = new Set<() => void>();
  private moktSample: AudioBuffer | null = null;
  private moktLoad: Promise<void> | null = null;
  bellCount = 0;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  // Recordings (the sutra) join the ambience bus, so the ambient volume covers them.
  get output(): AudioNode | null {
    return this.ambience;
  }

  // Called each time the context starts running, which is when a browser first lets sound out after a gesture.
  onUnlock(listener: () => void): void {
    this.unlockListeners.add(listener);
  }

  // The wind belongs to the open air: it is off indoors and while a recording is playing out there.
  setWindAllowed(allowed: boolean): void {
    this.windAllowed = allowed;
    this.applyLevels();
  }

  configure(ambientVolume: number, effectVolume: number): void {
    this.ambientVolume = Math.min(1, Math.max(0, ambientVolume));
    this.effectVolume = Math.min(1, Math.max(0, effectVolume));
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
      this.effects = this.ctx.createGain();
      this.effects.connect(this.ctx.destination);
      this.ambience = this.ctx.createGain();
      this.ambience.connect(this.ctx.destination);
      this.startWind();
      this.applyLevels();
      this.ctx.addEventListener("statechange", () => this.announce());
    }
    this.loadMoktSample();
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    this.announce();
  }

  bell(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.effects) return;
    this.bellCount += 1;
    const level = Math.min(1, Math.max(0, volume));
    if (level <= 0) return;
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < BELL_STRIKES; i += 1) this.strike(start + i * BELL_GAP_SECONDS, (1 - i * 0.12) * level);
  }

  knock(volume = 1): void {
    const ctx = this.ctx;
    const level = Math.min(1, Math.max(0, volume));
    if (!ctx || !this.effects || level <= 0) return;
    this.loadMoktSample();
    if (this.moktSample) this.playMoktSample(ctx, this.moktSample, level);
    else this.synthesizeKnock(ctx, level);
  }

  private playMoktSample(ctx: AudioContext, buffer: AudioBuffer, level: number): void {
    const effects = this.effects;
    if (!effects) return;
    const source = ctx.createBufferSource();
    const envelope = ctx.createGain();
    source.buffer = buffer;
    envelope.gain.value = MOKT_SAMPLE_GAIN * level;
    source.connect(envelope).connect(effects);
    source.start();
  }

  private synthesizeKnock(ctx: AudioContext, level: number): void {
    const effects = this.effects;
    if (!effects) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.09);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.22 * level, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(envelope).connect(effects);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.effects = null;
    this.ambience = null;
    this.windGain = null;
    this.unlockListeners.clear();
    this.moktSample = null;
    this.moktLoad = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private announce(): void {
    if (!this.unlocked) return;
    for (const listener of [...this.unlockListeners]) listener();
  }

  // Fetched and decoded at most once per context; a missing or undecodable file leaves the synthesized knock in place.
  private loadMoktSample(): void {
    const ctx = this.ctx;
    if (!ctx || this.moktLoad) return;
    this.moktLoad = this.fetchMoktSample(ctx).catch(() => undefined);
  }

  private async fetchMoktSample(ctx: AudioContext): Promise<void> {
    const response = await fetch(MOKT_SAMPLE_URL);
    if (!response.ok) return;
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    if (this.ctx === ctx) this.moktSample = buffer;
  }

  private strike(at: number, strength: number): void {
    const ctx = this.ctx;
    const effects = this.effects;
    if (!ctx || !effects) return;
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
        osc.connect(gain).connect(effects);
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
    burst.connect(band).connect(burstGain).connect(effects);
    burst.start(at);
  }

  private startWind(): void {
    const ctx = this.ctx;
    const ambience = this.ambience;
    if (!ctx || !ambience) return;
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
    source.connect(low).connect(band).connect(swell).connect(this.windGain).connect(ambience);
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
    if (!ctx || !this.effects || !this.ambience) return;
    const now = ctx.currentTime;
    this.effects.gain.cancelScheduledValues(now);
    this.effects.gain.setTargetAtTime(this.effectVolume, now, 0.05);
    this.ambience.gain.cancelScheduledValues(now);
    this.ambience.gain.setTargetAtTime(this.ambientVolume, now, 0.05);
    if (this.windGain) {
      this.windGain.gain.cancelScheduledValues(now);
      this.windGain.gain.setTargetAtTime(this.windAllowed ? 0.55 : 0, now, 0.4);
    }
  }
}
