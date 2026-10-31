import { type Bounds, SHORE, yawFromDirection } from "./layout.ts";

// The casino stands far to the south of the 법당 and the plaza. The coast road, the yard, the doorway and the lobby all
// sit on one centre line, x = CASINO_LINE_X, so the walk from the shore to the door is a single straight line. Inside, the
// lobby opens onto two aisles that run south between four rows of machines (the outer west row, the two sides of the
// island and the outer east row) and meet again in a cross room, so the floor is a ring and a visitor never has to double
// back. The east aisle lies on the centre line too: the door looks straight down it. The walk model cannot carve holes, so
// every machine stands in its row outside every walkable rectangle, with its front toward an aisle. All land stays west of
// x = 16.5; the sea begins at x = 17.5.
export const CASINO_LINE_X = 14;
export const COAST_ROAD: Bounds = { minX: CASINO_LINE_X - 1.5, maxX: CASINO_LINE_X + 1.5, minZ: SHORE.maxZ, maxZ: 26 };
export const CASINO_YARD: Bounds = { minX: CASINO_LINE_X - 2.5, maxX: CASINO_LINE_X + 2.5, minZ: 26, maxZ: 38 };
// The doorway through the casino's front wall, 2.8 m wide, on the centre line.
export const CASINO_DOOR: Bounds = { minX: CASINO_LINE_X - 1.4, maxX: CASINO_LINE_X + 1.4, minZ: 38, maxZ: 40 };

const AISLE_WIDTH = 3;
const WEST_AISLE_X = 7.3;
const EAST_AISLE_X = CASINO_LINE_X - AISLE_WIDTH / 2;
const AISLE_START_Z = 44;
const AISLE_END_Z = 64.2;
const CROSS_DEPTH = 3;

export const CASINO_LOBBY: Bounds = { minX: WEST_AISLE_X, maxX: EAST_AISLE_X + AISLE_WIDTH, minZ: CASINO_DOOR.maxZ, maxZ: AISLE_START_Z };
export const CASINO_AISLE_WEST: Bounds = { minX: WEST_AISLE_X, maxX: WEST_AISLE_X + AISLE_WIDTH, minZ: AISLE_START_Z, maxZ: AISLE_END_Z };
export const CASINO_AISLE_EAST: Bounds = { minX: EAST_AISLE_X, maxX: EAST_AISLE_X + AISLE_WIDTH, minZ: AISLE_START_Z, maxZ: AISLE_END_Z };
export const CASINO_CROSS: Bounds = { minX: CASINO_LOBBY.minX, maxX: CASINO_LOBBY.maxX, minZ: AISLE_END_Z, maxZ: AISLE_END_Z + CROSS_DEPTH };
// The floor's walkable areas, in the order of the ring: lobby, west aisle, cross room, east aisle.
export const CASINO_AREAS: readonly Bounds[] = [CASINO_LOBBY, CASINO_AISLE_WEST, CASINO_CROSS, CASINO_AISLE_EAST];
// The box round the whole floor. Machines stand inside it, between the aisles, so it is not all walkable.
export const CASINO_FLOOR: Bounds = {
  minX: CASINO_LOBBY.minX,
  maxX: CASINO_LOBBY.maxX,
  minZ: CASINO_LOBBY.minZ,
  maxZ: CASINO_CROSS.maxZ,
};

const EDGE = 1e-5;

export function insideCasino(x: number, z: number): boolean {
  return CASINO_AREAS.some((area) => x >= area.minX - EDGE && x <= area.maxX + EDGE && z >= area.minZ - EDGE && z <= area.maxZ + EDGE);
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

// A machine's face stands this far from the aisle's edge, and the spot a visitor plays from this far inside it.
const FACE_GAP = 0.2;
const FRONT_INSET = 0.5;
// Neighbouring machines keep this much air between their bodies, and their front points at least this far apart.
const BODY_GAP = 0.1;
const FRONT_SPACING = 1;
// The first machine of a row stands this far past the lobby, and the last this far before the cross room.
const END_GAP = 0.35;

// A row of machines along one aisle: which way it faces, and the x its machines' faces stand on.
interface Row {
  readonly yaw: number;
  readonly face: number;
  readonly frontX: number;
}

const OUTER_WEST: Row = { yaw: FACE_EAST, face: CASINO_AISLE_WEST.minX - FACE_GAP, frontX: CASINO_AISLE_WEST.minX + FRONT_INSET };
const ISLAND_WEST: Row = { yaw: FACE_WEST, face: CASINO_AISLE_WEST.maxX + FACE_GAP, frontX: CASINO_AISLE_WEST.maxX - FRONT_INSET };
const ISLAND_EAST: Row = { yaw: FACE_EAST, face: CASINO_AISLE_EAST.minX - FACE_GAP, frontX: CASINO_AISLE_EAST.minX + FRONT_INSET };
const OUTER_EAST: Row = { yaw: FACE_WEST, face: CASINO_AISLE_EAST.maxX + FACE_GAP, frontX: CASINO_AISLE_EAST.maxX - FRONT_INSET };

const KIND_OF: Readonly<Record<string, MachineKind>> = { c: "classic", f: "fiveReel", l: "luckySeven", r: "roulette", s: "scratch" };
const kindsOf = (code: string): MachineKind[] => [...code].map((letter) => KIND_OF[letter] as MachineKind);

const width = (kind: MachineKind): number => MACHINE_SIZE[kind].width;
const pitch = (a: MachineKind, b: MachineKind): number => Math.max(FRONT_SPACING, (width(a) + width(b)) / 2 + BODY_GAP);

// The shortest stretch of aisle a row takes, edge to edge of its first and last bodies.
function packedLength(kinds: readonly MachineKind[]): number {
  let length = (width(kinds[0] as MachineKind) + width(kinds.at(-1) as MachineKind)) / 2;
  for (let i = 1; i < kinds.length; i += 1) length += pitch(kinds[i - 1] as MachineKind, kinds[i] as MachineKind);
  return length;
}

// The z of each machine's middle when the row is spread over `length` metres from `from`, the slack shared out between
// neighbours so the row ends flush with its block.
function spread(kinds: readonly MachineKind[], from: number, length: number): number[] {
  if (kinds.length === 1) return [from + length / 2];
  const slack = Math.max(0, length - packedLength(kinds)) / (kinds.length - 1);
  const zs = [from + width(kinds[0] as MachineKind) / 2];
  for (let i = 1; i < kinds.length; i += 1) {
    zs.push((zs[i - 1] as number) + pitch(kinds[i - 1] as MachineKind, kinds[i] as MachineKind) + slack);
  }
  return zs;
}

// One stretch of the island: a back-to-back pair of rows of machines, or a roulette table that fills the island's whole
// depth and faces one aisle (its back to the other).
interface IslandBlock {
  readonly west?: string;
  readonly east?: string;
}

const OUTER_WEST_ROW = "cclfcclfcclfccsss";
const OUTER_EAST_ROW = "lfccsslfccsslfccs";
const ISLAND_BLOCKS: readonly IslandBlock[] = [
  { west: "cclfcl", east: "lfcclf" },
  { west: "r" },
  { east: "r" },
  { west: "r" },
  { west: "cfc", east: "clc" },
];

const counts = new Map<MachineKind, number>();
const spots: MachineSpot[] = [];

function place(kind: MachineKind, row: Row, z: number): void {
  const n = (counts.get(kind) ?? 0) + 1;
  counts.set(kind, n);
  const { depth } = MACHINE_SIZE[kind];
  // A machine facing east stands west of its face; one facing west, east of it.
  const x = row.yaw === FACE_EAST ? row.face - depth / 2 : row.face + depth / 2;
  spots.push({ id: `${kind}-${n}`, kind, x, z, yaw: row.yaw, frontX: row.frontX, frontZ: z });
}

function layRow(code: string, row: Row, from: number, length: number): void {
  const kinds = kindsOf(code);
  spread(kinds, from, length).forEach((z, i) => place(kinds[i] as MachineKind, row, z));
}

// The island's roulette tables fill its depth, so the tables are placed after the slots in a second pass over the blocks.
const ROWS_FROM = AISLE_START_Z + END_GAP;
const ROWS_TO = AISLE_END_Z - END_GAP;
const blockLengths = ISLAND_BLOCKS.map((block) => Math.max(packedLengthOf(block.west), packedLengthOf(block.east)));
const blockSlack = Math.max(0, ROWS_TO - ROWS_FROM - blockLengths.reduce((sum, length) => sum + length, 0)) / (ISLAND_BLOCKS.length - 1);

function packedLengthOf(code: string | undefined): number {
  return code === undefined ? 0 : packedLength(kindsOf(code));
}

layRow(OUTER_WEST_ROW, OUTER_WEST, ROWS_FROM, ROWS_TO - ROWS_FROM);
{
  let from = ROWS_FROM;
  ISLAND_BLOCKS.forEach((block, index) => {
    const length = blockLengths[index] as number;
    if (block.west !== undefined) layRow(block.west, ISLAND_WEST, from, length);
    if (block.east !== undefined) layRow(block.east, ISLAND_EAST, from, length);
    from += length + blockSlack;
  });
}
layRow(OUTER_EAST_ROW, OUTER_EAST, ROWS_FROM, ROWS_TO - ROWS_FROM);

export const MACHINE_SPOTS: readonly MachineSpot[] = spots;

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
