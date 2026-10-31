import { type Bounds, CASINO_AREAS, DEFAULT_ZONE, VENUES, type VenueId, type Weather } from "@dongjane/shared";
import { seaLevel } from "./sea-level.ts";

export const BEDS = ["wind", "sea", "rain", "fire", "water"] as const;
export type Bed = (typeof BEDS)[number];
export type Ambience = Record<Bed, number>;

export const SILENCE: Readonly<Ambience> = { wind: 0, sea: 0, rain: 0, fire: 0, water: 0 };

// A bed a venue omits is silent there; a new venue must be listed here.
export const VENUE_SOUNDS: Readonly<Record<VenueId, Readonly<Partial<Record<Bed, number>>>>> = {
  gatbawi: { wind: 1, sea: 1, rain: 1 },
  shore: { wind: 1, sea: 1, rain: 1 },
  street: { wind: 1, sea: 1, rain: 1 },
  bonfire: { wind: 0.4, sea: 1, rain: 1, fire: 1 },
  bathhouse: { water: 1 },
  dharma: {},
  church: {},
  casino: {},
};

// The beds a concert video drowns out.
const OPEN_AIR: ReadonlySet<Bed> = new Set<Bed>(["wind", "rain", "fire"]);

// The casino's footprint also holds its coast road and its yard; only the floor inside is a room.
const ROOMS: Readonly<Partial<Record<VenueId, readonly Bounds[]>>> = { casino: CASINO_AREAS };

const EDGE = 1e-5;
const holds = (area: Bounds, x: number, z: number): boolean =>
  x >= area.minX - EDGE && x <= area.maxX + EDGE && z >= area.minZ - EDGE && z <= area.maxZ + EDGE;

export const PLACES: readonly { readonly id: VenueId; readonly areas: readonly Bounds[] }[] = VENUES.map((venue) => ({
  id: venue.id,
  areas: ROOMS[venue.id] ?? [venue.footprint],
}));

// Unlike venueAt, which only knows the seated venues, this covers every venue.
export function placeAt(x: number, z: number): VenueId {
  for (const place of PLACES) if (place.areas.some((area) => holds(area, x, z))) return place.id;
  return DEFAULT_ZONE;
}

const share = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function ambienceAt(place: VenueId, x: number, z: number, weather: Weather | null, videoAudible: boolean): Ambience {
  const profile = VENUE_SOUNDS[place];
  const level = (bed: Bed): number => (videoAudible && OPEN_AIR.has(bed) ? 0 : share(profile[bed]));
  return {
    wind: level("wind"),
    sea: share(level("sea") * seaLevel(x, z)),
    rain: weather === "rain" ? level("rain") : 0,
    fire: level("fire"),
    water: level("water"),
  };
}
