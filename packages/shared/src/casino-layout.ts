import { type Bounds, SHORE, yawFromDirection } from "./layout.ts";

// The casino stands far to the south of the 법당 and the plaza: a visitor walks out past the shore, down the coast road
// and across a yard to the door, and inside follows one aisle between two rows of machines. The walk model cannot carve
// holes, so the machines stand in the bays on either side of the aisle, outside every walkable rectangle, with their
// fronts toward it. All land stays west of x = 16.5; the sea begins at x = 17.5.
export const COAST_ROAD: Bounds = { minX: 13, maxX: 16.5, minZ: SHORE.maxZ, maxZ: 26 };
export const CASINO_YARD: Bounds = { minX: 10, maxX: 16.5, minZ: 26, maxZ: 38 };
// The doorway through the casino's front wall, 2.8 m wide, in line with the middle of the aisle.
export const CASINO_DOOR: Bounds = { minX: 9.85, maxX: 12.65, minZ: 38, maxZ: 40 };
export const CASINO_FLOOR: Bounds = { minX: 8.5, maxX: 14, minZ: 40, maxZ: 54 };

const EDGE = 1e-5;

export function insideCasino(x: number, z: number): boolean {
  return x >= CASINO_FLOOR.minX - EDGE && x <= CASINO_FLOOR.maxX + EDGE && z >= CASINO_FLOOR.minZ - EDGE && z <= CASINO_FLOOR.maxZ + EDGE;
}

export const MACHINE_KINDS = ["classic", "fiveReel", "luckySeven", "roulette", "scratch"] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

// `width` runs along the aisle (z) and `depth` away from it (x).
export const MACHINE_SIZE: Readonly<Record<MachineKind, { readonly width: number; readonly depth: number }>> = {
  classic: { width: 1, depth: 0.9 },
  fiveReel: { width: 1.4, depth: 0.9 },
  luckySeven: { width: 1, depth: 0.9 },
  roulette: { width: 2.4, depth: 1.8 },
  scratch: { width: 0.8, depth: 0.7 },
};

// (x, z) is the middle of the machine's footprint; yaw is the way its front faces, as for a monk (yaw 0 faces -z).
// (frontX, frontZ) is the aisle point a visitor stands on to play.
export interface MachineSpot {
  readonly id: string;
  readonly kind: MachineKind;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly frontX: number;
  readonly frontZ: number;
}

const FACE_EAST = yawFromDirection(1, 0);
const FACE_WEST = yawFromDirection(-1, 0);
const WEST_FRONT_X = 9;
const EAST_FRONT_X = 13.5;

const west = (id: string, kind: MachineKind, x: number, z: number): MachineSpot => ({ id, kind, x, z, yaw: FACE_EAST, frontX: WEST_FRONT_X, frontZ: z });
const east = (id: string, kind: MachineKind, x: number, z: number): MachineSpot => ({ id, kind, x, z, yaw: FACE_WEST, frontX: EAST_FRONT_X, frontZ: z });

// The west bay (x 6.5..8.3) faces east and the east bay (x 14.2..16.0) faces west; each front stands 0.2 m off the aisle.
export const MACHINE_SPOTS: readonly MachineSpot[] = [
  west("classic-1", "classic", 7.85, 42.4),
  west("classic-2", "classic", 7.85, 43.6),
  west("classic-3", "classic", 7.85, 44.8),
  west("fiveReel-1", "fiveReel", 7.85, 46.5),
  west("fiveReel-2", "fiveReel", 7.85, 48.1),
  west("roulette-1", "roulette", 7.4, 51),
  east("luckySeven-1", "luckySeven", 14.65, 42.4),
  east("luckySeven-2", "luckySeven", 14.65, 43.6),
  east("scratch-1", "scratch", 14.55, 45.6),
  east("scratch-2", "scratch", 14.55, 46.6),
  east("scratch-3", "scratch", 14.55, 47.6),
  east("roulette-2", "roulette", 15.1, 51),
];

export function machineSpot(id: string): MachineSpot | undefined {
  return MACHINE_SPOTS.find((spot) => spot.id === id);
}

export function machineFootprint(spot: MachineSpot): Bounds {
  const { width, depth } = MACHINE_SIZE[spot.kind];
  return { minX: spot.x - depth / 2, maxX: spot.x + depth / 2, minZ: spot.z - width / 2, maxZ: spot.z + width / 2 };
}

// How far from a machine's front point a visitor may stand and still play it.
export const MACHINE_REACH = 0.9;

export function machineNear(x: number, z: number): MachineSpot | undefined {
  let best: MachineSpot | undefined;
  let bestDistance = MACHINE_REACH;
  for (const spot of MACHINE_SPOTS) {
    const distance = Math.hypot(spot.frontX - x, spot.frontZ - z);
    if (distance <= bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}
