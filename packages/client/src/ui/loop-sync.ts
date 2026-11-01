import { aimAhead, loopPosition } from "../audio/music.ts";

// The player only plays at whole speeds, so drift is cured by jumping, and not more often than this.
const DRIFT_SECONDS = 1;
const RESYNC_MIN_MS = 10_000;
// Closer than this to the loop's place needs no jump at all.
const CLOSE_SECONDS = 0.5;

// Keeps an embedded player at the same place of its looping video as everyone else, by seeking. A live stream has
// no duration and is left alone. `now` is the local clock, `serverNow` the shared one.
export class LoopSync {
  private due = true;
  private lastSeekAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number,
    private readonly serverNow: () => number,
    private readonly seek: (to: number) => void,
  ) {}

  reset(): void {
    this.due = true;
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
  }

  // The next report of a playing video is checked whatever the drift: it may have started anywhere.
  recheck(): void {
    this.due = true;
  }

  jump(duration: number): void {
    if (duration <= 0) return;
    this.due = false;
    this.lastSeekAt = this.now();
    this.seek(aimAhead(loopPosition(this.serverNow(), duration), duration));
  }

  follow(time: number, duration: number): void {
    if (duration <= 0) return;
    const now = this.now();
    const off = Math.abs(time - loopPosition(this.serverNow(), duration));
    const gap = Math.min(off, duration - off);
    if (!this.due && !(gap > DRIFT_SECONDS && now - this.lastSeekAt >= RESYNC_MIN_MS)) return;
    if (gap > CLOSE_SECONDS) {
      this.jump(duration);
    } else {
      this.due = false;
      this.lastSeekAt = now;
    }
  }
}
