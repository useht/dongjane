export interface ChantLike {
  startsAt: number;
  durationMs: number;
}

const JOIN_GRACE_MS = 5000;
const LATE_MS = 12000;

// Decides when the temple bell rings. A chant rings once, and only if this session saw it coming
// (or joined within a few seconds of its start), so someone arriving mid-chant is not startled.
export class ChantBellScheduler {
  private readonly seenAhead = new Set<number>();
  private readonly rung = new Set<number>();

  observe(chant: ChantLike, now: number): void {
    if (chant.startsAt <= 0) return;
    if (now < chant.startsAt) this.seenAhead.add(chant.startsAt);
  }

  shouldRing(chant: ChantLike, now: number): boolean {
    const start = chant.startsAt;
    if (start <= 0 || this.rung.has(start)) return false;
    if (now < start || now >= start + LATE_MS) return false;
    const welcome = this.seenAhead.has(start) || now - start < JOIN_GRACE_MS;
    if (!welcome) return false;
    this.rung.add(start);
    return true;
  }
}
