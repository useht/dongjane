import { DROP_AUDIBLE_LEVEL, DROP_TICK_MS, DropPlanner, type DropProfile, FIRE_DROPS, RAIN_DROPS, WATER_DROPS } from "./drops.ts";
import type { Bed } from "./soundscape.ts";

// A level that moves by less than this is not heard, so the gain is not rescheduled for it.
const LEVEL_STEP = 0.004;
// The hiss and the body of the rain are trimmed against each other so it reads as rain, not as a low rumble.
const RAIN_HISS_LEVEL = 1.8;
const RAIN_BODY_LEVEL = 0.35;
const FIRE_ROAR_LEVEL = 0.35;

export function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
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

// Wires a bed's looping sound into `out`, the bed's own gain.
type Body = (ctx: AudioContext, out: AudioNode) => void;

function windBody(ctx: AudioContext, out: AudioNode): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 4);
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

  source.connect(low).connect(band).connect(swell).connect(out);
  source.start();
  lfo.start();
  sweep.start();
}

// Waves: a low rumble of noise whose lowpass opens and closes about every ten seconds as each wave rolls in and draws back,
// under a faint high hiss of foam that swells on a slightly different beat so the two never settle into a pattern.
function seaBody(ctx: AudioContext, out: AudioNode): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 8);
  source.loop = true;

  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 600;
  low.Q.value = 0.5;
  const rumble = ctx.createGain();
  rumble.gain.value = 0.55;
  const wave = ctx.createOscillator();
  wave.frequency.value = 0.1;
  const waveDepth = ctx.createGain();
  waveDepth.gain.value = 0.4;
  wave.connect(waveDepth).connect(rumble.gain);
  const open = ctx.createOscillator();
  open.frequency.value = 0.1;
  const openDepth = ctx.createGain();
  openDepth.gain.value = 420;
  open.connect(openDepth).connect(low.frequency);

  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 2600;
  high.Q.value = 0.5;
  const foam = ctx.createGain();
  foam.gain.value = 0.06;
  const foamBeat = ctx.createOscillator();
  foamBeat.frequency.value = 0.083;
  const foamDepth = ctx.createGain();
  foamDepth.gain.value = 0.05;
  foamBeat.connect(foamDepth).connect(foam.gain);

  source.connect(low).connect(rumble).connect(out);
  source.connect(high).connect(foam).connect(out);
  source.start();
  wave.start();
  open.start();
  foamBeat.start();
}

// Rain: a bandpass hiss over a lowpass body of looped noise; the single drops fall over it (see drops.ts).
function rainBody(ctx: AudioContext, out: AudioNode): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 8);
  source.loop = true;

  const hiss = ctx.createBiquadFilter();
  hiss.type = "bandpass";
  hiss.frequency.value = 3000;
  hiss.Q.value = 0.6;
  const body = ctx.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = 600;
  body.Q.value = 0.5;

  const hissLevel = ctx.createGain();
  hissLevel.gain.value = RAIN_HISS_LEVEL;
  const bodyLevel = ctx.createGain();
  bodyLevel.gain.value = RAIN_BODY_LEVEL;

  source.connect(hiss).connect(hissLevel).connect(out);
  source.connect(body).connect(bodyLevel).connect(out);
  source.start();
}

// A fire's low roar, flickering slowly under the crackle.
function fireBody(ctx: AudioContext, out: AudioNode): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 6);
  source.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 260;
  low.Q.value = 0.5;
  const roar = ctx.createGain();
  roar.gain.value = FIRE_ROAR_LEVEL;
  const flicker = ctx.createOscillator();
  flicker.frequency.value = 0.31;
  const flickerDepth = ctx.createGain();
  flickerDepth.gain.value = FIRE_ROAR_LEVEL * 0.4;
  flicker.connect(flickerDepth).connect(roar.gain);

  source.connect(low).connect(roar).connect(out);
  source.start();
  flicker.start();
}

export interface BedSpec {
  // the bed's gain at its full level, and how fast (seconds, as a time constant) that gain follows the level
  peak: number;
  follow: number;
  body?: Body;
  drops?: DropProfile;
}

export const BED_SPECS: Readonly<Record<Bed, BedSpec>> = {
  wind: { peak: 0.55, follow: 0.4, body: windBody },
  sea: { peak: 0.6, follow: 0.35, body: seaBody },
  rain: { peak: 0.15, follow: 0.4, body: rainBody, drops: RAIN_DROPS },
  fire: { peak: 0.2, follow: 0.4, body: fireBody, drops: FIRE_DROPS },
  water: { peak: 0.25, follow: 0.4, drops: WATER_DROPS },
};

// One ambient sound on the ambience bus. Its level (0 to 1, from where the monk is) is remembered from before the audio context
// exists; the single drops are scheduled by a timer that runs only while the level is high enough to hear them.
export class AmbientBed {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private drops: AudioBuffer | null = null;
  private planner: DropPlanner | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private wanted = 0;
  private applied = -1;

  constructor(
    readonly name: Bed,
    private readonly spec: BedSpec,
  ) {}

  set(level: number): void {
    this.wanted = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    this.follow();
    this.tend();
  }

  start(ctx: AudioContext, out: AudioNode): void {
    const gain = ctx.createGain();
    gain.gain.value = this.wanted * this.spec.peak;
    this.applied = this.wanted;
    this.spec.body?.(ctx, gain);
    gain.connect(out);
    this.ctx = ctx;
    this.gain = gain;
    if (this.spec.drops) {
      this.drops = noiseBuffer(ctx, 1);
      this.planner = new DropPlanner(this.spec.drops);
    }
    this.tend();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.ctx = null;
    this.gain = null;
    this.drops = null;
    this.planner = null;
    this.wanted = 0;
    this.applied = -1;
  }

  private follow(): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain || Math.abs(this.wanted - this.applied) < LEVEL_STEP) return;
    this.applied = this.wanted;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(this.wanted * this.spec.peak, now, this.spec.follow);
  }

  private tend(): void {
    const audible = this.ctx !== null && this.spec.drops !== undefined && this.wanted >= DROP_AUDIBLE_LEVEL;
    if (audible && this.timer === undefined) {
      this.timer = setInterval(() => this.fall(), DROP_TICK_MS);
    } else if (!audible && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private fall(): void {
    const ctx = this.ctx;
    const out = this.gain;
    const noise = this.drops;
    const planner = this.planner;
    const profile = this.spec.drops;
    if (!ctx || !out || !noise || !planner || !profile) return;
    for (const drop of planner.plan(ctx.currentTime, Math.random)) {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = drop.hz;
      band.Q.value = profile.q;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, drop.at);
      envelope.gain.linearRampToValueAtTime(drop.peak, drop.at + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, drop.at + profile.seconds);
      source.connect(band).connect(envelope).connect(out);
      const burst = profile.seconds + 0.01;
      source.start(drop.at, drop.from * (noise.length / ctx.sampleRate - burst), burst);
    }
  }
}
