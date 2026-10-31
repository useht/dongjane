import type { Bounds, SeatSpot } from "../layout.ts";
import { yawFromDirection } from "../layout.ts";
import { AVENUE } from "./street.ts";
import { SLOT_A1, SLOT_A2, SLOT_B1 } from "./slots.ts";
import { type ActivitySpot, BENCH_HIPS_BACK, defineVenue } from "./types.ts";

// 불멍 (slot B1, 10 × 14, in the open): a clearing in the hillside behind the bathhouse with a fire in a ring of stones and five
// logs round it, four places to a log, every visitor facing the flames. It has no walls and no door. A lane runs down between the
// church and the bathhouse from the avenue and turns into the clearing at its north-west corner; the lane belongs to the venue
// and lies outside its footprint, as an apron does. The fire pit is not walkable, so the ground round it is four rectangles.
const MIDDLE_X = (SLOT_B1.minX + SLOT_B1.maxX) / 2;
const round = (value: number): number => Math.round(value * 100) / 100;

interface Point {
  readonly x: number;
  readonly z: number;
}

// The south edge of the slot is the foot of the hill, where the ground rises too steeply to walk on.
export const BONFIRE_BACK_Z = SLOT_B1.maxZ - 1.5;
export const BONFIRE_FIRE: Point = { x: MIDDLE_X, z: SLOT_B1.minZ + 6.6 };
// Half the side of the pit the fire burns in, which no one walks over.
export const BONFIRE_PIT_HALF = 1;
export const BONFIRE_PIT: Bounds = {
  minX: BONFIRE_FIRE.x - BONFIRE_PIT_HALF,
  maxX: BONFIRE_FIRE.x + BONFIRE_PIT_HALF,
  minZ: BONFIRE_FIRE.z - BONFIRE_PIT_HALF,
  maxZ: BONFIRE_FIRE.z + BONFIRE_PIT_HALF,
};

// The lane runs along the middle of the gap between the church and the bathhouse.
export const BONFIRE_LANE_WIDTH = 3.2;
const LANE_MIDDLE = (SLOT_A2.maxX + SLOT_A1.minX) / 2;
const LANE_END = 44;
const TURN_END = 46.4;
// Where the lane meets the clearing.
export const BONFIRE_GATE: Point = { x: SLOT_B1.minX, z: (LANE_END + TURN_END) / 2 };

// The rooms by name, in the order the venue lists them. The clearing is cut round the pit into two full-length strips down its
// sides and one short strip on each of its other two sides, so that every place on a log lies well inside one of them.
export const BONFIRE_ROOMS = {
  lane: { minX: LANE_MIDDLE - BONFIRE_LANE_WIDTH / 2, maxX: LANE_MIDDLE + BONFIRE_LANE_WIDTH / 2, minZ: AVENUE.maxZ, maxZ: LANE_END },
  turn: { minX: LANE_MIDDLE - BONFIRE_LANE_WIDTH / 2, maxX: SLOT_B1.minX, minZ: LANE_END, maxZ: TURN_END },
  west: { minX: SLOT_B1.minX, maxX: BONFIRE_PIT.minX, minZ: SLOT_B1.minZ, maxZ: BONFIRE_BACK_Z },
  north: { minX: BONFIRE_PIT.minX, maxX: BONFIRE_PIT.maxX, minZ: SLOT_B1.minZ, maxZ: BONFIRE_PIT.minZ },
  south: { minX: BONFIRE_PIT.minX, maxX: BONFIRE_PIT.maxX, minZ: BONFIRE_PIT.maxZ, maxZ: BONFIRE_BACK_Z },
  east: { minX: BONFIRE_PIT.maxX, maxX: SLOT_B1.maxX, minZ: SLOT_B1.minZ, maxZ: BONFIRE_BACK_Z },
} as const satisfies Record<string, Bounds>;

export const BONFIRE_AREAS: readonly Bounds[] = Object.values(BONFIRE_ROOMS);

// Five logs lie round the fire, each a tangent to the ring a few steps from it, with a gap between them wide enough to walk through;
// the gap between the last and the first faces the lane. A log seats four, a little under a metre apart. A visitor sits with its
// hips on the log and its feet toward the fire, so the log lies a hips' depth farther from the fire than the feet do.
export const BONFIRE_LOG_COUNT = 5;
export const BONFIRE_PLACES = 4;
export const BONFIRE_LOG_REACH = 3.4;
export const BONFIRE_LOG_HALF = 1.65;
export const BONFIRE_PLACE_PITCH = 0.85;

export interface BonfireLog {
  readonly index: number;
  // the ends of the log's axis
  readonly from: Point;
  readonly to: Point;
}

const GAP_ANGLE = Math.atan2(BONFIRE_GATE.z - BONFIRE_FIRE.z, BONFIRE_GATE.x - BONFIRE_FIRE.x);
const angleOf = (log: number): number => GAP_ANGLE + Math.PI / BONFIRE_LOG_COUNT + (log * 2 * Math.PI) / BONFIRE_LOG_COUNT;
// A point `along` a log's axis from its middle, `toward` the fire from the axis.
const onLog = (log: number, along: number, toward = 0): Point => {
  const angle = angleOf(log);
  const reach = BONFIRE_LOG_REACH - toward;
  return {
    x: round(BONFIRE_FIRE.x + Math.cos(angle) * reach - Math.sin(angle) * along),
    z: round(BONFIRE_FIRE.z + Math.sin(angle) * reach + Math.cos(angle) * along),
  };
};

export const BONFIRE_LOGS: readonly BonfireLog[] = Array.from({ length: BONFIRE_LOG_COUNT }, (_, index) => ({
  index,
  from: onLog(index, -BONFIRE_LOG_HALF),
  to: onLog(index, BONFIRE_LOG_HALF),
}));

// The seats are numbered log by log, and along each log in the way the angle grows. A monk sits on the log with its hips on the
// axis and its feet to the fire, so the place is where the feet are: the hips' distance nearer the fire than the axis.
export const BONFIRE_SEATS: readonly SeatSpot[] = BONFIRE_LOGS.flatMap((log) =>
  Array.from({ length: BONFIRE_PLACES }, (_, column) => ({
    id: log.index * BONFIRE_PLACES + column,
    ...onLog(log.index, (column - (BONFIRE_PLACES - 1) / 2) * BONFIRE_PLACE_PITCH, BENCH_HIPS_BACK),
    row: log.index,
    column,
  })),
);

// The fire is tended from its north side, inside the ring of logs.
export const BONFIRE_FIRES: readonly ActivitySpot[] = [
  {
    id: "fire",
    kind: "fire",
    x: BONFIRE_FIRE.x,
    z: BONFIRE_FIRE.z,
    yaw: yawFromDirection(0, 1),
    frontX: BONFIRE_FIRE.x,
    frontZ: round(BONFIRE_FIRE.z - 2),
  },
];

export const BONFIRE_VENUE = defineVenue({
  id: "bonfire",
  name: "불멍",
  footprint: SLOT_B1,
  areas: BONFIRE_AREAS,
  links: ["street"],
  seats: {
    name: "통나무",
    spots: BONFIRE_SEATS,
    // From the lane to the fire; each seat turns to the fire itself.
    yaw: yawFromDirection(BONFIRE_FIRE.x - BONFIRE_GATE.x, BONFIRE_FIRE.z - BONFIRE_GATE.z),
    facing: (spot) => yawFromDirection(BONFIRE_FIRE.x - spot.x, BONFIRE_FIRE.z - spot.z),
    // Nobody sits in front: a visitor nobody chose a place for gets the one nearest the lane.
    depth: (spot) => Math.hypot(spot.x - BONFIRE_GATE.x, spot.z - BONFIRE_GATE.z),
    offset: () => 0,
    top: 0.24,
    pose: "bench",
  },
  activities: BONFIRE_FIRES,
  npc: { stroll: false, seatWeight: 0 },
  indoor: false,
  quests: false,
});
