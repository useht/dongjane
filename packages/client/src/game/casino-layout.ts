// Plain numbers about the casino's building: its walls, the paving of the coast road and the yard, the flat pad the compound
// stands on, the columns and the lamps. Pure data and arithmetic: the Blender build reads it through scripts/asset-inputs.ts and
// the runtime and its tests read the same file, so the model and the game cannot drift apart. What can be walked on
// (the road, the yard, the door, the aisle) is the shared `casino-layout.ts`; this file only dresses it.
// Metres, the game's frame: Y up, +Z toward the viewer. The front of the building faces -z, toward the plaza.

import { CASINO_DOOR, CASINO_YARD, COAST_ROAD, type Bounds } from "@dongjane/shared";

// The building's outer faces and the thickness of its walls. The aisle (CASINO_FLOOR) is only the walkable middle: the machines
// stand in the bays on either side of it, so the walls stand round the bays, x 6.2..16.3 inside.
export const CASINO_SHELL = {
  minX: 5.8,
  maxX: 16.7,
  minZ: 38.6,
  maxZ: 54.8,
  wall: 0.4,
  // The underside of the coffered ceiling, and the top of the walls and the roof slab.
  ceilingY: 4.7,
  topY: 5.3,
  parapet: 0.45,
  doorHeight: 3.3,
} as const;

// The sign tower that stands on the front wall above the roof: the board's frame, then the little tiled eave over it.
export const CASINO_SIGN = { halfWidth: 3.5, bottom: 5.8, height: 2.4, tower: 3.4, eave: 0.7 } as const;

// The tallest point of the front wall: the top of the eave over the sign.
export const CASINO_TOP = CASINO_SHELL.topY + CASINO_SIGN.tower + CASINO_SIGN.eave;

// The room inside the walls.
export const CASINO_ROOM: Bounds = {
  minX: CASINO_SHELL.minX + CASINO_SHELL.wall,
  maxX: CASINO_SHELL.maxX - CASINO_SHELL.wall,
  minZ: CASINO_SHELL.minZ + CASINO_SHELL.wall,
  maxZ: CASINO_SHELL.maxZ - CASINO_SHELL.wall,
};

// The paving runs this far past the walkable edge of the road and the yard.
export const PAVING_MARGIN = 0.4;
// It lies a little above the pad (and above the sand beside the shore, which is SAND_Y high).
export const PAVING_Y = 0.035;
export const FLOOR_Y = 0.02;

function grown(box: Bounds, margin: Partial<Record<keyof Bounds, number>>): Bounds {
  return {
    minX: box.minX - (margin.minX ?? 0),
    maxX: box.maxX + (margin.maxX ?? 0),
    minZ: box.minZ - (margin.minZ ?? 0),
    maxZ: box.maxZ + (margin.maxZ ?? 0),
  };
}

// The road starts just inside the shore's sand and ends where the yard begins; the yard ends at the front wall.
export const CASINO_PAVING = {
  road: grown(COAST_ROAD, { minX: PAVING_MARGIN, maxX: PAVING_MARGIN, minZ: 0.2 }),
  yard: grown({ ...CASINO_YARD, maxZ: CASINO_SHELL.minZ }, { minX: PAVING_MARGIN, maxX: PAVING_MARGIN }),
  // The doorsill: stone through the thickness of the front wall, as wide as the door.
  sill: { minX: CASINO_DOOR.minX, maxX: CASINO_DOOR.maxX, minZ: CASINO_SHELL.minZ, maxZ: CASINO_ROOM.minZ },
} as const;

// The compound stands on a level pad pressed into the hillside: PAD.y is the height the sand lies at less the ground under it
// (SAND_Y - GROUND_UNDER in shore.ts), so the road meets the shore with no step. The pad reaches `margin` past the paving and the
// walls and eases up to the hillside over `blend` metres.
export const CASINO_PAD = {
  y: -0.04,
  margin: 0.8,
  blend: 6,
  boxes: [CASINO_PAVING.road, CASINO_PAVING.yard, { minX: CASINO_SHELL.minX, maxX: CASINO_SHELL.maxX, minZ: CASINO_SHELL.minZ, maxZ: CASINO_SHELL.maxZ }] as readonly Bounds[],
} as const;

// The two gold columns, each in the gap between machines of its bay.
export const CASINO_COLUMNS: readonly { readonly x: number; readonly z: number; readonly radius: number }[] = [
  { x: 7.4, z: 49.3, radius: 0.28 },
  { x: 15.1, z: 48.9, radius: 0.28 },
];

// How tall each prototype machine stands, in the order the model draws them: a slot cabinet, a roulette table and a scratch kiosk.
export const MACHINE_HEIGHT = { slot: 1.95, roulette: 0.95, scratch: 1.5 } as const;

// The lamps that light the inside and the front, as [x, y, z]. They stay in the scene all the time (one more or less would
// recompile every material), and are turned up as a visitor comes in or near.
export const CASINO_LAMPS = {
  gold: [
    [11.25, 3.7, 43.5],
    [11.25, 3.7, 50.5],
  ],
  pink: [[8.9, 3.2, 47.5]],
  cyan: [[13.6, 3.2, 47.5]],
  sign: [[11.25, 7.2, 36.6]],
} as const;

export const CASINO_LIGHT = { gold: { intensity: 9, distance: 11 }, neon: { intensity: 6, distance: 7 }, sign: { intensity: 14, distance: 14 }, decay: 2 } as const;

// Where the camera may be while the followed visitor is inside: over the whole room, from just above the floor to well above
// the (hidden) roof, so the cutaway shows the machines from above. The shell, which the camera must not enter from outside,
// reaches from just under the ground to the top of the sign's eave.
export const CASINO_CAMERA_BOUNDS = {
  minX: CASINO_ROOM.minX + 0.1,
  maxX: CASINO_ROOM.maxX - 0.1,
  minY: 0.6,
  maxY: 11,
  minZ: CASINO_ROOM.minZ + 0.2,
  maxZ: CASINO_ROOM.maxZ - 0.2,
} as const;

export const CASINO_KEEP_OUT = {
  minX: CASINO_SHELL.minX,
  maxX: CASINO_SHELL.maxX,
  minY: -1,
  maxY: CASINO_TOP,
  minZ: CASINO_SHELL.minZ,
  maxZ: CASINO_SHELL.maxZ,
} as const;

export function insideBounds(box: Bounds, x: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

// How far (x, z) is from the rectangle: zero on it and inside it.
export function distanceToBounds(box: Bounds, x: number, z: number): number {
  return Math.hypot(Math.max(box.minX - x, 0, x - box.maxX), Math.max(box.minZ - z, 0, z - box.maxZ));
}
