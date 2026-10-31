import type { SeatSpot } from "../layout.ts";
import { BATHHOUSE_VENUE } from "./bathhouse.ts";
import { BONFIRE_VENUE } from "./bonfire.ts";
import { CASINO_VENUE } from "./casino.ts";
import { CHURCH_VENUE } from "./church.ts";
import { DHARMA_VENUE } from "./dharma.ts";
import { GATBAWI_VENUE } from "./gatbawi.ts";
import { SHORE_VENUE } from "./shore.ts";
import { STREET_VENUE } from "./street.ts";
import type { SeatGroup, VenueDef } from "./types.ts";

export type { ActivitySpot, SeatGroup, VenueDef } from "./types.ts";
export { BATHHOUSE_VENUE, BONFIRE_VENUE, CASINO_VENUE, CHURCH_VENUE, DHARMA_VENUE, GATBAWI_VENUE, SHORE_VENUE, STREET_VENUE };
export { BATHHOUSE_AREAS, BATHHOUSE_LANES, BATHHOUSE_MATS, BATHHOUSE_POOL, BATHHOUSE_ROOMS } from "./bathhouse.ts";
export {
  BONFIRE_AREAS,
  BONFIRE_BACK_Z,
  BONFIRE_FIRE,
  BONFIRE_FIRES,
  BONFIRE_GATE,
  BONFIRE_LANE_WIDTH,
  BONFIRE_LOGS,
  BONFIRE_LOG_COUNT,
  BONFIRE_LOG_HALF,
  BONFIRE_LOG_REACH,
  BONFIRE_PIT,
  BONFIRE_PIT_HALF,
  BONFIRE_PLACES,
  BONFIRE_PLACE_PITCH,
  BONFIRE_ROOMS,
  BONFIRE_SEATS,
  type BonfireLog,
} from "./bonfire.ts";
export {
  CHURCH_AISLE,
  CHURCH_AREAS,
  CHURCH_BENCH,
  CHURCH_CANDLES,
  CHURCH_DAIS_FROM,
  CHURCH_KNEELERS,
  CHURCH_PEWS,
  CHURCH_PEW_OUT,
  CHURCH_RACKS_END,
  CHURCH_RACK_SIZE,
  CHURCH_RACK_STEPS,
  CHURCH_ROOMS,
  CHURCH_ROWS,
  CHURCH_SEATS_PER_SIDE,
  CHURCH_STRIP,
  type Pew,
} from "./church.ts";
export { DOOR_WIDTH, SLOT_A1, SLOT_A2, SLOT_B1, WALL as SLOT_WALL, inSlot, slotAt } from "./slots.ts";
export { AVENUE } from "./street.ts";

// Every place in the world, in the order the world lists them. A new venue is a file beside these and a line here: the walk
// graph, the seats, the computer-driven monks and the client's views are all read from this list.
export const VENUES = [GATBAWI_VENUE, DHARMA_VENUE, SHORE_VENUE, CASINO_VENUE, STREET_VENUE, BATHHOUSE_VENUE, CHURCH_VENUE, BONFIRE_VENUE] as const satisfies readonly VenueDef[];
export type VenueId = (typeof VENUES)[number]["id"];

// A zone is a venue with seats. A seat is addressed by its zone (the venue's id) and its number, which is also how the
// protocol names it: the `zone` field of a message and of a seat is a string.
type SeatedVenue = Extract<(typeof VENUES)[number], { readonly seats: SeatGroup }>;
export type Zone = SeatedVenue["id"];

export const SEATED_VENUES: readonly SeatedVenue[] = VENUES.filter((venue: VenueDef): venue is SeatedVenue => venue.seats !== undefined);
export const ZONES: readonly Zone[] = SEATED_VENUES.map((venue) => venue.id);
// The zones the day's quests may name: the ones whose rows are counted from the Buddha.
export const QUEST_ZONES: readonly Zone[] = SEATED_VENUES.filter((venue) => venue.quests).map((venue) => venue.id);

// The open ground: where a walker is when no zone's footprint holds them, and the zone a seat message falls back to.
export const DEFAULT_ZONE: Zone = GATBAWI_VENUE.id;

const BY_ID: ReadonlyMap<string, VenueDef> = new Map(VENUES.map((venue) => [venue.id, venue]));
const ZONE_IDS: ReadonlySet<string> = new Set(ZONES);

export function venueById(id: string): VenueDef | undefined {
  return BY_ID.get(id);
}

export function isZone(value: unknown): value is Zone {
  return typeof value === "string" && ZONE_IDS.has(value);
}

export function perZone<T>(make: (venue: SeatedVenue) => T): Readonly<Record<Zone, T>> {
  return Object.fromEntries(SEATED_VENUES.map((venue) => [venue.id, make(venue)])) as Record<Zone, T>;
}

// The zone tables the rules and the client read, derived from the venues.
export const ZONE_NAMES = perZone((venue) => venue.name);
export const SEAT_NAMES = perZone((venue) => venue.seats.name);
export const ZONE_SEATS: Readonly<Record<Zone, readonly SeatSpot[]>> = perZone((venue) => venue.seats.spots);
export const SEAT_YAWS = perZone((venue) => venue.seats.yaw);
export const SEAT_TOPS = perZone((venue) => venue.seats.top);
// How far back a seat is from what the zone faces: the rows are counted from the front.
export const SEAT_DEPTH: Readonly<Record<Zone, (spot: SeatSpot) => number>> = perZone((venue) => venue.seats.depth);
const SEAT_OFFSET: Readonly<Record<Zone, (spot: SeatSpot) => number>> = perZone((venue) => venue.seats.offset);
const SEAT_FACING: Readonly<Record<Zone, SeatGroup["facing"]>> = perZone((venue) => (venue.seats as SeatGroup).facing);
export const INDOOR = perZone((venue) => venue.indoor);

const round = (value: number): number => Math.round(value * 100) / 100;

export function seatSpot(zone: Zone, id: number): SeatSpot | undefined {
  return Number.isInteger(id) ? ZONE_SEATS[zone][id] : undefined;
}

// The way a monk kneeling on a seat faces: the zone's yaw, unless its seats each look their own way.
export function seatYaw(zone: Zone, id: number): number {
  const spot = seatSpot(zone, id);
  const facing = SEAT_FACING[zone];
  return spot && facing ? facing(spot) : SEAT_YAWS[zone];
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

function compareSeats(zone: Zone, a: SeatSpot, b: SeatSpot): number {
  return SEAT_DEPTH[zone](a) - SEAT_DEPTH[zone](b) || round(SEAT_OFFSET[zone](a)) - round(SEAT_OFFSET[zone](b)) || a.id - b.id;
}
