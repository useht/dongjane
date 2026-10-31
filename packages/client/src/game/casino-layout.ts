// Plain numbers about the casino's building: its walls, the paving of the coast road and the yard, the flat pad the compound
// stands on, the columns and the lamps. Pure data and arithmetic: the Blender build reads it through scripts/asset-inputs.ts and
// the runtime and its tests read the same file, so the model and the game cannot drift apart. What can be walked on
// (the road, the yard, the door, the lobby and the aisles) is the shared `casino-layout.ts`; this file only dresses it.
// Metres, the game's frame: Y up, +Z toward the viewer. The front of the building faces -z, toward the plaza.

import {
  AVENUE,
  CASINO_AISLE_EAST,
  CASINO_AISLE_WEST,
  CASINO_CROSS,
  CASINO_DOOR,
  CASINO_LINE_X,
  CASINO_LOBBY,
  CASINO_YARD,
  COAST_ROAD,
  type Bounds,
  type MachineKind,
} from "@dongjane/shared";

// The building's outer faces and the thickness of its walls. The floor inside is the lobby, two aisles and the cross room
// (shared CASINO_AREAS); the rows of machines stand between and beside them, flush with the walls, so the walls stand round
// the machines too: x 6.2..16.6 and z 39.0..67.6 inside. The door is on the centre line x = 14, east of the building's own
// middle, and the east wall stands 0.5 m from the sea.
export const CASINO_SHELL = {
  minX: 5.8,
  maxX: 17,
  minZ: 38.6,
  maxZ: 68,
  wall: 0.4,
  // The underside of the coffered ceiling, and the top of the walls and the roof slab.
  ceilingY: 4.7,
  topY: 5.3,
  parapet: 0.45,
  doorHeight: 3.3,
} as const;

// The sign tower that stands on the front wall above the roof, over the door: the board's frame, `side` of wall either side
// of it, then the little tiled eave over it, which overhangs the tower by `overhang` and never past the shell. `cell` is the
// size of one pixel of the board's lettering.
export const CASINO_SIGN = { halfWidth: 2.5, bottom: 5.8, height: 2.2, tower: 3.4, eave: 0.7, side: 0.25, overhang: 0.25, cell: 0.13 } as const;

// The tallest point of the front wall: the top of the eave over the sign.
export const CASINO_TOP = CASINO_SHELL.topY + CASINO_SIGN.tower + CASINO_SIGN.eave;

// The room inside the walls.
export const CASINO_ROOM: Bounds = {
  minX: CASINO_SHELL.minX + CASINO_SHELL.wall,
  maxX: CASINO_SHELL.maxX - CASINO_SHELL.wall,
  minZ: CASINO_SHELL.minZ + CASINO_SHELL.wall,
  maxZ: CASINO_SHELL.maxZ - CASINO_SHELL.wall,
};

// The two lit windows in the front wall's west pier (the east pier, beside the door, is too narrow for one), at a quarter and
// three quarters of the pier's width.
export const CASINO_WINDOWS = {
  xs: [0.25, 0.75].map((share) => CASINO_SHELL.minX + (CASINO_DOOR.minX - CASINO_SHELL.minX) * share),
  half: 0.8,
  low: 1.2,
  high: 3.2,
} as const;

// The paving runs this far past the walkable edge of the road and the yard.
export const PAVING_MARGIN = 0.4;
// It lies a little above the pad (and above the sand beside the shore, which is SAND_Y high).
export const PAVING_Y = 0.035;
export const FLOOR_Y = 0.02;
// The stone kerb along the paving's edge.
export const KERB_WIDTH = 0.2;

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

// The street lamps' posts, as [x, z]: on the kerbs of the yard's two sides and of the road, clear of everything walkable. The road's
// first post stands just south of the avenue, whose south-east corner the road's kerb runs through.
const POST_MID = KERB_WIDTH / 2;
export const CASINO_POSTS: readonly (readonly [number, number])[] = [
  [CASINO_PAVING.yard.minX + POST_MID, CASINO_SHELL.minZ - 1.8],
  [CASINO_PAVING.yard.maxX - POST_MID, CASINO_SHELL.minZ - 1.8],
  [CASINO_PAVING.road.minX + POST_MID, 24.5],
  [CASINO_PAVING.road.minX + POST_MID, AVENUE.maxZ + 0.5],
  [CASINO_PAVING.road.maxX - POST_MID, 22],
];

// The compound stands on a level pad pressed into the hillside: PAD.y is the height the sand lies at less the ground under it
// (SAND_Y - GROUND_UNDER in shore.ts), so the road meets the shore with no step. The pad reaches `margin` past the paving and the
// walls and eases up to the hillside over `blend` metres, which is long because the hillside behind the building stands high.
export const CASINO_PAD = {
  y: -0.04,
  margin: 0.5,
  blend: 12,
  boxes: [CASINO_PAVING.road, CASINO_PAVING.yard, { minX: CASINO_SHELL.minX, maxX: CASINO_SHELL.maxX, minZ: CASINO_SHELL.minZ, maxZ: CASINO_SHELL.maxZ }] as readonly Bounds[],
} as const;

// The gold columns stand at the corners of the floor's ring, in the strips of carpet between the walls and the lobby and the
// cross room (the machines' rows end before them), each at the middle of its strip and of the lobby's or the cross room's depth.
export const CASINO_COLUMN_RADIUS = 0.26;
export const CASINO_COLUMNS: readonly { readonly x: number; readonly z: number; readonly radius: number }[] = [CASINO_LOBBY, CASINO_CROSS].flatMap((area) =>
  [(CASINO_ROOM.minX + area.minX) / 2, (area.maxX + CASINO_ROOM.maxX) / 2].map((x) => ({ x, z: (area.minZ + area.maxZ) / 2, radius: CASINO_COLUMN_RADIUS })),
);

// How tall each prototype machine stands, in the order the model draws them: a slot cabinet, a roulette table and a scratch kiosk.
export const MACHINE_HEIGHT = { slot: 1.95, roulette: 0.95, scratch: 1.5 } as const;

export function machineHeight(kind: MachineKind): number {
  return kind === "roulette" ? MACHINE_HEIGHT.roulette : kind === "scratch" ? MACHINE_HEIGHT.scratch : MACHINE_HEIGHT.slot;
}

const ROOM_MID_X = (CASINO_ROOM.minX + CASINO_ROOM.maxX) / 2;
const middle = (area: Bounds): number => (area.minX + area.maxX) / 2;

// The lamps that light the inside and the front, as [x, y, z]. They stay in the scene all the time (one more or less would
// recompile every material), and are turned up as a visitor comes in or near. The gold lamps hang over the island, the first
// at the middle of the room, which is the one a weak device keeps; the pink and the cyan hang over the west and the east aisle.
export const CASINO_LAMPS = {
  gold: [
    [ROOM_MID_X, 3.7, 54.5],
    [ROOM_MID_X, 3.7, 44.5],
    [ROOM_MID_X, 3.7, 64.5],
  ],
  pink: [[middle(CASINO_AISLE_WEST), 3.2, 54.5]],
  cyan: [[middle(CASINO_AISLE_EAST), 3.2, 54.5]],
  sign: [[CASINO_LINE_X, 7.2, CASINO_SHELL.minZ - 2]],
} as const;

export const CASINO_LIGHT = { gold: { intensity: 9, distance: 11 }, neon: { intensity: 6, distance: 7 }, sign: { intensity: 36, distance: 16 }, decay: 2 } as const;

// Where the camera may be while the followed visitor is inside: over the whole room, from just above the floor to well above
// the (hidden) roof, so the cutaway shows the machines from above. The shell, which the camera must not enter from outside,
// reaches from just under the ground to over the ridge of the sign's eave, which stands a little above CASINO_TOP.
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
  maxY: CASINO_TOP + 0.3,
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

// How near a visitor must come before the casino lights up for them: all the way within `full` metres of the walls, not at all
// beyond `none`. The lamps stay in the scene all the time; this only turns them up.
export const CASINO_NEAR = { full: 4, none: 26 } as const;

export function casinoNearness(x: number, z: number): number {
  const t = Math.min(1, Math.max(0, (distanceToBounds(CASINO_SHELL, x, z) - CASINO_NEAR.full) / (CASINO_NEAR.none - CASINO_NEAR.full)));
  return 1 - t * t * (3 - 2 * t);
}
