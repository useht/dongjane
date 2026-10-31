import { DHARMA_BOUNDS, dharmaToWorld } from "@dongjane/shared";
import { DHARMA, DHARMA_DOOR } from "../game/dharma-layout.ts";
import type { AudioEngine } from "./engine.ts";

// The length of sutra.mp3 once decoded. The file is constant-bit-rate on purpose: every browser agrees on the length of
// such a file, and everyone's place in the loop is worked out from this number, not from what their browser reports.
export const SUTRA_SECONDS = 116;

// Where a loop of this length is at the server's time. Everyone computes the same answer, so everyone hears the same bar.
export function loopPosition(serverMs: number, durationSeconds: number): number {
  if (!(durationSeconds > 0) || !Number.isFinite(serverMs)) return 0;
  const position = (serverMs / 1000) % durationSeconds;
  return position < 0 ? position + durationSeconds : position;
}

// A seek takes a moment to land, so it aims this far ahead of where the loop is now.
export const SEEK_LOOKAHEAD_SECONDS = 0.3;

export function aimAhead(target: number, durationSeconds: number): number {
  return durationSeconds > 0 ? (target + SEEK_LOOKAHEAD_SECONDS) % durationSeconds : target;
}

// Both soundtracks always run; where the visitor stands only sets their loudness (areaMix, and chantMix for the sutra).
export const DEEP_METRES = 3;
export const OUTSIDE_METRES = 6;

// The middle of the front door, in the front wall's plane; the door faces +x.
const DOORWAY = dharmaToWorld(0, DHARMA.frontZ);

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isInsideRoom(x: number, z: number): boolean {
  return x >= DHARMA_BOUNDS.minX && x <= DOORWAY.x && z >= DHARMA_BOUNDS.minZ && z <= DHARMA_BOUNDS.maxZ;
}

export function areaMix(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  if (isInsideRoom(x, z)) return 0.5 + 0.5 * unit((DOORWAY.x - x) / DEEP_METRES);
  const beside = Math.max(0, Math.abs(z - DOORWAY.z) - DHARMA_DOOR.halfWidth);
  const away = Math.hypot(beside, Math.max(0, x - DOORWAY.x));
  return 0.5 * (1 - unit(away / OUTSIDE_METRES));
}

// The sutra's share: areaMix inside the room (the doorway included), silent everywhere outside it.
export function chantMix(x: number, z: number): number {
  return Number.isFinite(x) && Number.isFinite(z) && isInsideRoom(x, z) ? areaMix(x, z) : 0;
}

// How far a recording may stray from its place in the loop before something is done about it, and what.
export const DRIFT_STILL_SECONDS = 0.08;
export const DRIFT_GLIDE_SECONDS = 1;
export const GLIDE_RATE = 0.03;

export type DriftAction = { kind: "hold" } | { kind: "glide"; rate: number } | { kind: "seek"; to: number };

// Small drift is walked off by playing a few percent slower or faster, so the 목탁 does not click; large drift is jumped over.
export function driftAction(current: number, target: number, durationSeconds: number): DriftAction {
  if (!(durationSeconds > 0) || !Number.isFinite(current) || !Number.isFinite(target)) return { kind: "hold" };
  let ahead = (current - target) % durationSeconds;
  if (ahead > durationSeconds / 2) ahead -= durationSeconds;
  if (ahead < -durationSeconds / 2) ahead += durationSeconds;
  const size = Math.abs(ahead);
  if (size <= DRIFT_STILL_SECONDS) return { kind: "hold" };
  if (size <= DRIFT_GLIDE_SECONDS) return { kind: "glide", rate: ahead > 0 ? 1 - GLIDE_RATE : 1 + GLIDE_RATE };
  return { kind: "seek", to: target };
}

export const DRIFT_CHECK_MS = 2000;
// A recording nobody can hear is stopped after this long and picked up at the right place when it is wanted again.
export const QUIET_PAUSE_MS = 20_000;
// The chant is mastered quiet; at the default ambience of 0.7 this lifts it to about its mastered level.
export const SUTRA_LEVEL = 1.4;
const GAIN_SMOOTHING_SECONDS = 0.4;

interface ScreenLock {
  readonly released: boolean;
  release(): Promise<void>;
}

interface ScreenWakeLocks {
  request(type: "screen"): Promise<ScreenLock>;
}

export interface SyncedLoopOptions {
  seconds?: number;
  now?: () => number;
  createAudio?: (url: string) => HTMLAudioElement;
  wakeLock?: () => ScreenWakeLocks | undefined;
}

// The chant, looped. It runs through the engine's ambience bus, so the one volume slider and the one sound switch also
// govern it. Nothing is fetched or played before the visitor's first gesture; after that it runs whenever the visitor is
// in the world, at a loudness set by `setMix` (silent outside the 법당), and is held to the server's place in the loop.
export class SyncedLoop {
  private audio: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private active = false;
  private mixNow = 0;
  private quietSince: number | null = null;
  private primed = false;
  private starting = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private screenLock: ScreenLock | null = null;
  private screenWanted = false;
  private screenAsked = false;
  private readonly seconds: number;
  private readonly now: () => number;
  private readonly createAudio: (url: string) => HTMLAudioElement;
  private readonly wakeLock: () => ScreenWakeLocks | undefined;

  constructor(
    private readonly engine: AudioEngine,
    private readonly serverNow: () => number | null,
    private readonly url: string,
    options: SyncedLoopOptions = {},
  ) {
    this.seconds = options.seconds ?? SUTRA_SECONDS;
    this.now = options.now ?? (() => performance.now());
    this.createAudio = options.createAudio ?? ((source) => new Audio(source));
    this.wakeLock =
      options.wakeLock ??
      (() => {
        const scope = globalThis as unknown as { navigator?: { wakeLock?: ScreenWakeLocks } };
        return scope.navigator?.wakeLock;
      });
    engine.onUnlock(() => this.prime());
  }

  get playing(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  get mix(): number {
    return this.mixNow;
  }

  // Called from inside a gesture so the browser allows the first play; once primed, `update` settles what it should do.
  prime(): void {
    if (this.primed) {
      this.update();
      return;
    }
    const audio = this.ensure();
    if (!audio) return;
    this.primed = true;
    void this.start(audio);
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.applyGain();
    this.update();
  }

  setMix(mix: number): void {
    const next = unit(Number.isFinite(mix) ? mix : 0);
    if (Math.abs(next - this.mixNow) < 0.005 && (next > 0) === (this.mixNow > 0)) return;
    this.mixNow = next;
    this.applyGain();
    this.update();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.audio?.pause();
    this.holdScreen(false);
    this.audio = null;
    this.gain = null;
  }

  // Every couple of seconds while it plays: walk off drift, and stop when nobody has been able to hear it for a while.
  tick(): void {
    const audio = this.audio;
    if (audio && !audio.paused) this.correct(audio);
    this.update();
  }

  private ensure(): HTMLAudioElement | null {
    if (this.audio) return this.audio;
    const ctx = this.engine.context;
    const output = this.engine.output;
    if (!ctx || !output) return null;
    try {
      const audio = this.createAudio(this.url);
      audio.loop = true;
      audio.preload = "auto";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(gain).connect(output);
      audio.addEventListener("loadedmetadata", () => this.align(audio));
      this.audio = audio;
      this.gain = gain;
      this.applyGain();
      return audio;
    } catch {
      return null;
    }
  }

  private applyGain(): void {
    const ctx = this.engine.context;
    if (!this.gain || !ctx) return;
    const level = this.active ? this.mixNow * SUTRA_LEVEL : 0;
    const at = ctx.currentTime;
    this.gain.gain.cancelScheduledValues(at);
    this.gain.gain.setTargetAtTime(level, at, GAIN_SMOOTHING_SECONDS);
  }

  private wanted(): boolean {
    if (!this.active || !this.engine.unlocked) return false;
    if (this.mixNow > 0) {
      this.quietSince = null;
      return true;
    }
    const now = this.now();
    if (this.quietSince === null) this.quietSince = now;
    return now - this.quietSince < QUIET_PAUSE_MS;
  }

  private update(): void {
    const audio = this.audio;
    if (!audio) return;
    const wanted = this.wanted();
    if (wanted && audio.paused) void this.start(audio);
    else if (!wanted && !audio.paused && !this.starting) this.halt(audio);
    if (wanted && this.timer === undefined) this.timer = setInterval(() => this.tick(), DRIFT_CHECK_MS);
    else if (!wanted && this.timer !== undefined && audio.paused) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.holdScreen(wanted && !audio.paused);
  }

  // iPhone Safari suspends the chant's audio when the screen locks, so the screen stays awake while it plays.
  private holdScreen(on: boolean): void {
    this.screenWanted = on;
    if (!on) {
      const lock = this.screenLock;
      this.screenLock = null;
      if (lock) void lock.release().catch(() => undefined);
      return;
    }
    if (this.screenLock && !this.screenLock.released) return;
    this.screenLock = null;
    const locks = this.wakeLock();
    if (!locks || this.screenAsked) return;
    this.screenAsked = true;
    locks
      .request("screen")
      .then(
        (lock) => {
          if (this.screenWanted) this.screenLock = lock;
          else void lock.release().catch(() => undefined);
        },
        () => undefined,
      )
      .finally(() => {
        this.screenAsked = false;
      });
  }

  private async start(audio: HTMLAudioElement): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      this.align(audio);
      await audio.play();
      this.align(audio);
    } catch {
      // The browser wants a gesture first: the next unlock asks again, and nothing here may retry on its own.
      this.primed = false;
      return;
    } finally {
      this.starting = false;
    }
    this.update();
  }

  private halt(audio: HTMLAudioElement): void {
    audio.pause();
    audio.playbackRate = 1;
    this.quietSince = null;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private target(): number {
    return loopPosition(this.serverNow() ?? Date.now(), this.seconds);
  }

  private align(audio: HTMLAudioElement): void {
    audio.playbackRate = 1;
    audio.currentTime = aimAhead(this.target(), this.seconds);
  }

  private correct(audio: HTMLAudioElement): void {
    if (audio.seeking || audio.readyState < 2) return;
    const action = driftAction(audio.currentTime, this.target(), this.seconds);
    if (action.kind === "seek") {
      this.align(audio);
    } else if (action.kind === "glide") {
      audio.preservesPitch = true;
      audio.playbackRate = action.rate;
    } else if (audio.playbackRate !== 1) {
      audio.playbackRate = 1;
    }
  }
}
