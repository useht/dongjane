import { AmbientBed, BED_SPECS, noiseBuffer } from "./beds.ts";
import { type Ambience, BEDS } from "./soundscape.ts";

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

// The bell and the beds are synthesized; only the knock is a recording. The sutra plays into `output`, under the ambient volume.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private effects: GainNode | null = null;
  private ambience: GainNode | null = null;
  private ambientVolume = 0.7;
  private effectVolume = 0.7;
  private readonly beds = BEDS.map((bed) => new AmbientBed(bed, BED_SPECS[bed]));
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

  // Short effects from other modules (the casino's) join the effects bus, so the effect volume covers them.
  get effectsOutput(): AudioNode | null {
    return this.effects;
  }

  // Called each time the context starts running, which is when a browser first lets sound out after a gesture.
  onUnlock(listener: () => void): void {
    this.unlockListeners.add(listener);
  }

  // The beds ride on the ambience bus; levels set before unlock are the ones they start at.
  setAmbience(levels: Ambience): void {
    for (const bed of this.beds) bed.set(levels[bed.name]);
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
      for (const bed of this.beds) bed.start(this.ctx, this.ambience);
      this.applyLevels();
      this.ctx.addEventListener("statechange", () => this.announce());
    }
    this.loadMoktSample();
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => undefined);
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
    for (const bed of this.beds) bed.stop();
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
    burst.buffer = noiseBuffer(ctx, 0.05);
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

  private applyLevels(): void {
    const ctx = this.ctx;
    if (!ctx || !this.effects || !this.ambience) return;
    const now = ctx.currentTime;
    this.effects.gain.cancelScheduledValues(now);
    this.effects.gain.setTargetAtTime(this.effectVolume, now, 0.05);
    this.ambience.gain.cancelScheduledValues(now);
    this.ambience.gain.setTargetAtTime(this.ambientVolume, now, 0.05);
  }
}
