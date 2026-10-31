import type { SeatSpot } from "../layout.ts";
import { CASINO_VENUE } from "./casino.ts";
import { DHARMA_VENUE } from "./dharma.ts";
import { GATBAWI_VENUE } from "./gatbawi.ts";
import { SHORE_VENUE } from "./shore.ts";
import type { SeatGroup, VenueDef } from "./types.ts";

export type { ActivitySpot, SeatGroup, VenueDef } from "./types.ts";
export { CASINO_VENUE, DHARMA_VENUE, GATBAWI_VENUE, SHORE_VENUE };

// Every place in the world, in the order the world lists them. A new venue is a file beside these and a line here: the walk
// graph, the seats, the computer-driven monks and the client's views are all read from this list.
export const VENUES = [GATBAWI_VENUE, DHARMA_VENUE, SHORE_VENUE, CASINO_VENUE] as const satisfies readonly VenueDef[];
export type VenueId = (typeof VENUES)[number]["id"];

// A zone is a venue with seats. A seat is addressed by its zone (the venue's id) and its number, which is also how the
// protocol names it: the `zone` field of a message and of a seat is a string.
type SeatedVenue = Extract<(typeof VENUES)[number], { readonly seats: SeatGroup }>;
export type Zone = SeatedVenue["id"];

export const SEATED_VENUES: readonly SeatedVenue[] = VENUES.filter((venue: VenueDef): venue is SeatedVenue => venue.seats !== undefined);
export const ZONES: readonly Zone[] = SEATED_VENUES.map((venue) => venue.id);

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
export const INDOOR = perZone((venue) => venue.indoor);

const round = (value: number): number => Math.round(value * 100) / 100;

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

function compareSeats(zone: Zone, a: SeatSpot, b: SeatSpot): number {
  return SEAT_DEPTH[zone](a) - SEAT_DEPTH[zone](b) || round(SEAT_OFFSET[zone](a)) - round(SEAT_OFFSET[zone](b)) || a.id - b.id;
}
