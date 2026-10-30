import { ROULETTE_POCKETS } from "@dongjane/shared";
import { easeOut } from "./reels.ts";

// The pockets round the wheel, clockwise from zero: the single-zero wheel's own order, which alternates red and black.
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const WHEEL_STEP = (Math.PI * 2) / ROULETTE_POCKETS;
export const WHEEL_SPIN_MS = 2200;
const TURN = Math.PI * 2;

function wrap(angle: number): number {
  return ((angle % TURN) + TURN) % TURN;
}

export function pocketIndex(pocket: number): number {
  return WHEEL_ORDER.indexOf(pocket);
}

// The wheel is turned `rotation` radians clockwise from rest, which has zero under the pointer at the top. The pocket at `index`
// sits at `index * WHEEL_STEP + rotation` clockwise from the top.
export function pocketAtPointer(rotation: number): number {
  const index = Math.round(wrap(-rotation) / WHEEL_STEP) % ROULETTE_POCKETS;
  return WHEEL_ORDER[index] as number;
}

// The rotation that has `pocket` under the pointer, at least `turns` full turns clockwise from `current`.
export function landingRotation(current: number, pocket: number, turns: number): number {
  const target = wrap(-pocketIndex(pocket) * WHEEL_STEP);
  return current + Math.max(0, turns) * TURN + wrap(target - current);
}

export function wheelRotation(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  return from + (to - from) * easeOut(elapsedMs / durationMs, 3);
}

export interface BallPlace {
  // Clockwise from the top, in the table's frame (not the wheel's).
  angle: number;
  // 1 on the outer track, 0 at the pocket ring.
  drop: number;
}

// The ball runs the other way round the track, then drops into the pocket under the pointer in the last quarter of the spin.
export function ballAt(elapsedMs: number, durationMs: number): BallPlace {
  if (durationMs <= 0 || elapsedMs >= durationMs) return { angle: 0, drop: 0 };
  const t = elapsedMs / durationMs;
  return { angle: -wrap(TURN * 4 * easeOut(t, 2)), drop: t < 0.75 ? 1 : 1 - easeOut((t - 0.75) / 0.25, 2) };
}
