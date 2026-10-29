// Plain numbers about the 법당 inside: the room, the altar, the candles, the door and the lanterns.
// Pure data and arithmetic: the Blender build reads it through scripts/asset-inputs.ts and the runtime
// and its tests read the same file, so the model and the game cannot drift apart.
// Metres, the game's frame: Y up, +Z toward the viewer. The room has its own origin at the middle of the floor.

import type { Point3 } from "./venue-layout.ts";

export const DHARMA = {
  halfWidth: 10,
  backZ: -9,
  frontZ: 9,
  wallHeight: 6,
  ceilingHeight: 7.5,
  inset: 0.45,
} as const;

// The 수미단 the Buddha sits on, against the back wall.
export const ALTAR = { halfWidth: 4, minZ: -7.9, maxZ: -5.3, topY: 1 } as const;

// The Buddha model is drawn with its lotus throne's bottom 0.45 m below its own origin, so the
// origin stands that far above the altar's top and the lotus rests on it.
export const BUDDHA_AT = { x: 0, y: ALTAR.topY + 0.45, z: -6.6 } as const;

// The closed lattice door in the front wall, which a tap opens back onto the plaza.
export const DHARMA_DOOR = { halfWidth: 1.6, height: 3.4 } as const;

// Candlesticks along the altar's front edge: x and z of each.
export const CANDLE_SPOTS: readonly (readonly [number, number])[] = [
  [-3.4, -5.75],
  [-2.6, -5.75],
  [-1.8, -5.75],
  [1.8, -5.75],
  [2.6, -5.75],
  [3.4, -5.75],
];

// The candle is 0.4 m tall; the flame is drawn this high above the altar's top.
export const FLAME_HEIGHT = 0.56;

// The engaged pillars along the side walls (z) and the front wall (x), clear of the corners listed separately.
export const SIDE_PILLARS_Z: readonly number[] = [-5.7, -2.85, 0, 2.85, 5.7];
export const FRONT_PILLARS_X: readonly number[] = [-5.9, -2.05, 2.05, 5.9];

// Lines of lanterns hang along the room from its ceiling: x of each line, and where they hang along z.
const LANTERN_LINES_X: readonly number[] = [-8.4, -5.6, -2.8, 2.8, 5.6, 8.4];
const LANTERN_COUNT_PER_LINE = 8;

export interface HangingLantern extends Point3 {
  readonly yaw: number;
  readonly scale: number;
  readonly tone: number;
}

function jitter(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

// Every lantern's hook is at (x, y, z); the cord goes up from there to the ceiling.
export function hangingLanterns(): readonly HangingLantern[] {
  const spots: HangingLantern[] = [];
  const first = DHARMA.backZ + 1.6;
  const last = DHARMA.frontZ - 1.6;
  for (const x of LANTERN_LINES_X) {
    for (let k = 0; k < LANTERN_COUNT_PER_LINE; k += 1) {
      const index = spots.length;
      spots.push({
        x,
        y: 5.35 + 0.5 * jitter(index, 1),
        z: first + ((last - first) * k) / (LANTERN_COUNT_PER_LINE - 1),
        yaw: jitter(index, 2) * Math.PI * 2,
        scale: 1.05 + 0.2 * jitter(index, 3),
        tone: jitter(index, 4),
      });
    }
  }
  return spots;
}
