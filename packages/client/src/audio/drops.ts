// The single drops over an ambient bed (rain on the ground, crackle in a fire, drips in a bath): when they fall and how each one
// sounds, apart from any audio graph.
export interface DropProfile {
  // seconds between drops, exponentially spread; no two ever fall closer than the minimum, and the mean is exact
  meanGap: number;
  minGap: number;
  // how long one drop rings
  seconds: number;
  minHz: number;
  maxHz: number;
  // Peaks scale a band-passed slice of the low-heavy engine noise, which is far quieter than the slice itself.
  minPeak: number;
  maxPeak: number;
  q: number;
}

export const RAIN_DROP_MEAN_GAP_SECONDS = 1.3;
export const RAIN_DROP_MIN_GAP_SECONDS = 0.15;
export const RAIN_DROP_SECONDS = 0.025;
export const RAIN_DROP_MIN_HZ = 2500;
export const RAIN_DROP_MAX_HZ = 5000;
export const RAIN_DROP_MIN_PEAK = 2.4;
export const RAIN_DROP_MAX_PEAK = 4.8;
export const RAIN_DROP_Q = 2;

export const RAIN_DROPS: DropProfile = {
  meanGap: RAIN_DROP_MEAN_GAP_SECONDS,
  minGap: RAIN_DROP_MIN_GAP_SECONDS,
  seconds: RAIN_DROP_SECONDS,
  minHz: RAIN_DROP_MIN_HZ,
  maxHz: RAIN_DROP_MAX_HZ,
  minPeak: RAIN_DROP_MIN_PEAK,
  maxPeak: RAIN_DROP_MAX_PEAK,
  q: RAIN_DROP_Q,
};

// Dry wood popping in a fire: close, short and mid-high.
export const FIRE_DROPS: DropProfile = {
  meanGap: 0.1,
  minGap: 0.012,
  seconds: 0.014,
  minHz: 900,
  maxHz: 4200,
  minPeak: 3,
  maxPeak: 9,
  q: 1.2,
};

// A drip into still water: far apart, higher and narrower, with a longer ring.
export const WATER_DROPS: DropProfile = {
  meanGap: 1.8,
  minGap: 0.35,
  seconds: 0.14,
  minHz: 1400,
  maxHz: 3400,
  minPeak: 8,
  maxPeak: 16,
  q: 9,
};

// Drops are scheduled this far ahead, by a timer that fires every DROP_TICK_MS and only while the bed is above DROP_AUDIBLE_LEVEL.
export const DROP_AHEAD_SECONDS = 0.6;
export const DROP_TICK_MS = 250;
export const DROP_AUDIBLE_LEVEL = 0.01;

export interface Drop {
  at: number;
  hz: number;
  peak: number;
  // Where in the shared noise buffer the burst is cut from, 0 to 1.
  from: number;
}

export type Random = () => number;

export function dropGap(random: Random, profile: DropProfile): number {
  const wait = -Math.log(1 - Math.min(random(), 1 - 1e-9));
  return profile.minGap + (profile.meanGap - profile.minGap) * wait;
}

export function makeDrop(at: number, random: Random, profile: DropProfile): Drop {
  return {
    at,
    hz: profile.minHz * (profile.maxHz / profile.minHz) ** random(),
    peak: profile.minPeak + (profile.maxPeak - profile.minPeak) * random(),
    from: random(),
  };
}

export class DropPlanner {
  private next = Number.NEGATIVE_INFINITY;

  constructor(private readonly profile: DropProfile) {}

  // The drops that fall before `now` plus the look-ahead and were not handed out yet. After a stall (a background tab, a
  // pause, a bed that was switched off) the schedule starts afresh from `now`, so no backlog of drops lands in one go.
  plan(now: number, random: Random): Drop[] {
    if (!(this.next >= now)) this.next = now + dropGap(random, this.profile);
    const drops: Drop[] = [];
    while (this.next < now + DROP_AHEAD_SECONDS) {
      drops.push(makeDrop(this.next, random, this.profile));
      this.next += dropGap(random, this.profile);
    }
    return drops;
  }
}
