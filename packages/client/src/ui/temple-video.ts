import { LoopSync } from "./loop-sync.ts";
import {
  BLOCKING_ERRORS,
  type BlockReason,
  ENDED,
  OWN_PAUSE_MS,
  PAUSED,
  PAUSE_GAP_MS,
  PLAYING,
  type PlayerEvent,
  READY_TIMEOUT_MS,
  START_TIMEOUT_MS,
  type StageStatus,
  UNMUTE_CHECK_MS,
} from "./stage-video.ts";

export const TEMPLE_VIDEO_ID = "10TrBnVkPgc";

export interface TempleVideoOutput {
  send(func: string, args?: readonly unknown[]): void;
  status(status: StageStatus, reason?: BlockReason): void;
  tapNeeded(needed: boolean): void;
}

// Decides what to tell the 법당's embedded player, which plays only while the visitor is inside the 법당. A phone ignores the
// player's volume and mute, so the only way to silence it is to pause it. It knows nothing about the DOM: time arrives
// through the two clocks (`now` for local timeouts, `serverNow` for the shared place in the loop).
export class TempleVideoController {
  private current: StageStatus = "idle";
  private openedAt = 0;
  private ready = false;
  private inside = false;
  private gestured = false;
  private volume = 0;
  // Stopped by something other than us; only a gesture, or leaving the 법당 and coming back, starts it again.
  private stalled = false;
  private asked = false;
  private started = false;
  private askedAt = 0;
  private playerMuted: boolean | null = null;
  private duration = 0;
  private time = 0;
  private state = -1;
  private appliedPercent = -1;
  private unmuteAt: number | null = null;
  private tapShown = false;
  private ownPauseUntil = Number.NEGATIVE_INFINITY;
  private lastPauseAt = Number.NEGATIVE_INFINITY;
  private readonly sync: LoopSync;

  constructor(
    private readonly out: TempleVideoOutput,
    private readonly now: () => number,
    serverNow: () => number,
  ) {
    this.sync = new LoopSync(now, serverNow, (to) => out.send("seekTo", [to, true]));
  }

  get status(): StageStatus {
    return this.current;
  }

  // The player has confirmed that it plays; the screen is kept awake for as long as this holds.
  get playing(): boolean {
    return this.asked && this.started;
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
    if (this.asked && this.state === PLAYING) this.sync.follow(this.time, this.duration);
    if (this.playing && this.playerMuted === false) this.setTap(false);
  }

  tick(): void {
    const now = this.now();
    if (this.current === "loading" && !this.ready && now - this.openedAt >= READY_TIMEOUT_MS) {
      this.block({ kind: "timeout" });
      return;
    }
    if (this.current !== "loading" && this.current !== "ready") return;
    // Not playing a few seconds after asking: the browser wants a tap on the player itself. Nothing is asked again.
    if (this.asked && !this.started && now - this.askedAt >= START_TIMEOUT_MS) this.setTap(true);
    // Playing but still muted a second after asking: the same tap lets the sound out, and asking again is what lets it through.
    if (this.playing && this.playerMuted === true && this.unmuteAt !== null && now - this.unmuteAt >= UNMUTE_CHECK_MS) {
      this.setTap(true);
      this.out.send("unMute");
      this.unmuteAt = now;
    }
  }

  // Whether the visitor is inside the 법당, the doorway included.
  setInside(inside: boolean): void {
    if (inside === this.inside) return;
    this.inside = inside;
    if (!inside) this.stalled = false;
    this.update();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
    this.update();
  }

  // The browser lets sound out only after a gesture, and a video it stopped may be played again by the next one.
  userGesture(): void {
    this.gestured = true;
    this.stalled = false;
    this.update();
  }

  private reset(): void {
    this.ready = false;
    this.stalled = false;
    this.asked = false;
    this.started = false;
    this.playerMuted = null;
    this.duration = 0;
    this.time = 0;
    this.state = -1;
    this.appliedPercent = -1;
    this.unmuteAt = null;
    this.ownPauseUntil = Number.NEGATIVE_INFINITY;
    this.lastPauseAt = Number.NEGATIVE_INFINITY;
    this.sync.reset();
    this.setTap(false);
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.setStatus("ready");
    this.update();
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

  // Plays while inside, after a gesture, with the ambient volume up; the moment any of that stops holding, it is paused.
  private update(): void {
    const want = this.ready && this.inside && this.gestured && this.volume > 0 && !this.stalled;
    if (want && !this.asked) this.begin();
    else if (!want && this.asked) this.halt();
    else if (want) this.applyVolume(false);
  }

  private begin(): void {
    this.asked = true;
    this.started = false;
    this.askedAt = this.now();
    this.applyVolume(true);
    this.sync.recheck();
    this.sync.jump(this.duration);
    this.out.send("playVideo");
  }

  private halt(): void {
    this.asked = false;
    this.started = false;
    this.unmuteAt = null;
    this.setTap(false);
    this.pause();
  }

  private stall(): void {
    this.stalled = true;
    this.asked = false;
    this.started = false;
    this.unmuteAt = null;
    this.setTap(false);
  }

  private pause(): void {
    const now = this.now();
    this.lastPauseAt = now;
    this.ownPauseUntil = now + OWN_PAUSE_MS;
    this.out.send("pauseVideo");
  }

  private applyVolume(force: boolean): void {
    const percent = Math.round(this.volume * 100);
    if (percent === this.appliedPercent && !force) return;
    this.appliedPercent = percent;
    this.out.send("setVolume", [percent]);
    if (!force) return;
    this.out.send("unMute");
    this.unmuteAt = this.now();
  }

  private onState(state: number): void {
    this.state = state;
    if (state === PLAYING) {
      if (this.asked) this.started = true;
      else if (this.now() - this.lastPauseAt >= PAUSE_GAP_MS) this.pause();
    } else if (state === ENDED && this.asked) {
      this.sync.jump(this.duration);
      this.out.send("playVideo");
    } else if (state === PAUSED && this.started && this.now() >= this.ownPauseUntil) {
      this.stall();
    }
  }

  private setTap(needed: boolean): void {
    if (needed === this.tapShown) return;
    this.tapShown = needed;
    this.out.tapNeeded(needed);
  }
}
