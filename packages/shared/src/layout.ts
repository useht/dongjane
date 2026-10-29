// A world has two zones, both in game metres (Y up, +z toward the viewer). Gatbawi is the open
// plaza on the mountainside, and the dharma room is the closed room beside it that has its own
// scene. A visitor is always in exactly one zone and sees only the monks who are in it too.
export const ZONES = ["gatbawi", "dharma"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_NAMES: Readonly<Record<Zone, string>> = { gatbawi: "갓바위", dharma: "법당" };
export const SEAT_NAMES: Readonly<Record<Zone, string>> = { gatbawi: "돗자리", dharma: "방석" };

export function isZone(value: unknown): value is Zone {
  return value === "gatbawi" || value === "dharma";
}

export function otherZone(zone: Zone): Zone {
  return zone === "gatbawi" ? "dharma" : "gatbawi";
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
export const DHARMA_BOUNDS: Bounds = { minX: -9.2, maxX: 9.2, minZ: -4.8, maxZ: 8.4 };
export const ZONE_BOUNDS: Readonly<Record<Zone, Bounds>> = { gatbawi: WORLD_BOUNDS, dharma: DHARMA_BOUNDS };

export interface Spawn {
  readonly x: number;
  readonly z: number;
  readonly spread: number;
}

export const ZONE_SPAWN: Readonly<Record<Zone, Spawn>> = {
  gatbawi: { x: 0, z: 14, spread: 4 },
  dharma: { x: 0, z: 7.4, spread: 3 },
};

// Every seat faces -z, toward Gatbawi and toward the Buddha, which is yaw 0 in yawFromDirection's convention.
export const SEAT_YAW = 0;
export const GATBAWI_SEAT_SIZE = { x: 1, z: 1.2 } as const;
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
export const DHARMA_COLUMNS_X = [-6.65, -5.35, -4.05, -2.75, -1.45, 1.45, 2.75, 4.05, 5.35, 6.65] as const;
export const DHARMA_ROWS_Z = [-2.6, -1.35, -0.1, 1.15, 2.4] as const;

export const GATBAWI_SEATS = grid(GATBAWI_COLUMNS_X, GATBAWI_ROWS_Z);
export const DHARMA_SEATS = grid(DHARMA_COLUMNS_X, DHARMA_ROWS_Z);
export const ZONE_SEATS: Readonly<Record<Zone, readonly SeatSpot[]>> = { gatbawi: GATBAWI_SEATS, dharma: DHARMA_SEATS };

// Both zones seat exactly as many as they admit, so a visitor who is not seated always has a free place.
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
    if (!best || compareSeats(spot, best) < 0) best = spot;
  }
  return best;
}

function compareSeats(a: SeatSpot, b: SeatSpot): number {
  return a.z - b.z || Math.abs(a.x) - Math.abs(b.x) || a.id - b.id;
}

export function resolveWalkable(zone: Zone, x: number, z: number): { x: number; z: number } {
  const bounds = ZONE_BOUNDS[zone];
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, z)),
  };
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
