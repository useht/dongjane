import { loopPosition } from "../audio/music.ts";

export const STAGE_VIDEO_ID = "ykT0Ezc9k-E";
export const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";
export const PLAYER_CHANNEL = "dongjane-stage";

export const READY_TIMEOUT_MS = 8000;
export const UNMUTE_CHECK_MS = 1000;
export const TAP_WINDOW_MS = 6000;
const DRIFT_SECONDS = 3;
const RESYNC_MIN_MS = 10_000;
const RETRY_PLAY_MS = 4000;

// The player reports these when the video cannot be shown here at all.
const BLOCKING_ERRORS: ReadonlySet<number> = new Set([2, 5, 100, 101, 150, 153]);

export type PlayerEvent =
  | { kind: "ready" }
  | { kind: "error"; code: number }
  | { kind: "info"; time?: number; duration?: number; muted?: boolean; volume?: number; state?: number };

export function embedUrl(pageOrigin: string, videoId: string = STAGE_VIDEO_ID): string {
  const query = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    loop: "1",
    playlist: videoId,
    enablejsapi: "1",
    playsinline: "1",
    controls: "0",
    rel: "0",
    modestbranding: "1",
    disablekb: "1",
    fs: "0",
    origin: pageOrigin,
  });
  return `${PLAYER_ORIGIN}/embed/${videoId}?${query.toString()}`;
}

export function playerCommand(func: string, args: readonly unknown[] = []): string {
  return JSON.stringify({ event: "command", func, args, id: PLAYER_CHANNEL, channel: "widget" });
}

export function listeningMessage(): string {
  return JSON.stringify({ event: "listening", id: PLAYER_CHANNEL, channel: "widget" });
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// The embedded player posts JSON strings (or objects); anything else on the window is not ours to read.
export function parsePlayerMessage(data: unknown): PlayerEvent | null {
  let message: unknown = data;
  if (typeof data === "string") {
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof message !== "object" || message === null) return null;
  const { event, info } = message as { event?: unknown; info?: unknown };
  if (event === "onReady") return { kind: "ready" };
  if (event === "onError") {
    const code = numberOf(info);
    return code === undefined ? null : { kind: "error", code };
  }
  if (event === "onStateChange") {
    const state = numberOf(info);
    return state === undefined ? null : { kind: "info", state };
  }
  if (event === "infoDelivery" || event === "initialDelivery") {
    if (typeof info !== "object" || info === null) return null;
    const fields = info as Record<string, unknown>;
    const parsed: PlayerEvent = { kind: "info" };
    const time = numberOf(fields.currentTime);
    const duration = numberOf(fields.duration);
    const volume = numberOf(fields.volume);
    const state = numberOf(fields.playerState);
    if (time !== undefined) parsed.time = time;
    if (duration !== undefined) parsed.duration = duration;
    if (volume !== undefined) parsed.volume = volume;
    if (state !== undefined) parsed.state = state;
    if (typeof fields.muted === "boolean") parsed.muted = fields.muted;
    return parsed;
  }
  return null;
}

export type StageStatus = "idle" | "loading" | "playing" | "blocked";

export interface BlockReason {
  readonly kind: "timeout" | "error";
  readonly code?: number;
}

export interface StageVideoOutput {
  send(func: string, args?: readonly unknown[]): void;
  status(status: StageStatus, reason?: BlockReason): void;
  tapNeeded(needed: boolean): void;
  audible(audible: boolean): void;
}

const PLAYING = 1;
const ENDED = 0;
const PAUSED = 2;

// Decides what to tell the embedded player. It knows nothing about the DOM: time arrives through the two clocks
// (`now` for local timeouts, `serverNow` for the shared position in the loop).
export class StageVideoController {
  private current: StageStatus = "idle";
  private openedAt = 0;
  private ready = false;
  private wantSound = false;
  private volume = 0;
  private gestured = false;
  private hidden = false;
  private playerMuted: boolean | null = null;
  private duration = 0;
  private time = 0;
  private state = -1;
  private appliedKey = "";
  private unmuteAt: number | null = null;
  private tapShown = false;
  private audibleNow = false;
  private needSeek = true;
  private lastSeekAt = Number.NEGATIVE_INFINITY;
  private lastPlayAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly out: StageVideoOutput,
    private readonly now: () => number,
    private readonly serverNow: () => number,
  ) {}

  get status(): StageStatus {
    return this.current;
  }

  open(): void {
    this.reset();
    this.openedAt = this.now();
    this.setStatus("loading");
  }

  close(): void {
    this.reset();
    this.setStatus("idle");
  }

  receive(event: PlayerEvent): void {
    if (this.current !== "loading" && this.current !== "playing") return;
    if (event.kind === "error") {
      if (BLOCKING_ERRORS.has(event.code)) this.block({ kind: "error", code: event.code });
      return;
    }
    this.markReady();
    if (event.kind === "ready") return;
    if (event.duration !== undefined) this.duration = event.duration;
    if (event.time !== undefined) this.time = event.time;
    if (event.muted !== undefined) this.playerMuted = event.muted;
    if (event.state !== undefined) this.onState(event.state);
    this.maybeSeek();
    this.reportAudio();
  }

  tick(): void {
    const now = this.now();
    if (this.current === "loading" && !this.ready && now - this.openedAt >= READY_TIMEOUT_MS) {
      this.block({ kind: "timeout" });
      return;
    }
    if (this.current !== "loading" && this.current !== "playing") return;
    if (this.ready && !this.hidden && this.state !== PLAYING && now - this.lastPlayAt >= RETRY_PLAY_MS) {
      this.out.send("playVideo");
      this.lastPlayAt = now;
    }
    // Still muted a second after asking: the browser wants a tap on the player itself. Asking again is harmless
    // and is what lets the sound out once that tap has happened.
    if (this.wantsAudible() && this.playerMuted === true && this.unmuteAt !== null && now - this.unmuteAt >= UNMUTE_CHECK_MS) {
      this.setTap(true);
      this.out.send("unMute");
      this.unmuteAt = now;
    }
  }

  setSound(on: boolean, volume: number): void {
    this.wantSound = on && volume > 0;
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyAudio(false);
  }

  userGesture(): void {
    this.gestured = true;
    this.applyAudio(true);
  }

  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!this.ready) return;
    if (hidden) {
      this.out.send("pauseVideo");
    } else {
      this.needSeek = true;
      this.out.send("playVideo");
      this.lastPlayAt = this.now();
      this.maybeSeek();
    }
  }

  private reset(): void {
    this.ready = false;
    this.playerMuted = null;
    this.duration = 0;
    this.time = 0;
    this.state = -1;
    this.appliedKey = "";
    this.unmuteAt = null;
    this.needSeek = true;
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.lastPlayAt = Number.NEGATIVE_INFINITY;
    this.setTap(false);
    this.setAudible(false);
  }

  // The first word from the player, whatever it is, means it can be steered.
  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.out.send("playVideo");
    this.lastPlayAt = this.now();
    this.applyAudio(true);
  }

  private setStatus(status: StageStatus, reason?: BlockReason): void {
    if (status === this.current) return;
    this.current = status;
    this.out.status(status, reason);
  }

  private block(reason: BlockReason): void {
    this.reset();
    this.setStatus("blocked", reason);
  }

  private onState(state: number): void {
    const before = this.state;
    this.state = state;
    if (state === PLAYING) {
      this.setStatus("playing");
      return;
    }
    if (this.hidden || !this.ready) return;
    // A tap that landed on the player pauses it, and a one-shot video ends; either way keep the concert going.
    if (state === PAUSED || state === ENDED) {
      this.out.send("playVideo");
      this.lastPlayAt = this.now();
      if (before === PLAYING && this.wantSound && this.gestured) this.applyAudio(true);
    }
  }

  private wantsAudible(): boolean {
    return this.ready && this.wantSound && this.gestured;
  }

  // Muted is how the video starts; sound is asked for only after a gesture (autoplay policy) and only while the setting is on.
  private applyAudio(force: boolean): void {
    if (!this.ready) return;
    const key = this.wantsAudible() ? `on|${Math.round(this.volume * 100)}` : "off";
    if (key === this.appliedKey && !force) return;
    this.appliedKey = key;
    if (key === "off") {
      this.out.send("mute");
      this.unmuteAt = null;
      this.setTap(false);
      this.setAudible(false);
      return;
    }
    this.out.send("setVolume", [Math.round(this.volume * 100)]);
    this.out.send("unMute");
    this.unmuteAt = this.now();
  }

  private reportAudio(): void {
    if (this.wantsAudible() && this.playerMuted === false) {
      this.setTap(false);
      this.setAudible(this.state === PLAYING);
    } else {
      this.setAudible(false);
    }
  }

  private setTap(needed: boolean): void {
    if (needed === this.tapShown) return;
    this.tapShown = needed;
    this.out.tapNeeded(needed);
  }

  private setAudible(audible: boolean): void {
    if (audible === this.audibleNow) return;
    this.audibleNow = audible;
    this.out.audible(audible);
  }

  // Everyone's player is moved to the same spot of the loop; a live stream has no duration and is left alone.
  private maybeSeek(): void {
    if (this.hidden || this.duration <= 0 || this.state !== PLAYING) return;
    const now = this.now();
    const target = loopPosition(this.serverNow(), this.duration);
    const off = Math.abs(this.time - target);
    const gap = Math.min(off, this.duration - off);
    const due = this.needSeek || (gap > DRIFT_SECONDS && now - this.lastSeekAt >= RESYNC_MIN_MS);
    if (!due) return;
    this.needSeek = false;
    this.lastSeekAt = now;
    if (gap > 0.5) this.out.send("seekTo", [target, true]);
  }
}
