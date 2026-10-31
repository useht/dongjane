// A world is one place walked on foot, in game metres (Y up, +z toward the viewer). This file holds its geometry: the plaza
// on the mountainside with Gatbawi at its far end, the 법당 beside it, entered through its door from the court in front, the
// shore, and where the seats lie. Which places the world has and how they join up is the venue registry (venues/index.ts).
// Gatbawi sits on a granite platform at the far end (-z); the plaza where the visitors kneel runs toward +z. Visitors start in
// the 법당 and walk out to the plaza, never up the stone steps or onto the platform.
export const GATBAWI_Z = -6;
export const PLATFORM = { minZ: -6.5, maxZ: -4.4, topY: 1.2 } as const;
export const STEPS = { minZ: -4.4, maxZ: -2.2 } as const;
export const PLAZA = { minX: -8.4, maxX: 13.5, minZ: -2.2, maxZ: 15.5 } as const;

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const WORLD_BOUNDS: Bounds = { minX: -7, maxX: 12.5, minZ: -2.4, maxZ: 15.5 };

// East of the plaza the ground runs on as sand down to the sea. SEA_LINE_X is where the water starts (the shore ends there
// and the sea is not walkable); FISHING_REACH is how close to it a visitor must stand to cast a line.
export const SEA_LINE_X = 18.5;
export const FISHING_REACH = 1.6;
export const SHORE: Bounds = { minX: WORLD_BOUNDS.maxX, maxX: SEA_LINE_X, minZ: WORLD_BOUNDS.minZ, maxZ: WORLD_BOUNDS.maxZ };

export function canCastAt(x: number, z: number): boolean {
  return x >= SEA_LINE_X - FISHING_REACH && z >= SHORE.minZ && z <= SHORE.maxZ;
}

// The 법당 stands west of the plaza, its door facing the plaza and Gatbawi (+x). Its room is modelled around its own
// origin, the middle of its floor, with the door in the +z wall and the altar against the -z wall (the "room frame": the
// models, dharma-layout.ts and the Blender scripts all speak it). The world turns that frame a quarter turn
// counter-clockwise seen from above, DHARMA_YAW about the Y axis, so the door lands on the +x side and the altar on the
// -x side. dharmaToWorld and worldToDharma do the same turn exactly, without trig, for positions on the floor.
export const DHARMA_ORIGIN = { x: -19, z: 0 } as const;
export const DHARMA_YAW = Math.PI / 2;

export interface FloorPoint {
  readonly x: number;
  readonly z: number;
}

// Room frame to world: the room's +z (toward its door) becomes +x, its +x becomes -z.
export function dharmaToWorld(x: number, z: number): FloorPoint {
  return { x: DHARMA_ORIGIN.x + z, z: DHARMA_ORIGIN.z - x };
}

export function worldToDharma(x: number, z: number): FloorPoint {
  return { x: DHARMA_ORIGIN.z - z, z: x - DHARMA_ORIGIN.x };
}

// The room is 22 m wide and 18 m deep, so its front wall is at 9 m and the granite porch runs out to 9.9 m from the
// middle (DHARMA_SHELL.porchZ). What a visitor can walk on is the floor between the walls and the altar's step, in the room frame;
// it ends 0.55 m short of the front pillars (their faces are at 8.25) so that nobody stands in one, and the camera behind them is
// never squeezed between a pillar and the wall.
export const DHARMA_PORCH_Z = 9.9;
export const DHARMA_ROOM: Bounds = { minX: -10.2, maxX: 10.2, minZ: -4.8, maxZ: 7.7 };
const roomCorners = [dharmaToWorld(DHARMA_ROOM.minX, DHARMA_ROOM.minZ), dharmaToWorld(DHARMA_ROOM.maxX, DHARMA_ROOM.maxZ)];
export const DHARMA_BOUNDS: Bounds = {
  minX: Math.min(...roomCorners.map((corner) => corner.x)),
  maxX: Math.max(...roomCorners.map((corner) => corner.x)),
  minZ: Math.min(...roomCorners.map((corner) => corner.z)),
  maxZ: Math.max(...roomCorners.map((corner) => corner.z)),
};

export interface Spawn {
  readonly x: number;
  readonly z: number;
  readonly spread: number;
}

// Everyone arrives inside the 법당, on the open floor between the last row of 방석 and the door, and walks from there.
// The spread runs along the room's depth (the world's x), in line with the aisle; nearer the door the camera has no room behind the monk.
const ARRIVAL_SPOT = dharmaToWorld(0, 4.5);
export const ARRIVAL: Spawn = { x: ARRIVAL_SPOT.x, z: ARRIVAL_SPOT.z, spread: 3 };

export const GATBAWI_SEAT_SIZE = { x: 1, z: 1.2 } as const;
// How high a kneeling monk sits above the ground on a 돗자리, and on a 방석, which is higher (the monk's own rig says the
// same, and a client test keeps the two in step).
export const GATBAWI_SEAT_TOP = 0.03;
export const DHARMA_SEAT_TOP = 0.13;
export const DHARMA_SEAT_SIZE = { x: 0.8, z: 0.8 } as const;

export interface SeatSpot {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly row: number;
  readonly column: number;
}

function grid(columnsX: readonly number[], rowsZ: readonly number[]): readonly SeatSpot[] {
  return rowsZ.flatMap((z, row) => columnsX.map((x, column) => ({ id: row * columnsX.length + column, x, z, row, column })));
}

const round = (value: number): number => Math.round(value * 100) / 100;

export const GATBAWI_COLUMNS_X = [-2.4, -1.2, 0, 1.2, 2.4] as const;
export const GATBAWI_ROWS_Z = Array.from({ length: 10 }, (_, row) => round(-1.3 + 1.45 * row));
// The 방석 lie in two blocks of five columns across the room (room-frame x) with an aisle between them, and five rows
// from the altar toward the door (room-frame z), the first row nearest the altar.
const DHARMA_COLUMNS_X: readonly number[] = [-6.65, -5.35, -4.05, -2.75, -1.45, 1.45, 2.75, 4.05, 5.35, 6.65];
const DHARMA_ROWS_Z: readonly number[] = [-2.6, -1.35, -0.1, 1.15, 2.4];

export const GATBAWI_SEATS = grid(GATBAWI_COLUMNS_X, GATBAWI_ROWS_Z);
export const DHARMA_SEATS: readonly SeatSpot[] = grid(DHARMA_COLUMNS_X, DHARMA_ROWS_Z).map((spot) => {
  const world = dharmaToWorld(spot.x, spot.z);
  return { ...spot, x: round(world.x), z: round(world.z) };
});

// Each zone seats fifty, so a world of a hundred visitors has a place for everyone when they spread out evenly.
export const SEAT_COUNT = GATBAWI_SEATS.length;

export function worldName(world: number): string {
  return `${world}번 월드`;
}

export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.floor((angle + Math.PI) / turn);
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * t;
}
