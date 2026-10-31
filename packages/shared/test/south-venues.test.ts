import { describe, expect, it } from "vitest";
import { ARRIVAL, type Bounds, WORLD_BOUNDS } from "../src/layout.ts";
import { BATHHOUSE_LANES, BATHHOUSE_MATS, BATHHOUSE_POOL } from "../src/venues/bathhouse.ts";
import { SEAT_YAWS, type VenueDef, VENUES, venueById } from "../src/venues/index.ts";
import { AVENUE } from "../src/venues/street.ts";
import { touches } from "../src/walk-graph.ts";
import { COURT_AREA, PLAZA_AREA, planPath, venueAt } from "../src/walk.ts";

// The venues that stand south of the plaza, along the avenue: what every one of them must keep, and the bathhouse in particular.
const FIRST_IDS: readonly string[] = ["gatbawi", "dharma", "shore", "casino"];
const NEW_VENUES: readonly VenueDef[] = VENUES.filter((venue: VenueDef) => !FIRST_IDS.includes(venue.id));
const BUILDINGS: readonly VenueDef[] = NEW_VENUES.filter((venue) => venue.id !== "street");
const ALL: readonly VenueDef[] = VENUES;

const overlaps = (a: Bounds, b: Bounds): boolean =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-6 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1e-6;
const holds = (area: Bounds, x: number, z: number, margin = 0): boolean =>
  x >= area.minX + margin && x <= area.maxX - margin && z >= area.minZ + margin && z <= area.maxZ - margin;
const middleOf = (area: Bounds): { x: number; z: number } => ({ x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 });

describe("the venues south of the plaza", () => {
  it("opens the street along the plaza's south edge, for walking and nothing else", () => {
    const street = venueById("street") as VenueDef;
    expect(street.footprint).toEqual(AVENUE);
    expect(AVENUE.minZ).toBe(WORLD_BOUNDS.maxZ);
    expect(touches(AVENUE, PLAZA_AREA)).toBe(true);
    expect(touches(AVENUE, COURT_AREA)).toBe(true);
    expect(street.seats).toBeUndefined();
    expect(street.indoor).toBe(false);
    expect(street.npc).toEqual({ stroll: false, seatWeight: 0 });
    expect(street.links).toContain("gatbawi");
    for (const venue of BUILDINGS) expect(street.links, venue.id).toContain(venue.id);
  });

  it("keeps the computer-driven monks and the daily quests out of every new venue, and joins each building to the street alone", () => {
    for (const venue of NEW_VENUES) {
      expect(venue.npc, venue.id).toEqual({ stroll: false, seatWeight: 0 });
      expect(venue.quests, venue.id).toBe(false);
    }
    for (const venue of BUILDINGS) expect(venue.links, venue.id).toEqual(["street"]);
  });

  it("gives each building a footprint clear of all other ground, the 법당, the plaza and the casino among it", () => {
    for (const venue of BUILDINGS) {
      for (const other of ALL) {
        if (other.id === venue.id) continue;
        for (const area of other.areas) expect(overlaps(venue.footprint, area), `${venue.id} and an area of ${other.id}`).toBe(false);
        if (other.seats || other.id === "casino") expect(overlaps(venue.footprint, other.footprint), `${venue.id} and ${other.id}`).toBe(false);
      }
    }
  });

  it("keeps the seats of every venue inside that venue's own areas, with room for a body, and apart from other seats", () => {
    const seated = ALL.filter((venue) => venue.seats);
    for (const venue of seated) {
      for (const spot of venue.seats?.spots ?? []) {
        expect(
          venue.areas.some((area) => holds(area, spot.x, spot.z, 0.3)),
          `${venue.id} seat ${spot.id}`,
        ).toBe(true);
        expect(venueAt(spot.x, spot.z), `${venue.id} seat ${spot.id}`).toBe(venue.id);
      }
    }
    const all = seated.flatMap((venue) => (venue.seats?.spots ?? []).map((spot) => ({ venue: venue.id, spot })));
    for (let a = 0; a < all.length; a += 1) {
      for (let b = a + 1; b < all.length; b += 1) {
        const one = all[a] as (typeof all)[number];
        const two = all[b] as (typeof all)[number];
        const apart = Math.hypot(one.spot.x - two.spot.x, one.spot.z - two.spot.z);
        expect(apart, `${one.venue}:${one.spot.id} and ${two.venue}:${two.spot.id}`).toBeGreaterThan(0.7);
      }
    }
  });

  it("puts the front of every activity on ground of the venue it belongs to", () => {
    for (const venue of ALL) {
      for (const spot of venue.activities ?? []) {
        expect(
          venue.areas.some((area) => holds(area, spot.frontX, spot.frontZ)),
          `${venue.id} ${spot.id}`,
        ).toBe(true);
      }
    }
  });

  it("walks from the arrival to every seat and every activity without leaving the ground", () => {
    const grounds = ALL.flatMap((venue) => venue.areas);
    const onGround = (x: number, z: number): boolean => grounds.some((area) => holds(area, x, z, -1e-4));
    const targets = [
      ...ALL.flatMap((venue) => (venue.seats?.spots ?? []).map((spot) => ({ name: `${venue.id}:${spot.id}`, x: spot.x, z: spot.z }))),
      ...ALL.flatMap((venue) => (venue.activities ?? []).map((spot) => ({ name: `${venue.id}/${spot.id}`, x: spot.frontX, z: spot.frontZ }))),
    ];
    for (const target of targets) {
      const path = planPath(ARRIVAL, target);
      const end = path[path.length - 1] as { x: number; z: number };
      expect(Math.hypot(end.x - target.x, end.z - target.z), target.name).toBeLessThan(1e-3);
      let from: { x: number; z: number } = ARRIVAL;
      for (const corner of path) {
        for (let step = 0; step <= 20; step += 1) {
          const x = from.x + ((corner.x - from.x) * step) / 20;
          const z = from.z + ((corner.z - from.z) * step) / 20;
          expect(onGround(x, z), `${target.name} at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
        }
        from = corner;
      }
    }
  });

  it("walks from the arrival into the middle of every building and back to the arrival", () => {
    for (const venue of BUILDINGS) {
      const last = venue.areas[venue.areas.length - 1] as Bounds;
      const middle = middleOf(last);
      expect(planPath(ARRIVAL, middle).at(-1), venue.id).toEqual(middle);
      expect(planPath(middle, ARRIVAL).at(-1), venue.id).toEqual({ x: ARRIVAL.x, z: ARRIVAL.z });
    }
  });
});

describe("the bathhouse", () => {
  const venue = venueById("bathhouse") as VenueDef;

  it("seats forty on mats in the rest room, facing the pool, and gives the pool four swimming lanes", () => {
    expect(BATHHOUSE_MATS).toHaveLength(40);
    expect(venue.seats?.spots).toBe(BATHHOUSE_MATS);
    expect(venue.indoor).toBe(true);
    expect(BATHHOUSE_LANES.map((lane) => lane.kind)).toEqual(["swim", "swim", "swim", "swim"]);
    expect(new Set(BATHHOUSE_LANES.map((lane) => lane.id)).size).toBe(4);
    expect(SEAT_YAWS.bathhouse).toBeCloseTo(Math.PI / 2, 9);
    for (const mat of BATHHOUSE_MATS) expect(mat.x).toBeGreaterThan(BATHHOUSE_POOL.maxX);
  });

  it("fills its slot of 14 by 14 and keeps the water out of the walkable ground", () => {
    expect(venue.footprint.maxX - venue.footprint.minX).toBeCloseTo(14, 9);
    expect(venue.footprint.maxZ - venue.footprint.minZ).toBeCloseTo(14, 9);
    expect(middleOf(venue.footprint)).toEqual({ x: 0, z: 29 });
    expect(holds(venue.footprint, BATHHOUSE_POOL.minX, BATHHOUSE_POOL.minZ)).toBe(true);
    expect(holds(venue.footprint, BATHHOUSE_POOL.maxX, BATHHOUSE_POOL.maxZ)).toBe(true);
    for (const other of ALL) for (const area of other.areas) expect(overlaps(area, BATHHOUSE_POOL), other.id).toBe(false);
    for (const lane of BATHHOUSE_LANES) expect(holds(BATHHOUSE_POOL, lane.x, lane.z)).toBe(true);
  });

  it("is entered from the avenue by a door in the wall facing it", () => {
    const [apron, door] = venue.areas as readonly [Bounds, Bounds];
    expect(touches(AVENUE, apron)).toBe(true);
    expect(touches(apron, door)).toBe(true);
    expect(door.minZ).toBe(venue.footprint.minZ);
    expect(apron.maxZ).toBe(venue.footprint.minZ);
  });
});
