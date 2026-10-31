import type { Bounds, SeatSpot } from "../layout.ts";
import { yawFromDirection } from "../layout.ts";
import { AVENUE } from "./street.ts";
import { DOOR_WIDTH, SLOT_A2, WALL, inSlot } from "./slots.ts";
import { type ActivitySpot, defineVenue } from "./types.ts";

// 교회 (slot A2, 14 × 14): a nave of five rows of pews on each side of a carpeted aisle, an altar on a dais at the far end and
// racks of votive candles in front of it, behind one door on the avenue side. The walls are only drawn: the rooms are inset by
// their thickness, and the door is a narrow area through the north wall. Visitors kneel on the floor of a pew, so each pew is
// a strip of floor that opens onto the aisle, with the bench in front of it left out of the walkable ground. Measured in
// metres from the slot's middle (u east, v south): the shell is ±7, the rooms ±6.6.
const HALF = 7 - WALL;
export const CHURCH_AISLE = 1;
export const CHURCH_PEW_OUT = 5.9;
export const CHURCH_ROWS = 5;
export const CHURCH_SEATS_PER_SIDE = 4;
// A pew is the strip a visitor kneels on and the bench in front of it; the first strip starts clear of the narthex so no strip touches it.
export const CHURCH_STRIP = 0.95;
export const CHURCH_BENCH = 0.45;
const NAVE_START = -4.7;
const NAVE_END = NAVE_START + CHURCH_ROWS * (CHURCH_STRIP + CHURCH_BENCH);
const NARTHEX_END = -5.1;
const CHANCEL_END = 3.7;
export const CHURCH_RACKS_END = 4.2;
export const CHURCH_DAIS_FROM = CHURCH_RACKS_END;

// The rooms by name; the venue lists them in this order, and the pews come after them.
export const CHURCH_ROOMS = {
  apron: { ...inSlot(SLOT_A2, -3, 0, 3, 0), minZ: AVENUE.maxZ, maxZ: SLOT_A2.minZ },
  door: inSlot(SLOT_A2, -DOOR_WIDTH / 2, -7, DOOR_WIDTH / 2, -HALF),
  narthex: inSlot(SLOT_A2, -HALF, -HALF, HALF, NARTHEX_END),
  aisle: inSlot(SLOT_A2, -CHURCH_AISLE, NARTHEX_END, CHURCH_AISLE, NAVE_END),
  chancel: inSlot(SLOT_A2, -HALF, NAVE_END, HALF, CHANCEL_END),
} as const satisfies Record<string, Bounds>;

export interface Pew {
  // 0 is the front pew, nearest the altar
  readonly row: number;
  readonly side: "west" | "east";
  // the strip of floor a visitor kneels on
  readonly strip: Bounds;
  // the bench in front of the strip, which is not walkable
  readonly bench: Bounds;
}

// The first pew is the one nearest the altar.
export const CHURCH_PEWS: readonly Pew[] = Array.from({ length: CHURCH_ROWS }, (_, row) => {
  const start = NAVE_START + (CHURCH_ROWS - 1 - row) * (CHURCH_STRIP + CHURCH_BENCH);
  const stripEnd = start + CHURCH_STRIP;
  const benchEnd = stripEnd + CHURCH_BENCH;
  return (["west", "east"] as const).map((side): Pew => {
    const [from, to] = side === "west" ? [-CHURCH_PEW_OUT, -CHURCH_AISLE] : [CHURCH_AISLE, CHURCH_PEW_OUT];
    return { row, side, strip: inSlot(SLOT_A2, from, start, to, stripEnd), bench: inSlot(SLOT_A2, from, stripEnd, to, benchEnd) };
  });
}).flat();

export const CHURCH_AREAS: readonly Bounds[] = [...Object.values(CHURCH_ROOMS), ...CHURCH_PEWS.map((pew) => pew.strip)];

const round = (value: number): number => Math.round(value * 100) / 100;

// Four places to a side in each strip, the first beside the aisle, all facing the altar (+z).
const KNEEL_START = 1.6;
const KNEEL_PITCH = 1.1;
const MIDDLE_X = (SLOT_A2.minX + SLOT_A2.maxX) / 2;
const MIDDLE_Z = (SLOT_A2.minZ + SLOT_A2.maxZ) / 2;
const FRONT_Z = (CHURCH_PEWS[0] as Pew).strip.minZ + CHURCH_STRIP / 2;

function seatsOf(row: number): SeatSpot[] {
  const z = round(((CHURCH_PEWS[row * 2] as Pew).strip.minZ + (CHURCH_PEWS[row * 2] as Pew).strip.maxZ) / 2);
  return Array.from({ length: CHURCH_SEATS_PER_SIDE * 2 }, (_, column) => {
    const side = column < CHURCH_SEATS_PER_SIDE ? -1 : 1;
    const place = column < CHURCH_SEATS_PER_SIDE ? CHURCH_SEATS_PER_SIDE - 1 - column : column - CHURCH_SEATS_PER_SIDE;
    return { id: row * CHURCH_SEATS_PER_SIDE * 2 + column, x: round(MIDDLE_X + side * (KNEEL_START + place * KNEEL_PITCH)), z, row, column };
  });
}

export const CHURCH_KNEELERS: readonly SeatSpot[] = Array.from({ length: CHURCH_ROWS }, (_, row) => seatsOf(row)).flat();

// Four racks of votive candles stand in front of the dais, two each side of the altar steps; a visitor lights a candle from the chancel.
export const CHURCH_RACK_STEPS = [-5, -3.2, 3.2, 5] as const;
export const CHURCH_RACK_SIZE = { width: 1, depth: 0.45 } as const;
const RACK_Z = round(MIDDLE_Z + CHURCH_RACKS_END - CHURCH_RACK_SIZE.depth / 2);
const FRONT_OF_RACK_Z = round(MIDDLE_Z + (NAVE_END + CHANCEL_END) / 2);

export const CHURCH_CANDLES: readonly ActivitySpot[] = CHURCH_RACK_STEPS.map((u, rack) => ({
  id: `candle-${rack}`,
  kind: "candle",
  x: round(MIDDLE_X + u),
  z: RACK_Z,
  yaw: yawFromDirection(0, -1),
  frontX: round(MIDDLE_X + u),
  frontZ: FRONT_OF_RACK_Z,
}));

export const CHURCH_VENUE = defineVenue({
  id: "church",
  name: "교회",
  footprint: SLOT_A2,
  areas: CHURCH_AREAS,
  links: ["street"],
  seats: {
    name: "기도 자리",
    spots: CHURCH_KNEELERS,
    yaw: yawFromDirection(0, 1),
    // The rows are counted from the front pew, and the middle of a row is the aisle.
    depth: (spot) => FRONT_Z - spot.z,
    offset: (spot) => Math.abs(spot.x - MIDDLE_X),
    top: 0.1,
  },
  activities: CHURCH_CANDLES,
  npc: { stroll: false, seatWeight: 0 },
  indoor: true,
  quests: false,
});
