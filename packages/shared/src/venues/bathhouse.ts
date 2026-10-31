import type { Bounds, SeatSpot } from "../layout.ts";
import { yawFromDirection } from "../layout.ts";
import { AVENUE } from "./street.ts";
import { DOOR_WIDTH, SLOT_A1, WALL, inSlot } from "./slots.ts";
import { type ActivitySpot, defineVenue } from "./types.ts";

// 목욕탕 (slot A1, 14 × 14): a pool on the west half and a 찜질 rest room with mats on the east half, behind one door on the
// avenue side. The walls are only drawn: the rooms are inset by their thickness, and the door is a narrow area through the
// north wall. The pool water is not walkable, so the ground around it is a ring of rectangles. Measured in metres from the
// slot's middle (u east, v south): the shell is ±7, the rooms ±6.6.
const HALF = 7 - WALL;
const POOL = inSlot(SLOT_A1, -5.5, -3.4, -0.5, 5.6);
const LANE_WIDTH = 1.25;
const LANES = 4;

// The rooms by name; the venue lists them in this order, and the rest room is the last.
export const BATHHOUSE_ROOMS = {
  apron: { ...inSlot(SLOT_A1, -3, 0, 3, 0), minZ: AVENUE.maxZ, maxZ: SLOT_A1.minZ },
  door: inSlot(SLOT_A1, -DOOR_WIDTH / 2, -7, DOOR_WIDTH / 2, -HALF),
  entry: inSlot(SLOT_A1, -HALF, -HALF, HALF, -3.4),
  westDeck: inSlot(SLOT_A1, -HALF, -3.4, -5.5, HALF),
  southDeck: inSlot(SLOT_A1, -5.5, 5.6, -0.5, HALF),
  restRoom: inSlot(SLOT_A1, -0.5, -3.4, HALF, HALF),
} as const satisfies Record<string, Bounds>;

export const BATHHOUSE_POOL: Bounds = POOL;
export const BATHHOUSE_AREAS: readonly Bounds[] = Object.values(BATHHOUSE_ROOMS);

const round = (value: number): number => Math.round(value * 100) / 100;

// Five rows of eight mats in the rest room, the first row nearest the pool, all facing it (-x).
const MAT_ROWS_X = [0.9, 2.1, 3.3, 4.5, 5.7] as const;
const MAT_COLUMNS = 8;
const MAT_PITCH = 1.1;
const MIDDLE_Z = (SLOT_A1.minZ + SLOT_A1.maxZ) / 2 + 1.6;
export const BATHHOUSE_MATS: readonly SeatSpot[] = MAT_ROWS_X.flatMap((u, row) =>
  Array.from({ length: MAT_COLUMNS }, (_, column) => ({
    id: row * MAT_COLUMNS + column,
    x: round((SLOT_A1.minX + SLOT_A1.maxX) / 2 + u),
    z: round(MIDDLE_Z + (column - (MAT_COLUMNS - 1) / 2) * MAT_PITCH),
    row,
    column,
  })),
);

// A swimmer enters a lane from the deck at its north end and swims south along it.
export const BATHHOUSE_LANES: readonly ActivitySpot[] = Array.from({ length: LANES }, (_, lane) => {
  const x = POOL.minX + LANE_WIDTH * (lane + 0.5);
  return { id: `swim-${lane}`, kind: "swim", x, z: POOL.minZ + 1, yaw: yawFromDirection(0, 1), frontX: x, frontZ: POOL.minZ - 0.3 };
});

export const BATHHOUSE_VENUE = defineVenue({
  id: "bathhouse",
  name: "목욕탕",
  footprint: SLOT_A1,
  areas: BATHHOUSE_AREAS,
  links: ["street"],
  seats: {
    name: "찜질 매트",
    spots: BATHHOUSE_MATS,
    yaw: yawFromDirection(-1, 0),
    // The rows run along x from the pool, and the middle of a row is the rest room's middle line.
    depth: (spot) => spot.x,
    offset: (spot) => Math.abs(spot.z - MIDDLE_Z),
    top: 0.08,
    pose: "cross",
  },
  activities: BATHHOUSE_LANES,
  npc: { stroll: false, seatWeight: 0 },
  indoor: true,
  quests: false,
});
