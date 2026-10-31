// The sparse raindrops over the indoor rain bed: when they fall and how each one sounds, apart from any audio graph.
export const RAIN_DROP_MEAN_GAP_SECONDS = 1.3;
export const RAIN_DROP_MIN_GAP_SECONDS = 0.15;
export const RAIN_DROP_SECONDS = 0.025;
export const RAIN_DROP_MIN_HZ = 2500;
export const RAIN_DROP_MAX_HZ = 5000;
// Peaks scale a band-passed slice of the low-heavy engine noise, which is far quieter than the slice itself.
export const RAIN_DROP_MIN_PEAK = 2.4;
export const RAIN_DROP_MAX_PEAK = 4.8;
export const RAIN_DROP_Q = 2;
// Drops are scheduled this far ahead, by a timer that fires every RAIN_DROP_TICK_MS and only while the rain is above RAIN_AUDIBLE_LEVEL.
export const RAIN_DROP_AHEAD_SECONDS = 0.6;
export const RAIN_DROP_TICK_MS = 250;
export const RAIN_AUDIBLE_LEVEL = 0.01;

export interface RainDrop {
  at: number;
  hz: number;
  peak: number;
  // Where in the shared noise buffer the burst is cut from, 0 to 1.
  from: number;
}

export type Random = () => number;

// Exponentially spread gaps (a drop is as likely at any moment as any other) that never run closer than the minimum; the mean is exact.
export function dropGap(random: Random): number {
  const wait = -Math.log(1 - Math.min(random(), 1 - 1e-9));
  return RAIN_DROP_MIN_GAP_SECONDS + (RAIN_DROP_MEAN_GAP_SECONDS - RAIN_DROP_MIN_GAP_SECONDS) * wait;
}

export function makeDrop(at: number, random: Random): RainDrop {
  return {
    at,
    hz: RAIN_DROP_MIN_HZ * (RAIN_DROP_MAX_HZ / RAIN_DROP_MIN_HZ) ** random(),
    peak: RAIN_DROP_MIN_PEAK + (RAIN_DROP_MAX_PEAK - RAIN_DROP_MIN_PEAK) * random(),
    from: random(),
  };
}

export class DropPlanner {
  private next = Number.NEGATIVE_INFINITY;

  // The drops that fall before `now` plus the look-ahead and were not handed out yet. After a stall (a background tab, a
  // pause, a rain that was switched off) the schedule starts afresh from `now`, so no backlog of drops lands in one go.
  plan(now: number, random: Random): RainDrop[] {
    if (!(this.next >= now)) this.next = now + dropGap(random);
    const drops: RainDrop[] = [];
    while (this.next < now + RAIN_DROP_AHEAD_SECONDS) {
      drops.push(makeDrop(this.next, random));
      this.next += dropGap(random);
    }
    return drops;
  }
}
