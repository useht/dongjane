import type { AudioEngine } from "./engine.ts";

export const SUTRA_FADE_SECONDS = 1.5;
const RESYNC_MS = 15_000;
const RESYNC_GAP_SECONDS = 0.5;

// Where a loop of this length is at the server's time. Everyone computes the same answer, so everyone hears the same bar.
export function loopPosition(serverMs: number, durationSeconds: number): number {
  if (!(durationSeconds > 0) || !Number.isFinite(serverMs)) return 0;
  const position = (serverMs / 1000) % durationSeconds;
  return position < 0 ? position + durationSeconds : position;
}

// The Heart Sutra read aloud, looped under the 법당 roof. It runs through the engine's master gain so the one
// volume slider and the one sound switch also govern it, and it is only fetched when someone first steps inside.
export class SutraPlayer {
  private audio: HTMLAudioElement | null = null;
  private fade: GainNode | null = null;
  private loading = false;
  private indoors = false;
  private hidden = false;
  private resync: number | undefined;
  private stopTimer: number | undefined;

  constructor(
    private readonly engine: AudioEngine,
    private readonly serverNow: () => number | null,
    private readonly locate: () => Promise<string>,
  ) {
    engine.onUnlock(() => this.apply());
  }

  get playing(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  setIndoors(indoors: boolean): void {
    this.indoors = indoors;
    this.apply();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.apply();
  }

  dispose(): void {
    window.clearInterval(this.resync);
    window.clearTimeout(this.stopTimer);
    this.audio?.pause();
    this.audio = null;
    this.fade = null;
  }

  private apply(): void {
    if (this.indoors && !this.hidden) void this.start();
    else this.stop();
  }

  private async start(): Promise<void> {
    window.clearTimeout(this.stopTimer);
    const ctx = this.engine.context;
    const output = this.engine.output;
    if (!ctx || !output || !this.engine.unlocked) return;
    if (!this.audio) {
      if (this.loading) return;
      this.loading = true;
      try {
        const audio = new Audio(await this.locate());
        audio.loop = true;
        audio.preload = "auto";
        const fade = ctx.createGain();
        fade.gain.value = 0;
        ctx.createMediaElementSource(audio).connect(fade).connect(output);
        this.audio = audio;
        this.fade = fade;
      } catch {
        return;
      } finally {
        this.loading = false;
      }
    }
    const { audio, fade } = this;
    if (!audio || !fade || !this.indoors || this.hidden) return;
    this.seek(audio);
    try {
      await audio.play();
    } catch {
      return;
    }
    if (!this.indoors || this.hidden) return;
    this.seek(audio);
    const now = ctx.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.linearRampToValueAtTime(1, now + SUTRA_FADE_SECONDS);
    window.clearInterval(this.resync);
    this.resync = window.setInterval(() => this.seek(audio, RESYNC_GAP_SECONDS), RESYNC_MS);
  }

  private stop(): void {
    window.clearInterval(this.resync);
    const { audio, fade } = this;
    const ctx = this.engine.context;
    if (!audio || !fade || !ctx || audio.paused) return;
    const now = ctx.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.linearRampToValueAtTime(0, now + SUTRA_FADE_SECONDS);
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => audio.pause(), SUTRA_FADE_SECONDS * 1000 + 100);
  }

  private seek(audio: HTMLAudioElement, tolerance = 0): void {
    const duration = audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const target = loopPosition(this.serverNow() ?? Date.now(), duration);
    const gap = Math.abs(audio.currentTime - target);
    if (gap > tolerance && duration - gap > tolerance) audio.currentTime = target;
  }
}
