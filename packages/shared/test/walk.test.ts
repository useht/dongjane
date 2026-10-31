import { describe, expect, it } from "vitest";
import {
  CASINO_AISLE_EAST,
  CASINO_AISLE_WEST,
  CASINO_AREAS,
  CASINO_CROSS,
  CASINO_DOOR,
  CASINO_FLOOR,
  CASINO_LINE_X,
  CASINO_LOBBY,
  CASINO_YARD,
  COAST_ROAD,
  insideCasino,
} from "../src/casino-layout.ts";
import {
  type Bounds,
  DHARMA_BOUNDS,
  DHARMA_ORIGIN,
  DHARMA_SEATS,
  GATBAWI_SEATS,
  SEA_LINE_X,
  SHORE,
  WORLD_BOUNDS,
} from "../src/layout.ts";
import {
  COURT_AREA,
  DOORWAY_AREA,
  INTERIOR_AREA,
  PLAZA_AREA,
  type Point,
  planPath,
  randomPointIn,
  randomWalkable,
  resolveNearby,
  resolveWalkable,
  slideWalkable,
  venueAt,
} from "../src/walk.ts";
import { AVENUE } from "../src/venues/street.ts";

const CHAIN = [
  INTERIOR_AREA,
  DOORWAY_AREA,
  COURT_AREA,
  PLAZA_AREA,
  SHORE,
  COAST_ROAD,
  CASINO_YARD,
  CASINO_DOOR,
  CASINO_LOBBY,
  CASINO_AISLE_WEST,
  CASINO_CROSS,
  CASINO_AISLE_EAST,
];

function walkable(point: Point): boolean {
  const solid = resolveWalkable(point.x, point.z);
  return Math.hypot(solid.x - point.x, solid.z - point.z) < 1e-4;
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

function assertWalkableRoute(from: Point, path: Point[]): void {
  let previous = from;
  for (const corner of path) {
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const point = { x: previous.x + (corner.x - previous.x) * t, z: previous.z + (corner.z - previous.z) * t };
      expect(walkable(point), `(${point.x.toFixed(3)}, ${point.z.toFixed(3)}) is inside a wall`).toBe(true);
    }
    previous = corner;
  }
}

function lengthOf(from: Point, corners: Point[]): number {
  let total = 0;
  let at = from;
  for (const corner of corners) {
    total += Math.hypot(corner.x - at.x, corner.z - at.z);
    at = corner;
  }
  return total;
}

// A point in the doorway: the door is in the room's front wall, which faces the plaza (+x).
const inDoorway = (p: Point): boolean =>
  p.x >= DHARMA_BOUNDS.maxX - 1e-6 && p.x <= COURT_AREA.minX + 1e-6 && p.z >= DOORWAY_AREA.minZ - 1e-6 && p.z <= DOORWAY_AREA.maxZ + 1e-6;

describe("walkable areas", () => {
  it("chains the room, the doorway, the court, the plaza, the shore and the casino so that each touches the next", () => {
    expect(PLAZA_AREA).toBe(WORLD_BOUNDS);
    expect(INTERIOR_AREA).toBe(DHARMA_BOUNDS);
    for (let i = 0; i + 1 < CHAIN.length; i += 1) {
      const a = CHAIN[i]!;
      const b = CHAIN[i + 1]!;
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      expect(overlapX, `areas ${i} and ${i + 1} are apart in x`).toBeGreaterThanOrEqual(0);
      expect(overlapZ, `areas ${i} and ${i + 1} are apart in z`).toBeGreaterThanOrEqual(0);
      expect(Math.max(overlapX, overlapZ), `areas ${i} and ${i + 1} only meet at a point`).toBeGreaterThan(0.7);
    }
  });

  it("puts the doorway in the front wall of the room, in line with the middle of the floor, facing the plaza", () => {
    expect(DOORWAY_AREA.minX).toBe(DHARMA_BOUNDS.maxX);
    expect((DOORWAY_AREA.minZ + DOORWAY_AREA.maxZ) / 2).toBe(DHARMA_ORIGIN.z);
    expect(DOORWAY_AREA.maxX).toBe(COURT_AREA.minX);
    expect(COURT_AREA.maxX).toBe(WORLD_BOUNDS.minX);
    expect(DOORWAY_AREA.maxX).toBeLessThan(WORLD_BOUNDS.minX);
  });

  it("runs the court along the plaza's west edge, as deep as the plaza, between the porch and the plaza", () => {
    expect(COURT_AREA.minZ).toBe(WORLD_BOUNDS.minZ);
    expect(COURT_AREA.maxZ).toBe(WORLD_BOUNDS.maxZ);
    expect(DOORWAY_AREA.minZ).toBeGreaterThanOrEqual(COURT_AREA.minZ);
    expect(DOORWAY_AREA.maxZ).toBeLessThanOrEqual(COURT_AREA.maxZ);
  });

  it("puts every seat on walkable ground", () => {
    for (const spot of [...GATBAWI_SEATS, ...DHARMA_SEATS]) expect(walkable(spot)).toBe(true);
  });
});

describe("venueAt", () => {
  it("is the 법당 only inside its walls", () => {
    expect(venueAt(DHARMA_ORIGIN.x, DHARMA_ORIGIN.z)).toBe("dharma");
    expect(venueAt(DHARMA_BOUNDS.minX, DHARMA_BOUNDS.minZ)).toBe("dharma");
    expect(venueAt(DHARMA_BOUNDS.maxX + 0.5, DHARMA_ORIGIN.z)).toBe("gatbawi");
    expect(venueAt(COURT_AREA.minX + 1, DHARMA_ORIGIN.z)).toBe("gatbawi");
    expect(venueAt(0, 14)).toBe("gatbawi");
    expect(venueAt(-100, -100)).toBe("gatbawi");
  });

  it("forgives the float32 rounding of a monk standing on a wall line", () => {
    expect(venueAt(Math.fround(DHARMA_BOUNDS.maxX), Math.fround(DHARMA_BOUNDS.maxZ))).toBe("dharma");
  });
});

describe("resolveWalkable", () => {
  it("leaves walkable points alone and pulls the rest back to the nearest ground", () => {
    expect(resolveWalkable(1, 2)).toEqual({ x: 1, z: 2 });
    expect(resolveWalkable(100, 10)).toEqual({ x: SHORE.maxX, z: 10 });
    expect(resolveWalkable(100, 100)).toEqual({ x: CASINO_CROSS.maxX, z: CASINO_CROSS.maxZ });
    expect(resolveWalkable(-100, -100)).toEqual({ x: DHARMA_BOUNDS.minX, z: DHARMA_BOUNDS.minZ });
    expect(resolveWalkable(DOORWAY_AREA.maxX - 0.5, DHARMA_ORIGIN.z)).toEqual({ x: DOORWAY_AREA.maxX - 0.5, z: DHARMA_ORIGIN.z });
    expect(resolveWalkable(500, -500)).toEqual({ x: SHORE.maxX, z: WORLD_BOUNDS.minZ });
  });

  it("keeps a point that sits in the court, in front of the wall", () => {
    expect(resolveWalkable(-8, 12)).toEqual({ x: -8, z: 12 });
    expect(resolveWalkable(COURT_AREA.minX - 0.5, 12)).toEqual({ x: COURT_AREA.minX, z: 12 });
  });

  it("stops a walker against the front wall instead of pushing them through it", () => {
    const wallZ = DHARMA_ORIGIN.z + 5;
    expect(resolveWalkable(DHARMA_BOUNDS.maxX + 0.5, wallZ)).toEqual({ x: DHARMA_BOUNDS.maxX, z: wallZ });
    expect(resolveWalkable(COURT_AREA.minX - 0.5, wallZ)).toEqual({ x: COURT_AREA.minX, z: wallZ });
  });

  it("prefers the area the walker stands in when two are equally near", () => {
    const wallZ = DHARMA_ORIGIN.z + 5;
    const middle = DHARMA_BOUNDS.maxX + (COURT_AREA.minX - DHARMA_BOUNDS.maxX) / 2;
    const inside = { x: DHARMA_BOUNDS.maxX - 0.01, z: wallZ };
    const pressed = resolveWalkable(middle, wallZ, inside);
    expect(pressed.x).toBeLessThanOrEqual(DHARMA_BOUNDS.maxX);
    const outside = { x: COURT_AREA.minX + 0.01, z: wallZ };
    const other = resolveWalkable(middle, wallZ, outside);
    expect(other.x).toBeGreaterThanOrEqual(COURT_AREA.minX);
  });
});

describe("resolveNearby", () => {
  it("clamps to the ground the walker stands on, even when another area is nearer behind a wall", () => {
    const wallZ = DHARMA_ORIGIN.z + 5;
    const onPlaza = { x: WORLD_BOUNDS.minX + 1, z: 0 };
    const target = { x: DHARMA_BOUNDS.maxX + 0.1, z: wallZ };
    expect(resolveWalkable(target.x, target.z).x).toBe(DHARMA_BOUNDS.maxX);
    expect(resolveNearby(target.x, target.z, onPlaza)).toEqual({ x: WORLD_BOUNDS.minX, z: wallZ });

    const inRoom = { x: DHARMA_BOUNDS.maxX - 1, z: 0 };
    const beyond = { x: COURT_AREA.minX - 0.1, z: wallZ };
    expect(resolveWalkable(beyond.x, beyond.z).x).toBe(COURT_AREA.minX);
    expect(resolveNearby(beyond.x, beyond.z, inRoom)).toEqual({ x: DHARMA_BOUNDS.maxX, z: wallZ });
  });

  it("leaves a walkable point alone and keeps a walker in a corner where they are", () => {
    expect(resolveNearby(1, 2, { x: 0, z: 0 })).toEqual({ x: 1, z: 2 });
    const corner = { x: COURT_AREA.minX, z: WORLD_BOUNDS.minZ };
    expect(resolveNearby(corner.x - 3, corner.z, corner)).toEqual(corner);
  });

  it("falls back to the nearest ground for a walker who is not on any", () => {
    expect(resolveNearby(100, 10, { x: 500, z: 500 })).toEqual({ x: SHORE.maxX, z: 10 });
  });
});

describe("random points", () => {
  it("picks a point of an area from two draws", () => {
    const draws = [0, 1];
    const point = randomPointIn(INTERIOR_AREA, () => draws.shift()!);
    expect(point.x).toBeCloseTo(INTERIOR_AREA.minX, 9);
    expect(point.z).toBeCloseTo(INTERIOR_AREA.maxZ, 9);
  });

  it("spreads walkable points over every temple area in proportion to its size", () => {
    const random = seededRandom(5);
    const temple = CHAIN.slice(0, 5);
    const hits = temple.map(() => 0);
    const total = 20_000;
    for (let n = 0; n < total; n += 1) {
      const point = randomWalkable(random);
      expect(walkable(point), `(${point.x.toFixed(3)}, ${point.z.toFixed(3)}) is inside a wall`).toBe(true);
      const index = temple.findIndex(
        (area) => point.x >= area.minX && point.x <= area.maxX && point.z >= area.minZ && point.z <= area.maxZ,
      );
      expect(index, `(${point.x.toFixed(3)}, ${point.z.toFixed(3)}) is outside the temple`).toBeGreaterThanOrEqual(0);
      hits[index] = (hits[index] ?? 0) + 1;
    }
    const size = (area: (typeof CHAIN)[number]) => (area.maxX - area.minX) * (area.maxZ - area.minZ);
    const whole = temple.reduce((sum, area) => sum + size(area), 0);
    temple.forEach((area, index) => {
      expect((hits[index] ?? 0) / total).toBeCloseTo(size(area) / whole, 1);
    });
    expect(hits.every((count) => count > 0)).toBe(true);
  });
});

describe("planPath", () => {
  it("is a single straight line inside one area", () => {
    expect(planPath({ x: 0, z: 14 }, { x: 3, z: 2 })).toEqual([{ x: 3, z: 2 }]);
    expect(planPath({ x: DHARMA_ORIGIN.x - 3, z: -5 }, { x: DHARMA_ORIGIN.x + 5, z: 4 })).toEqual([{ x: DHARMA_ORIGIN.x + 5, z: 4 }]);
  });

  it("ends at the nearest walkable point when the target is out of bounds", () => {
    expect(planPath({ x: 0, z: 14 }, { x: 500, z: 10 }).at(-1)).toEqual({ x: SHORE.maxX, z: 10 });
    expect(planPath({ x: 0, z: 14 }, { x: 500, z: 500 }).at(-1)).toEqual({ x: CASINO_CROSS.maxX, z: CASINO_CROSS.maxZ });
  });

  it("leads from the plaza through the court and the east doorway to a seat in the 법당", () => {
    const seat = DHARMA_SEATS[24]!;
    const from = { x: 0, z: 14 };
    const path = planPath(from, seat);
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path.at(-1)).toEqual({ x: seat.x, z: seat.z });
    expect(path.filter(inDoorway).length).toBeGreaterThan(0);
    assertWalkableRoute(from, path);
  });

  it("walks every plaza corner into every corner of the room through the door, and out again", () => {
    const plaza = [
      { x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.minZ },
      { x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.maxZ },
      { x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.minZ },
      { x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ },
      { x: 0, z: 14 },
    ];
    const room = [
      { x: DHARMA_BOUNDS.minX, z: DHARMA_BOUNDS.minZ },
      { x: DHARMA_BOUNDS.minX, z: DHARMA_BOUNDS.maxZ },
      { x: DHARMA_BOUNDS.maxX, z: DHARMA_BOUNDS.minZ },
      { x: DHARMA_BOUNDS.maxX, z: DHARMA_BOUNDS.maxZ },
      { x: DHARMA_ORIGIN.x, z: DHARMA_ORIGIN.z },
    ];
    for (const outside of plaza) {
      for (const inside of room) {
        const in_ = planPath(outside, inside);
        expect(in_.at(-1), "arrives where it was sent").toEqual(inside);
        expect(in_.filter(inDoorway).length, "passes through the doorway").toBeGreaterThan(0);
        assertWalkableRoute(outside, in_);
        const out = planPath(inside, outside);
        expect(out.at(-1)).toEqual(outside);
        expect(out.filter(inDoorway).length).toBeGreaterThan(0);
        assertWalkableRoute(inside, out);
      }
    }
  });

  it("leads from a seat in the 법당 back out to the plaza the same way", () => {
    const seat = DHARMA_SEATS[3]!;
    const to = { x: 4, z: 12 };
    const path = planPath(seat, to);
    expect(path.at(-1)).toEqual(to);
    expect(path.filter(inDoorway).length).toBeGreaterThan(0);
    assertWalkableRoute(seat, path);
  });

  it("keeps every corner clear of the jambs of the doorway", () => {
    for (const from of [{ x: 6, z: 11 }, { x: COURT_AREA.minX + 0.2, z: 12 }, { x: DHARMA_BOUNDS.minX + 0.2, z: -6 }]) {
      for (const to of [DHARMA_SEATS[0]!, DHARMA_SEATS[49]!, { x: DHARMA_ORIGIN.x, z: DHARMA_ORIGIN.z }]) {
        for (const corner of planPath(from, to)) {
          if (corner.x > DHARMA_BOUNDS.maxX && corner.x < COURT_AREA.minX) {
            expect(corner.z).toBeGreaterThanOrEqual(DOORWAY_AREA.minZ + 0.3);
            expect(corner.z).toBeLessThanOrEqual(DOORWAY_AREA.maxZ - 0.3);
          }
        }
      }
    }
  });

  it("walks the shortest sensible way: no longer than the detour through the middle of the doorway", () => {
    const from = { x: 0, z: 14 };
    const to = { x: DHARMA_ORIGIN.x, z: DHARMA_ORIGIN.z };
    const detour = [{ x: COURT_AREA.minX + 0.5, z: DHARMA_ORIGIN.z }, to];
    expect(lengthOf(from, planPath(from, to))).toBeLessThanOrEqual(lengthOf(from, detour) + 1e-6);
  });

  it("cuts across the plaza to the door's near jamb instead of walking down the court", () => {
    const from = { x: 6, z: 14 };
    const to = { x: DHARMA_ORIGIN.x - 2, z: DHARMA_ORIGIN.z };
    const direct = Math.hypot(to.x - from.x, to.z - from.z);
    expect(lengthOf(from, planPath(from, to))).toBeLessThan(direct * 1.05);
  });

  it("never routes a random walk through a wall", () => {
    const random = seededRandom(2024);
    const pick = (): Point => ({ x: -34 + random() * 58, z: -14 + random() * 76 });
    for (let n = 0; n < 600; n += 1) {
      const from = resolveWalkable(pick().x, pick().z);
      const to = pick();
      const path = planPath(from, to);
      expect(path.length).toBeGreaterThan(0);
      expect(walkable(path.at(-1)!)).toBe(true);
      assertWalkableRoute(from, path);
    }
  });

  it("slides along the wall from outside instead of passing through it", () => {
    const from = { x: COURT_AREA.minX + 0.2, z: DHARMA_ORIGIN.z + 6 };
    const path = planPath(from, { x: DHARMA_BOUNDS.maxX - 2, z: DHARMA_ORIGIN.z + 6 });
    assertWalkableRoute(from, path);
    expect(path.some((p) => Math.abs(p.z - DHARMA_ORIGIN.z) <= DOORWAY_AREA.maxZ - DHARMA_ORIGIN.z)).toBe(true);
  });
});

describe("the shore", () => {
  it("is the link of the chain beyond the plaza's east edge", () => {
    expect(CHAIN[CHAIN.indexOf(PLAZA_AREA) + 1]).toBe(SHORE);
    expect(venueAt(SHORE.minX + 1, 5)).toBe("gatbawi");
    expect(venueAt(SEA_LINE_X - 0.5, 5)).toBe("gatbawi");
  });

  it("walks from the plaza onto the sand in one straight line", () => {
    const from = { x: 0, z: 14 };
    const target = { x: SHORE.minX + 3, z: 5 };
    const path = planPath(from, target);
    expect(path.at(-1)).toEqual(target);
    assertWalkableRoute(from, path);
  });

  it("walks from a seat in the 법당 all the way to the water's edge", () => {
    const seat = DHARMA_SEATS[24]!;
    const edge = { x: SEA_LINE_X, z: 6 };
    const path = planPath(seat, edge);
    expect(path.filter(inDoorway).length).toBeGreaterThan(0);
    expect(path.at(-1)).toEqual(edge);
    assertWalkableRoute(seat, path);
  });

  it("pulls a point in the sea back to the waterline", () => {
    expect(walkable({ x: SEA_LINE_X, z: 6 })).toBe(true);
    expect(resolveWalkable(SEA_LINE_X + 4, 6)).toEqual({ x: SEA_LINE_X, z: 6 });
    expect(planPath({ x: 0, z: 14 }, { x: SEA_LINE_X + 20, z: 6 }).at(-1)).toEqual({ x: SEA_LINE_X, z: 6 });
  });

  it("stops a keyboard walker at the waterline instead of letting them into the sea", () => {
    const slid = slideWalkable({ x: SEA_LINE_X - 0.2, z: 5 }, 1, 0);
    expect(slid.x).toBeCloseTo(SEA_LINE_X, 6);
    expect(slid.z).toBeCloseTo(5, 6);
    const across = slideWalkable({ x: WORLD_BOUNDS.maxX - 0.5, z: 5 }, 2, 0);
    expect(across.x).toBeCloseTo(WORLD_BOUNDS.maxX + 1.5, 6);
  });

  it("picks sand for random walks too", () => {
    const random = seededRandom(11);
    let onSand = 0;
    for (let n = 0; n < 2000; n += 1) if (randomWalkable(random).x > SHORE.minX) onSand += 1;
    expect(onSand).toBeGreaterThan(0);
  });
});

describe("slideWalkable", () => {
  it("walks the whole way when the ground allows it", () => {
    expect(slideWalkable({ x: 0, z: 14 }, 1, -2)).toEqual({ x: 1, z: 12 });
    expect(slideWalkable({ x: COURT_AREA.minX + 1, z: DHARMA_ORIGIN.z }, -4, 0)).toEqual({ x: COURT_AREA.minX + 1 - 4, z: DHARMA_ORIGIN.z });
  });

  it("stops at the front wall instead of being pulled through it", () => {
    const wallZ = DHARMA_ORIGIN.z + 5;
    const stopped = slideWalkable({ x: COURT_AREA.minX + 0.5, z: wallZ }, -2, 0);
    expect(stopped.x).toBeCloseTo(COURT_AREA.minX, 3);
    expect(stopped.z).toBeCloseTo(wallZ, 6);
  });

  it("slides along the wall when the push is slanted", () => {
    const from = { x: COURT_AREA.minX + 0.01, z: DHARMA_ORIGIN.z + 5 };
    const slid = slideWalkable(from, -1, -1);
    expect(slid.z).toBeCloseTo(from.z - 1, 6);
    expect(slid.x).toBeGreaterThanOrEqual(COURT_AREA.minX - 1e-3);
  });

  it("goes in through the doorway and out again", () => {
    const inside = slideWalkable({ x: COURT_AREA.minX + 0.5, z: DHARMA_ORIGIN.z }, -3, 0);
    expect(inside.x).toBeCloseTo(COURT_AREA.minX + 0.5 - 3, 6);
    expect(venueAt(inside.x, inside.z)).toBe("dharma");
    const out = slideWalkable(inside, 3, 0);
    expect(out.x).toBeCloseTo(inside.x + 3, 6);
  });

  it("ends exactly on the wall when a slanted push runs into it a hair away", () => {
    const slid = slideWalkable({ x: SHORE.maxX - 0.015, z: 5 }, 0.05, 0.05);
    expect(slid.x).toBe(SHORE.maxX);
    expect(slid.z).toBeCloseTo(5.05, 9);
  });

  it("stays put when it is pushed straight out of the world", () => {
    const edge = { x: SHORE.maxX, z: 5 };
    expect(slideWalkable(edge, 2, 0)).toEqual(edge);
  });
});

describe("the casino", () => {
  const LINKS = [SHORE, COAST_ROAD, CASINO_YARD, CASINO_DOOR, CASINO_LOBBY];
  // The floor is a ring: the lobby opens onto both aisles, which meet again in the cross room.
  const RING: [Bounds, Bounds][] = [
    [CASINO_LOBBY, CASINO_AISLE_WEST],
    [CASINO_AISLE_WEST, CASINO_CROSS],
    [CASINO_CROSS, CASINO_AISLE_EAST],
    [CASINO_AISLE_EAST, CASINO_LOBBY],
  ];
  const overlapOf = (a: Bounds, b: Bounds): Bounds => ({
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  });
  const corners = (area: Bounds): Point[] => [
    { x: area.minX, z: area.minZ },
    { x: area.minX, z: area.maxZ },
    { x: area.maxX, z: area.minZ },
    { x: area.maxX, z: area.maxZ },
  ];
  // How far, sideways, the walk strays from the straight line between its start and its end.
  const deviation = (from: Point, path: Point[]): number => {
    const end = path.at(-1)!;
    const dx = end.x - from.x;
    const dz = end.z - from.z;
    const length = Math.hypot(dx, dz);
    return Math.max(...path.map((p) => Math.abs((p.x - from.x) * dz - (p.z - from.z) * dx) / length));
  };
  const checkDoorstep = (a: Bounds, b: Bounds, label: string): void => {
    const step = overlapOf(a, b);
    expect(step.maxZ, `${label} meet end to end`).toBeCloseTo(step.minZ, 9);
    expect(step.maxX - step.minX, `doorstep ${label}`).toBeGreaterThanOrEqual(2.6);
    const x = (step.minX + step.maxX) / 2;
    expect(walkable({ x, z: step.minZ })).toBe(true);
    const through = slideWalkable({ x, z: step.minZ - 0.5 }, 0, 1);
    expect(through.x).toBeCloseTo(x, 6);
    expect(through.z).toBeCloseTo(step.minZ + 0.5, 6);
    const back = slideWalkable({ x, z: step.minZ + 0.5 }, 0, -1);
    expect(back.z).toBeCloseTo(step.minZ - 0.5, 6);
  };

  it("lies far to the south of the plaza, on land west of the sea, and never over the 법당 or the plaza", () => {
    expect(COAST_ROAD.minZ).toBe(WORLD_BOUNDS.maxZ);
    const casino = [...LINKS.slice(1), ...CASINO_AREAS];
    for (const area of casino) {
      expect(area.maxX).toBeLessThanOrEqual(16.5);
      expect(area.maxX).toBeLessThan(SEA_LINE_X);
      expect(area.minZ).toBeGreaterThanOrEqual(WORLD_BOUNDS.maxZ);
    }
    expect(CASINO_FLOOR.minZ - WORLD_BOUNDS.maxZ).toBeGreaterThanOrEqual(20);
    for (const old of [INTERIOR_AREA, DOORWAY_AREA, COURT_AREA, PLAZA_AREA]) {
      for (const area of casino) {
        const shared = overlapOf(old, area);
        expect(shared.maxX <= shared.minX || shared.maxZ <= shared.minZ, "apart").toBe(true);
      }
    }
  });

  it("lets no two areas of the chain cover the same ground", () => {
    CHAIN.forEach((a, i) => {
      CHAIN.slice(i + 1).forEach((b, j) => {
        const shared = overlapOf(a, b);
        expect(shared.maxX <= shared.minX || shared.maxZ <= shared.minZ, `areas ${i} and ${i + 1 + j} overlap`).toBe(true);
      });
    });
  });

  it("joins the shore, the road, the yard, the doorway and the lobby along doorsteps wide enough to walk through", () => {
    for (let i = 0; i + 1 < LINKS.length; i += 1) checkDoorstep(LINKS[i]!, LINKS[i + 1]!, `${i} and ${i + 1}`);
  });

  it("joins the lobby, the aisles and the cross room in a ring, each doorstep wide enough to walk through", () => {
    RING.forEach(([a, b], i) => checkDoorstep(a, b, `ring ${i}`));
  });

  it("walls the island in: a walker pushing sideways from an aisle stops at the aisle's edge", () => {
    const inEast = slideWalkable({ x: CASINO_AISLE_EAST.minX + 0.4, z: 50 }, -2, 0);
    expect(inEast.x).toBeCloseTo(CASINO_AISLE_EAST.minX, 6);
    expect(inEast.z).toBeCloseTo(50, 6);
    const inWest = slideWalkable({ x: CASINO_AISLE_WEST.maxX - 0.4, z: 50 }, 2, 0);
    expect(inWest.x).toBeCloseTo(CASINO_AISLE_WEST.maxX, 6);
    const behindFront = slideWalkable({ x: 11.4, z: CASINO_LOBBY.maxZ - 0.3 }, 0, 2);
    expect(behindFront.z).toBeCloseTo(CASINO_LOBBY.maxZ, 6);
  });

  it("puts a 2.8 m doorway through the front wall in line with the east aisle, across the lobby's middle", () => {
    expect(CASINO_DOOR.maxX - CASINO_DOOR.minX).toBeCloseTo(2.8, 9);
    expect(CASINO_DOOR.minZ).toBe(CASINO_YARD.maxZ);
    expect(CASINO_DOOR.maxZ).toBe(CASINO_LOBBY.minZ);
    expect(CASINO_DOOR.maxZ).toBe(CASINO_FLOOR.minZ);
    expect((CASINO_DOOR.minX + CASINO_DOOR.maxX) / 2).toBeCloseTo((CASINO_AISLE_EAST.minX + CASINO_AISLE_EAST.maxX) / 2, 9);
    expect(CASINO_LOBBY.minX).toBeLessThan(CASINO_DOOR.minX);
    expect(CASINO_LOBBY.maxX).toBeGreaterThanOrEqual(CASINO_DOOR.maxX);
  });

  it("leads from the 법당 to the east aisle and back, down the road and through the doorway", () => {
    const seat = DHARMA_SEATS[24]!;
    const stand = { x: CASINO_LINE_X, z: 50 };
    const path = planPath(seat, stand);
    expect(path.at(-1)).toEqual(stand);
    assertWalkableRoute(seat, path);
    expect(path.filter(inDoorway).length).toBeGreaterThan(0);
    expect(path.some((p) => p.z === COAST_ROAD.minZ && p.x >= COAST_ROAD.minX && p.x <= COAST_ROAD.maxX)).toBe(true);
    for (const z of [CASINO_DOOR.minZ, CASINO_DOOR.maxZ]) {
      const corner = path.find((p) => p.z === z);
      expect(corner, `crosses z = ${z}`).toBeDefined();
      expect(corner!.x).toBeGreaterThanOrEqual(CASINO_DOOR.minX + 0.3);
      expect(corner!.x).toBeLessThanOrEqual(CASINO_DOOR.maxX - 0.3);
    }
    const home = planPath(stand, seat);
    expect(home.at(-1)).toEqual({ x: seat.x, z: seat.z });
    assertWalkableRoute(stand, home);
  });

  it("walks from the shore to the doorway in one straight line along the centre line", () => {
    const door = { x: (CASINO_DOOR.minX + CASINO_DOOR.maxX) / 2, z: (CASINO_DOOR.minZ + CASINO_DOOR.maxZ) / 2 };
    expect(door.x).toBe(CASINO_LINE_X);
    const onLine = { x: CASINO_LINE_X, z: SHORE.maxZ - 1.5 };
    const straight = planPath(onLine, door);
    expect(straight.at(-1)).toEqual(door);
    for (const corner of straight) expect(corner.x).toBeCloseTo(CASINO_LINE_X, 9);
    expect(deviation(onLine, straight)).toBeLessThan(1e-6);
    assertWalkableRoute(onLine, straight);

    for (const x of [CASINO_LINE_X - 0.75, CASINO_LINE_X + 0.75]) {
      const from = { x, z: SHORE.maxZ - 1.5 };
      const path = planPath(from, door);
      expect(deviation(from, path), `from x = ${x}`).toBeLessThan(1e-6);
      assertWalkableRoute(from, path);
    }
  });

  it("takes the shorter way round the ring to a machine, west or east", () => {
    const door = { x: CASINO_LINE_X, z: CASINO_DOOR.minZ + 1 };
    const toWest = planPath(door, { x: 8.8, z: 63 });
    expect(toWest.every((p) => p.z <= CASINO_CROSS.minZ)).toBe(true);
    assertWalkableRoute(door, toWest);
    const toEast = planPath(door, { x: CASINO_LINE_X, z: 63 });
    expect(toEast.every((p) => p.x >= CASINO_AISLE_EAST.minX)).toBe(true);
    assertWalkableRoute(door, toEast);
    const across = planPath({ x: 8.8, z: 63 }, { x: CASINO_LINE_X, z: 63 });
    expect(across.some((p) => p.z >= CASINO_CROSS.minZ)).toBe(true);
    expect(lengthOf({ x: 8.8, z: 63 }, across)).toBeLessThan(15);
    assertWalkableRoute({ x: 8.8, z: 63 }, across);
    const back = planPath({ x: CASINO_LINE_X, z: 63 }, { x: 8.8, z: 63 });
    expect(lengthOf({ x: CASINO_LINE_X, z: 63 }, back)).toBeCloseTo(lengthOf({ x: 8.8, z: 63 }, across), 6);
  });

  it("walks from any corner of the casino's floor to any corner of the plaza without touching a wall", () => {
    for (const from of CASINO_AREAS.flatMap(corners)) {
      for (const to of [...corners(WORLD_BOUNDS), ...corners(COAST_ROAD)]) {
        const path = planPath(from, to);
        expect(path.at(-1)).toEqual(to);
        assertWalkableRoute(from, path);
      }
    }
  });

  it("stops a keyboard walker at the shore's south edge beside the road and lets one down the road itself", () => {
    const blocked = slideWalkable({ x: COAST_ROAD.maxX + 0.2, z: WORLD_BOUNDS.maxZ - 0.3 }, 0, 1);
    expect(blocked.x).toBeCloseTo(COAST_ROAD.maxX + 0.2, 6);
    expect(blocked.z).toBeCloseTo(WORLD_BOUNDS.maxZ, 6);
    const down = slideWalkable({ x: COAST_ROAD.minX + 0.5, z: WORLD_BOUNDS.maxZ - 0.3 }, 0, 4);
    expect(down.z).toBeCloseTo(WORLD_BOUNDS.maxZ + 3.7, 6);
  });

  it("lets a keyboard walker off the plaza's south edge onto the avenue, and no further than the avenue", () => {
    const onto = slideWalkable({ x: 0, z: WORLD_BOUNDS.maxZ - 0.3 }, 0, 2);
    expect(onto.z).toBeCloseTo(WORLD_BOUNDS.maxZ + 1.7, 6);
    const stopped = slideWalkable({ x: -28, z: AVENUE.maxZ - 0.3 }, 0, 2);
    expect(stopped.z).toBeCloseTo(AVENUE.maxZ, 6);
  });

  it("keeps the casino a part of the open ground for zones, and only the lobby, aisles and cross room count as inside it", () => {
    expect(venueAt(CASINO_FLOOR.minX + 1, CASINO_FLOOR.minZ + 1)).toBe("gatbawi");
    expect(insideCasino(CASINO_LINE_X, 50)).toBe(true);
    expect(insideCasino(8.8, 50)).toBe(true);
    expect(insideCasino(11.4, CASINO_LOBBY.maxZ - 0.1)).toBe(true);
    expect(insideCasino(11.4, CASINO_CROSS.minZ + 1)).toBe(true);
    expect(insideCasino(CASINO_FLOOR.minX, CASINO_FLOOR.minZ)).toBe(true);
    expect(insideCasino(Math.fround(CASINO_FLOOR.maxX), Math.fround(CASINO_FLOOR.maxZ))).toBe(true);
    expect(insideCasino(11.4, 50)).toBe(false);
    expect(insideCasino(11.4, CASINO_LOBBY.maxZ + 0.01)).toBe(false);
    expect(insideCasino(CASINO_FLOOR.maxX + 0.01, 50)).toBe(false);
    expect(insideCasino(CASINO_LINE_X, CASINO_FLOOR.minZ - 0.01)).toBe(false);
    expect(insideCasino(CASINO_LINE_X, CASINO_DOOR.minZ + 0.5)).toBe(false);
    expect(insideCasino(CASINO_LINE_X, CASINO_YARD.minZ + 1)).toBe(false);
    expect(insideCasino(0, 0)).toBe(false);
  });

  it("keeps the computer-driven monks out of the coast road and the casino: random walks never leave the temple", () => {
    const random = seededRandom(31);
    const away = [COAST_ROAD, CASINO_YARD, CASINO_DOOR, ...CASINO_AREAS];
    for (let n = 0; n < 20_000; n += 1) {
      const point = randomWalkable(random);
      for (const area of away) {
        const inside = point.x > area.minX && point.x < area.maxX && point.z > area.minZ && point.z < area.maxZ;
        expect(inside, `(${point.x.toFixed(3)}, ${point.z.toFixed(3)}) is in the casino's ground`).toBe(false);
      }
      expect(point.z).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ);
    }
  });
});
