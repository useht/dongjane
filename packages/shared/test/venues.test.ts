import { describe, expect, it } from "vitest";
import { CASINO_AREAS, CASINO_DOOR, CASINO_YARD, COAST_ROAD } from "../src/casino-layout.ts";
import { ZONE_CAPACITY } from "../src/constants.ts";
import { ARRIVAL, SHORE } from "../src/layout.ts";
import { weightedOrder } from "../src/npc.ts";
import {
  INDOOR,
  SEAT_DEPTH,
  SEAT_NAMES,
  SEAT_TOPS,
  SEAT_YAWS,
  CASINO_VENUE,
  DHARMA_VENUE,
  GATBAWI_VENUE,
  SHORE_VENUE,
  type VenueDef,
  VENUES,
  ZONES,
  ZONE_NAMES,
  ZONE_SEATS,
  isZone,
  pickSeat,
  seatKey,
  seatSpot,
  venueById,
} from "../src/venues/index.ts";
import { buildWalkGraph, routesBetween, touches } from "../src/walk-graph.ts";
import { COURT_AREA, DOORWAY_AREA, INTERIOR_AREA, PLAZA_AREA, venueAt } from "../src/walk.ts";

// The first four venues, the world as it was before the others: a chain of eight areas from the room outward, each touching the
// next, then the casino floor's ring of aisles.
const FIRST_VENUES = [GATBAWI_VENUE, DHARMA_VENUE, SHORE_VENUE, CASINO_VENUE];
const CHAIN = [INTERIOR_AREA, DOORWAY_AREA, COURT_AREA, PLAZA_AREA, SHORE, COAST_ROAD, CASINO_YARD, CASINO_DOOR];

describe("the venue registry", () => {
  it("lists each venue once, under an id of its own", () => {
    const ids = VENUES.map((venue) => venue.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["gatbawi", "dharma", "shore", "casino", "street", "bathhouse"]);
  });

  it("links only venues that exist, and links them both ways", () => {
    for (const venue of VENUES) {
      for (const id of venue.links) {
        const other = venueById(id);
        expect(other, `${venue.id} links to ${id}`).toBeDefined();
        expect(other?.links.includes(venue.id), `${id} links back to ${venue.id}`).toBe(true);
      }
    }
  });

  it("gives every venue ground to stand on, inside its footprint", () => {
    for (const venue of VENUES) {
      expect(venue.areas.length, venue.id).toBeGreaterThan(0);
      expect(venue.footprint.maxX, venue.id).toBeGreaterThan(venue.footprint.minX);
      expect(venue.footprint.maxZ, venue.id).toBeGreaterThan(venue.footprint.minZ);
    }
  });

  it("makes zones of the venues with seats, and nothing else", () => {
    expect(ZONES).toEqual(["gatbawi", "dharma", "bathhouse"]);
    expect(VENUES.filter((venue: VenueDef) => venue.seats).map((venue) => venue.id)).toEqual([...ZONES]);
    expect(isZone("gatbawi")).toBe(true);
    expect(isZone("dharma")).toBe(true);
    expect(isZone("bathhouse")).toBe(true);
    expect(isZone("street")).toBe(false);
    expect(isZone("shore")).toBe(false);
    expect(isZone("casino")).toBe(false);
    expect(isZone(undefined)).toBe(false);
    expect(isZone("constructor")).toBe(false);
  });

  it("reads the deprecated zone tables from the venues", () => {
    expect(ZONE_NAMES).toEqual({ gatbawi: "갓바위", dharma: "법당", bathhouse: "목욕탕" });
    expect(SEAT_NAMES).toEqual({ gatbawi: "돗자리", dharma: "방석", bathhouse: "찜질 매트" });
    expect(SEAT_YAWS.gatbawi).toBe(0);
    expect(INDOOR).toEqual({ gatbawi: false, dharma: true, bathhouse: true });
    expect(SEAT_TOPS.dharma).toBeGreaterThan(SEAT_TOPS.gatbawi);
    for (const zone of ZONES) expect(SEAT_YAWS[zone]).toBe(venueById(zone)?.seats?.yaw);
  });

  it("keeps the seats numbered from 0 within an int8, ZONE_CAPACITY of them on the plaza and in the 법당 and no more in any zone", () => {
    expect(ZONE_SEATS.gatbawi).toHaveLength(ZONE_CAPACITY);
    expect(ZONE_SEATS.dharma).toHaveLength(ZONE_CAPACITY);
    for (const zone of ZONES) {
      const seats = ZONE_SEATS[zone];
      expect(seats.length, zone).toBeGreaterThan(0);
      expect(seats.length, zone).toBeLessThanOrEqual(ZONE_CAPACITY);
      expect(
        seats.map((spot) => spot.id),
        zone,
      ).toEqual(seats.map((_, index) => index));
      expect(Math.max(...seats.map((spot) => spot.id)), zone).toBeLessThanOrEqual(127);
    }
  });

  it("looks a seat up by zone and number, and names it as the protocol does", () => {
    expect(seatSpot("dharma", 0)).toBe(ZONE_SEATS.dharma[0]);
    expect(seatSpot("gatbawi", ZONE_CAPACITY)).toBeUndefined();
    expect(seatSpot("gatbawi", 1.5)).toBeUndefined();
    expect(seatSpot("gatbawi", -1)).toBeUndefined();
    expect(seatKey("dharma", 7)).toBe("dharma:7");
  });

  it("seats someone nobody chose for in the front row, nearest the middle", () => {
    for (const zone of ZONES) {
      const first = pickSeat(zone, () => false);
      expect(first).toBeDefined();
      const frontDepth = Math.min(...ZONE_SEATS[zone].map(SEAT_DEPTH[zone]));
      expect(SEAT_DEPTH[zone](first as (typeof ZONE_SEATS)[typeof zone][number])).toBe(frontDepth);
      const taken = new Set<number>();
      for (let n = 0; n < ZONE_SEATS[zone].length; n += 1) {
        const spot = pickSeat(zone, (id) => taken.has(id));
        expect(spot, `${zone} seat ${n}`).toBeDefined();
        taken.add((spot as { id: number }).id);
      }
      expect(taken.size).toBe(ZONE_SEATS[zone].length);
      expect(pickSeat(zone, () => true)).toBeUndefined();
    }
  });
});

describe("the walk graph", () => {
  const graph = buildWalkGraph(VENUES, ARRIVAL);
  const first = buildWalkGraph(FIRST_VENUES, ARRIVAL);

  it("numbers the areas outward from the room, as the chain did", () => {
    expect(first.slice(0, CHAIN.length).map((node) => node.area)).toEqual(CHAIN);
    expect(first.slice(CHAIN.length).map((node) => node.area)).toEqual(expect.arrayContaining([...CASINO_AREAS]));
    expect(first).toHaveLength(CHAIN.length + CASINO_AREAS.length);
    expect(first[0]?.venue).toBe("dharma");
    expect(graph[0]?.venue).toBe("dharma");
  });

  it("joins the chain neighbour to neighbour, and rings the casino floor", () => {
    first.slice(0, CHAIN.length - 1).forEach((node, index) => {
      expect(node.neighbours, `area ${index}`).toContain(index + 1);
      if (index > 0) expect(node.neighbours, `area ${index}`).toContain(index - 1);
    });
    const lobby = first[CHAIN.length] as (typeof first)[number];
    expect(lobby.area).toBe(CASINO_AREAS[0]);
    expect(lobby.neighbours).toHaveLength(3);
    const cross = first.find((node) => node.area === CASINO_AREAS[2]) as (typeof first)[number];
    expect(cross.neighbours).toHaveLength(2);
  });

  it("joins areas only along an edge of positive length", () => {
    expect(touches(INTERIOR_AREA, DOORWAY_AREA)).toBe(true);
    expect(touches(COURT_AREA, PLAZA_AREA)).toBe(true);
    expect(touches(INTERIOR_AREA, PLAZA_AREA)).toBe(false);
    expect(touches(COAST_ROAD, COAST_ROAD)).toBe(false);
  });

  it("lets the computer-driven monks stroll the first five areas, and no others", () => {
    expect(first.filter((node) => node.stroll).map((node) => node.area)).toEqual(CHAIN.slice(0, 5));
    expect(first.map((node) => node.stroll)).toEqual([true, true, true, true, true, ...Array(first.length - 5).fill(false)]);
  });

  it("has no two areas that overlap", () => {
    for (let a = 0; a < graph.length; a += 1) {
      for (let b = a + 1; b < graph.length; b += 1) {
        const one = graph[a]?.area;
        const two = graph[b]?.area;
        if (!one || !two) continue;
        const across = Math.min(one.maxX, two.maxX) - Math.max(one.minX, two.minX);
        const along = Math.min(one.maxZ, two.maxZ) - Math.max(one.minZ, two.minZ);
        expect(across > 1e-6 && along > 1e-6, `areas ${a} and ${b} overlap`).toBe(false);
      }
    }
  });

  it("routes through every area between two ends of a line", () => {
    expect(routesBetween(first, 0, [7])).toEqual([[0, 1, 2, 3, 4, 5, 6, 7]]);
    expect(routesBetween(first, 7, [0])).toEqual([[7, 6, 5, 4, 3, 2, 1, 0]]);
    expect(routesBetween(first, 3, [3])).toEqual([[3]]);
  });

  it("offers each way round the casino's ring", () => {
    const lobby = CHAIN.length;
    const far = first.length - 1;
    const routes = routesBetween(first, lobby, [far]);
    expect(routes.length).toBe(2);
    for (const route of routes) {
      expect(route[0]).toBe(lobby);
      expect(route[route.length - 1]).toBe(far);
      expect(route).toHaveLength(3);
    }
  });

  it("offers a route to each goal it is given", () => {
    expect(routesBetween(first, 3, [5])).toEqual([[3, 4, 5]]);
    expect(routesBetween(first, 2, [0, 5])).toEqual([[2, 1, 0], [2, 3, 4, 5]]);
  });

  it("refuses a world with ground the visitors cannot reach", () => {
    const island = { ...VENUES[0], id: "island", links: [] as string[], areas: [{ minX: 500, maxX: 510, minZ: 500, maxZ: 510 }] };
    expect(() => buildWalkGraph([...VENUES, island], ARRIVAL)).toThrow(/island/);
    expect(() => buildWalkGraph(VENUES, { x: 9999, z: 9999 })).toThrow(/arrival/);
  });

  it("reports where a point is by the footprint of the seated venues, the open ground being the plaza's", () => {
    expect(venueAt(ARRIVAL.x, ARRIVAL.z)).toBe("dharma");
    expect(venueAt(0, 0)).toBe("gatbawi");
    expect(venueAt((DOORWAY_AREA.minX + DOORWAY_AREA.maxX) / 2, (DOORWAY_AREA.minZ + DOORWAY_AREA.maxZ) / 2)).toBe("gatbawi");
    expect(venueAt(SHORE.minX + 1, (SHORE.minZ + SHORE.maxZ) / 2)).toBe("gatbawi");
  });
});

describe("weightedOrder", () => {
  const counter = (values: number[]) => {
    let at = 0;
    let drawn = 0;
    return { random: () => { drawn += 1; return values[at++ % values.length] as number; }, drawn: () => drawn };
  };

  it("draws nothing when there is nothing to choose between", () => {
    const { random, drawn } = counter([0.5]);
    expect(weightedOrder([], () => 1, random)).toEqual([]);
    expect(weightedOrder(["one"], () => 1, random)).toEqual(["one"]);
    expect(drawn()).toBe(0);
  });

  it("orders by weight: a low draw takes the first, a high draw the last", () => {
    expect(weightedOrder(["a", "b", "c"], () => 1, counter([0, 0]).random)).toEqual(["a", "b", "c"]);
    expect(weightedOrder(["a", "b", "c"], () => 1, counter([0.99, 0.99]).random)).toEqual(["c", "b", "a"]);
    expect(weightedOrder(["a", "b", "c"], (item) => (item === "a" ? 8 : 1), counter([0.5, 0.5]).random)[0]).toBe("a");
  });

  it("keeps the items it was given, each once", () => {
    const items = ["a", "b", "c", "d"];
    const order = weightedOrder(items, (item) => items.indexOf(item) + 1, counter([0.3, 0.6, 0.1]).random);
    expect([...order].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
});
