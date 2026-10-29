import { BOW_MS } from "@dongjane/shared";

const DOWN_SHARE = 0.32;
const HOLD_SHARE = 0.58;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// 0 = upright on the cushion, 1 = forehead to the floor. Runs once per server "bow" period.
export function bowDepth(elapsedMs: number, eased: boolean, bowMs: number = BOW_MS): number {
  if (!(elapsedMs > 0) || elapsedMs >= bowMs) return 0;
  const u = elapsedMs / bowMs;
  let depth: number;
  if (u < DOWN_SHARE) depth = u / DOWN_SHARE;
  else if (u < HOLD_SHARE) depth = 1;
  else depth = 1 - (u - HOLD_SHARE) / (1 - HOLD_SHARE);
  return eased ? smooth(depth) : depth;
}

export function approach(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export class PoseBlend {
  kneel = 0;
  walk = 0;

  update(mode: string, dt: number, smoothed: boolean): void {
    const kneelTarget = mode === "kneel" || mode === "bow" ? 1 : 0;
    const walkTarget = mode === "walk" ? 1 : 0;
    if (smoothed) {
      this.kneel = approach(this.kneel, kneelTarget, dt, 9);
      this.walk = approach(this.walk, walkTarget, dt, 12);
    } else {
      this.kneel = kneelTarget;
      this.walk = walkTarget;
    }
  }
}
