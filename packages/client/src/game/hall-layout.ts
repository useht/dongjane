import { BUDDHA_Z, HALL_FRONT_Z, HALL_HALF_WIDTH } from "@dongjane/shared";

// Plain numbers about the hall that the runtime and the hall.glb build both need.
export const WALL_X = HALL_HALF_WIDTH;
export const BACK_Z = -7.5;
export const HEIGHT = 6;
export const ALTAR_TOP = 0.62;

export const CANDLE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-3.1, BUDDHA_Z + 0.8],
  [-2.4, BUDDHA_Z + 0.8],
  [-1.7, BUDDHA_Z + 0.8],
  [1.7, BUDDHA_Z + 0.8],
  [2.4, BUDDHA_Z + 0.8],
  [3.1, BUDDHA_Z + 0.8],
];

// The late-afternoon sun shining through the right-hand window; the sunbeams in hall.glb follow
// the line between the two.
export const SUN_POSITION = [14, 8, -2] as const;
export const SUN_TARGET = [0, 0.3, 1.5] as const;

export const HALL_LAYOUT = { WALL_X, BACK_Z, HEIGHT, ALTAR_TOP, CANDLE_SPOTS, SUN_POSITION, SUN_TARGET } as const;

export const HALL_BOUNDS = {
  minX: -HALL_HALF_WIDTH + 0.7,
  maxX: HALL_HALF_WIDTH - 0.7,
  minZ: -6.6,
  maxZ: HALL_FRONT_Z - 0.4,
  maxY: 5.4,
  minY: 0.5,
} as const;
