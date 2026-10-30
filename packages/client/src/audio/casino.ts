export interface CasinoSoundUrls {
  coin: string;
  click: string;
  jackpot: string;
}

// What the casino's sounds need of the audio engine: its context, and the bus the effect volume rides on.
export interface CasinoSoundHost {
  readonly context: AudioContext | null;
  readonly effectsOutput: AudioNode | null;
}

type Recording = keyof CasinoSoundUrls;

// The recordings are cut and levelled in the files themselves (see assets/audio/sources.md); these only trim them beside the bell.
const RECORDING_GAIN: Readonly<Record<Recording, number>> = { coin: 0.8, click: 0.7, jackpot: 0.8 };
// The reels tick once for each symbol that goes by; with five of them that is dozens a second, so the ticks are thinned out.
export const TICK_GAP_SECONDS = 0.045;

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

// The casino's sounds: three recordings (the coins, a button click, the jackpot), and a reel's tick and stop made on the spot.
// Every method does nothing until the visitor has made a gesture and the audio engine has a running context, so the games work
// the same without sound.
export class CasinoSounds {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<Recording, AudioBuffer>();
  private lastTick = -Infinity;

  constructor(
    private readonly host: CasinoSoundHost,
    private readonly urls: CasinoSoundUrls,
    private readonly load: (url: string) => Promise<ArrayBuffer> = fetchBytes,
  ) {}

  // Fetches and decodes the recordings the first time the panel opens (and again if the engine starts over with a new context).
  prepare(): void {
    const ctx = this.host.context;
    if (!ctx || this.context === ctx) return;
    this.context = ctx;
    this.buffers.clear();
    for (const name of Object.keys(this.urls) as Recording[]) {
      void this.load(this.urls[name])
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          if (this.context === ctx) this.buffers.set(name, buffer);
        })
        .catch(() => undefined);
    }
  }

  click(): void {
    this.play("click");
  }

  coin(): void {
    this.play("coin");
  }

  jackpot(): void {
    this.play("jackpot");
  }

  tick(): void {
    const ready = this.ready();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;
    if (now - this.lastTick < TICK_GAP_SECONDS) return;
    this.lastTick = now;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.02);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.035, now + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    osc.connect(envelope).connect(out);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  stop(): void {
    const ready = this.ready();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.2, now + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(envelope).connect(out);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  private ready(): { ctx: AudioContext; out: AudioNode } | null {
    const ctx = this.host.context;
    const out = this.host.effectsOutput;
    return ctx && out && ctx.state === "running" ? { ctx, out } : null;
  }

  private play(name: Recording): void {
    const ready = this.ready();
    const buffer = this.buffers.get(name);
    if (!ready || !buffer || this.context !== ready.ctx) return;
    const { ctx, out } = ready;
    const source = ctx.createBufferSource();
    const level = ctx.createGain();
    source.buffer = buffer;
    level.gain.value = RECORDING_GAIN[name];
    source.connect(level).connect(out);
    source.start();
  }
}
