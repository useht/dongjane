// A world is one place walked on foot, in game metres (Y up, +z toward the viewer), and it has two zones. Gatbawi is
// the open plaza on the mountainside, and the dharma room is the 법당 beside it, entered through its door from the
// court in front. A visitor is in the zone their feet are in (zoneAt in walk.ts), and the monks of the other one are
// out of sight.
export const ZONES = ["gatbawi", "dharma"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_NAMES: Readonly<Record<Zone, string>> = { gatbawi: "갓바위", dharma: "법당" };
export const SEAT_NAMES: Readonly<Record<Zone, string>> = { gatbawi: "돗자리", dharma: "방석" };

export function isZone(value: unknown): value is Zone {
  return value === "gatbawi" || value === "dharma";
}

// Gatbawi sits on a granite platform at the far end (-z); the plaza where the visitors kneel runs
// toward +z. Visitors stay on the plaza, so the stone steps and the platform are never walked on.
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

// The room is 20 m wide and 18 m deep, so its front wall is at 9 m and the granite porch runs out to 9.9 m from the
// middle (DHARMA_SHELL.porchZ). What a visitor can walk on is the floor between the walls and the altar's step, in the room frame.
export const DHARMA_PORCH_Z = 9.9;
export const DHARMA_ROOM: Bounds = { minX: -9.2, maxX: 9.2, minZ: -4.8, maxZ: 8.4 };
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

// Everyone arrives at the back of the plaza and walks from there, whichever zone they end up in.
export const ARRIVAL: Spawn = { x: 0, z: 14, spread: 4 };

// Every mat faces -z, toward Gatbawi, which is yaw 0 in yawFromDirection's convention. Every 방석 faces the altar on
// the room's back wall, which the quarter turn has put on the -x side: yaw DHARMA_YAW.
export const SEAT_YAWS: Readonly<Record<Zone, number>> = { gatbawi: 0, dharma: DHARMA_YAW };
export const GATBAWI_SEAT_SIZE = { x: 1, z: 1.2 } as const;
// How high a kneeling monk sits above the ground on a 돗자리; a 방석 is higher, and the monk's own rig says how much.
export const GATBAWI_SEAT_TOP = 0.03;
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
export const ZONE_SEATS: Readonly<Record<Zone, readonly SeatSpot[]>> = { gatbawi: GATBAWI_SEATS, dharma: DHARMA_SEATS };

// Each zone seats fifty, so a world of a hundred visitors has a place for everyone when they spread out evenly.
export const SEAT_COUNT = GATBAWI_SEATS.length;

export function seatSpot(zone: Zone, id: number): SeatSpot | undefined {
  return Number.isInteger(id) ? ZONE_SEATS[zone][id] : undefined;
}

export function seatKey(zone: Zone, id: number): string {
  return `${zone}:${id}`;
}

// Where a visitor sits when nobody chose for them: the front row, then closest to the middle, then the lowest number.
export function pickSeat(zone: Zone, taken: (id: number) => boolean): SeatSpot | undefined {
  let best: SeatSpot | undefined;
  for (const spot of ZONE_SEATS[zone]) {
    if (taken(spot.id)) continue;
    if (!best || compareSeats(zone, spot, best) < 0) best = spot;
  }
  return best;
}

// How far back a seat is from what the zone faces, and how far it is to the side of the middle line: Gatbawi's rows run
// along z and its middle is x = 0; the room's rows run along x (the altar is on its -x side) and its aisle is z = DHARMA_ORIGIN.z.
export const SEAT_DEPTH: Readonly<Record<Zone, (spot: SeatSpot) => number>> = { gatbawi: (spot) => spot.z, dharma: (spot) => spot.x };
const SEAT_OFFSET: Readonly<Record<Zone, (spot: SeatSpot) => number>> = {
  gatbawi: (spot) => Math.abs(spot.x),
  dharma: (spot) => Math.abs(spot.z - DHARMA_ORIGIN.z),
};

function compareSeats(zone: Zone, a: SeatSpot, b: SeatSpot): number {
  return (
    SEAT_DEPTH[zone](a) - SEAT_DEPTH[zone](b) || round(SEAT_OFFSET[zone](a)) - round(SEAT_OFFSET[zone](b)) || a.id - b.id
  );
}

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
