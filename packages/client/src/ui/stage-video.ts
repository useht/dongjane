import { QUIET_PAUSE_MS } from "../audio/music.ts";
import { LoopSync } from "./loop-sync.ts";

export const STAGE_VIDEO_ID = "ykT0Ezc9k-E";
export const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";
export const PLAYER_CHANNEL = "dongjane-stage";

export const READY_TIMEOUT_MS = 8000;
export const UNMUTE_CHECK_MS = 1000;
export const TAP_WINDOW_MS = 6000;
// A play that has not turned into a playing video by then gives the button back as "play".
export const START_TIMEOUT_MS = 8000;
// How near the stage a visitor must be for the play and stop button to float over its screen.
export const STAGE_HINT_REACH = 10;
// Walking moves the level all the time; the player is told at most this often.
const VOLUME_GAP_MS = 250;
export const PAUSE_GAP_MS = 1000;
// Reports of a pause or play of ours keep arriving, some of them stale, for about this long; a pause among them is not the visitor's.
export const OWN_PAUSE_MS = 2000;

// The player reports these when the video cannot be shown here at all.
export const BLOCKING_ERRORS: ReadonlySet<number> = new Set([2, 5, 100, 101, 150, 153]);

export type PlayerEvent =
  | { kind: "ready" }
  | { kind: "error"; code: number }
  | { kind: "info"; time?: number; duration?: number; muted?: boolean; volume?: number; state?: number };

export function embedUrl(pageOrigin: string, videoId: string = STAGE_VIDEO_ID): string {
  const query = new URLSearchParams({
    autoplay: "0",
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

export type StageStatus = "idle" | "loading" | "ready" | "blocked";

// What this visitor's video is doing: waiting to be played, asked to play but not yet playing, or playing.
export type Playback = "waiting" | "starting" | "playing";

export type HintAction = "play" | "stop";

export interface HintInput {
  live: boolean;
  // Metres from the stage, or null when the visitor's place is not known.
  distance: number | null;
  status: StageStatus;
  playback: Playback;
}

// The button floated over the screen: only in a live world, near the stage and once the player can be steered;
// play while waiting, stop from the press of play on.
export function hintAction({ live, distance, status, playback }: HintInput): HintAction | null {
  if (!live || status !== "ready" || distance === null || !(distance <= STAGE_HINT_REACH)) return null;
  return playback === "waiting" ? "play" : "stop";
}

// The LED screen shows the poster unless this visitor's video is playing and motion is allowed.
export function screenModeFor(playback: Playback, reduceMotion: boolean): "video" | "poster" {
  return playback === "playing" && !reduceMotion ? "video" : "poster";
}

export interface BlockReason {
  readonly kind: "timeout" | "error";
  readonly code?: number;
}

export interface StageVideoOutput {
  send(func: string, args?: readonly unknown[]): void;
  status(status: StageStatus, reason?: BlockReason): void;
  tapNeeded(needed: boolean): void;
  playback(playback: Playback): void;
  audible(audible: boolean): void;
}

export const ENDED = 0;
export const PLAYING = 1;
export const PAUSED = 2;

// Decides what to tell the embedded player. It knows nothing about the DOM: time arrives through the two clocks
// (`now` for local timeouts, `serverNow` for the shared position in the loop). The video waits, muted, until `play()`;
// nothing here starts it again once it has stopped, except stepping back out of the 법당 within the grace of its pause.
export class StageVideoController {
  private current: StageStatus = "idle";
  private openedAt = 0;
  private ready = false;
  private wanted = false;
  private started = false;
  private askedAt = 0;
  private playbackNow: Playback = "waiting";
  private wantSound = false;
  private volume = 0;
  private level = 1;
  private quietSince: number | null = null;
  private lastVolumeAt = Number.NEGATIVE_INFINITY;
  private volumeDue = false;
  private gestured = false;
  private playerMuted: boolean | null = null;
  private duration = 0;
  private time = 0;
  private state = -1;
  private appliedKey = "";
  private unmuteAt: number | null = null;
  private tapShown = false;
  private audibleNow = false;
  // Paused by us because the visitor is inside the 법당; the play is still wanted.
  private held = false;
  private ownPauseUntil = Number.NEGATIVE_INFINITY;
  private lastPauseAt = Number.NEGATIVE_INFINITY;
  private readonly sync: LoopSync;

  constructor(
    private readonly out: StageVideoOutput,
    private readonly now: () => number,
    serverNow: () => number,
  ) {
    this.sync = new LoopSync(now, serverNow, (to) => out.send("seekTo", [to, true]));
  }

  get status(): StageStatus {
    return this.current;
  }

  get playback(): Playback {
    return this.playbackNow;
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
    if (this.current !== "loading" && this.current !== "ready") return;
    if (event.kind === "error") {
      if (BLOCKING_ERRORS.has(event.code)) this.block({ kind: "error", code: event.code });
      return;
    }
    this.markReady();
    if (event.kind === "ready") return;
    if (event.duration !== undefined) this.duration = Math.round(event.duration * 10) / 10;
    if (event.time !== undefined) this.time = event.time;
    if (event.muted !== undefined) this.playerMuted = event.muted;
    if (event.state !== undefined) this.onState(event.state);
    if (this.wanted && !this.held && this.state === PLAYING) this.sync.follow(this.time, this.duration);
    this.reportAudio();
  }

  tick(): void {
    const now = this.now();
    if (this.current === "loading" && !this.ready && now - this.openedAt >= READY_TIMEOUT_MS) {
      this.block({ kind: "timeout" });
      return;
    }
    if (this.current !== "loading" && this.current !== "ready") return;
    if (this.volumeDue) this.applyAudio(false);
    // A play that never reaches the player's PLAYING is given up, so the button reads "play" again.
    if (this.wanted && !this.held && !this.started && now - this.askedAt >= START_TIMEOUT_MS) this.endPlay(true);
    // Nobody is in earshot of the concert: a playing video is ended, and it is the visitor's to start again.
    if (this.wanted && this.quietSince !== null && now - this.quietSince >= QUIET_PAUSE_MS) this.endPlay(true);
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

  // How much of the concert the visitor is meant to hear, 0 to 1: the 법당's share turned round. At 0 (deep inside the 법당)
  // a playing video is paused at once, because a phone ignores the player's volume; it plays on if the visitor steps out
  // again, and is ended if they stay long enough.
  setLevel(level: number): void {
    const next = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
    if (next === this.level) return;
    this.level = next;
    if (next > 0) this.quietSince = null;
    else if (this.quietSince === null) this.quietSince = this.now();
    this.syncHold();
    this.applyAudio(false, true);
  }

  userGesture(): void {
    this.gestured = true;
    this.sync.recheck();
    this.applyAudio(true);
  }

  // The visitor asked for the video: a real click, so the browser lets the sound and the playing through.
  play(): void {
    if (!this.ready) return;
    if (!this.wanted) {
      this.wanted = true;
      this.started = false;
      this.askedAt = this.now();
    }
    if (this.level === 0) this.quietSince = this.now();
    this.userGesture();
    if (this.level === 0) {
      this.held = true;
    } else {
      // Seeking first, so the first sound is already the shared place in the loop; while the length is unknown it waits for PLAYING.
      this.sync.jump(this.duration);
      this.out.send("playVideo");
    }
    this.updatePlayback();
  }

  stop(): void {
    if (this.wanted) this.endPlay(true);
  }

  private reset(): void {
    this.ready = false;
    this.wanted = false;
    this.started = false;
    this.playerMuted = null;
    this.duration = 0;
    this.time = 0;
    this.state = -1;
    this.appliedKey = "";
    this.unmuteAt = null;
    this.held = false;
    this.sync.reset();
    this.lastPauseAt = Number.NEGATIVE_INFINITY;
    this.lastVolumeAt = Number.NEGATIVE_INFINITY;
    this.volumeDue = false;
    this.quietSince = null;
    this.setTap(false);
    this.setAudible(false);
    this.updatePlayback();
  }

  // The first word from the player, whatever it is, means it can be steered.
  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.setStatus("ready");
  }

  // Back to waiting with the sound off; `pause` is false when the player has already stopped by itself.
  private endPlay(pause: boolean): void {
    this.wanted = false;
    this.started = false;
    this.held = false;
    if (pause) this.out.send("pauseVideo");
    this.applyAudio(false);
    this.updatePlayback();
  }

  private updatePlayback(): void {
    const next: Playback = !this.wanted ? "waiting" : this.started ? "playing" : "starting";
    if (next === this.playbackNow) return;
    this.playbackNow = next;
    this.out.playback(next);
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
    this.state = state;
    if (state === PLAYING) {
      if (this.wanted && !this.held) this.started = true;
      else this.pauseStray();
    } else if (state === ENDED && this.wanted && !this.held) {
      // The loop may report its end at every wrap; only a stop ends the play, so it goes on from the shared place.
      this.sync.jump(this.duration);
      this.out.send("playVideo");
    } else if (this.started && !this.held && this.now() >= this.ownPauseUntil && state === PAUSED) {
      // A tap on the player or the browser paused it: that ends this play, and nothing restarts it. Our own pauses do not.
      this.endPlay(false);
    }
    this.updatePlayback();
  }

  // Paused while the visitor is deep inside the 법당, and played on from the loop's place when they step out.
  private syncHold(): void {
    const hold = this.wanted && this.level === 0;
    if (hold === this.held) return;
    this.held = hold;
    const now = this.now();
    this.ownPauseUntil = now + OWN_PAUSE_MS;
    if (hold) {
      this.lastPauseAt = now;
      this.out.send("pauseVideo");
      return;
    }
    this.askedAt = now;
    this.sync.recheck();
    this.sync.jump(this.duration);
    this.out.send("playVideo");
  }

  // A player that plays unasked, or has not yet heard the stop, is told to pause: not more than once a second.
  private pauseStray(): void {
    const now = this.now();
    if (now - this.lastPauseAt < PAUSE_GAP_MS) return;
    this.lastPauseAt = now;
    this.out.send("pauseVideo");
  }

  private percent(): number {
    return Math.round(this.volume * this.level * 100);
  }

  private wantsAudible(): boolean {
    return this.ready && this.wanted && this.wantSound && this.gestured && this.percent() > 0;
  }

  // Muted is how the video waits; sound is asked for only while it plays, after a gesture (autoplay policy) and only while the setting is on.
  private applyAudio(force: boolean, throttled = false): void {
    if (!this.ready) return;
    const key = this.wantsAudible() ? `on|${this.percent()}` : "off";
    if (key === this.appliedKey && !force) {
      this.volumeDue = false;
      return;
    }
    const now = this.now();
    if (throttled && !force && key !== "off" && this.appliedKey !== "off" && now - this.lastVolumeAt < VOLUME_GAP_MS) {
      this.volumeDue = true;
      return;
    }
    this.volumeDue = false;
    this.lastVolumeAt = now;
    const wasOn = this.appliedKey.startsWith("on|");
    this.appliedKey = key;
    if (key === "off") {
      this.out.send("mute");
      this.unmuteAt = null;
      this.setTap(false);
      this.setAudible(false);
      return;
    }
    this.out.send("setVolume", [this.percent()]);
    if (wasOn && !force) return;
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
}
