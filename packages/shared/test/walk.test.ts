import { describe, expect, it } from "vitest";
import { DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_SEATS, GATBAWI_SEATS, WORLD_BOUNDS } from "../src/layout.ts";
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
  zoneAt,
} from "../src/walk.ts";

const CHAIN = [INTERIOR_AREA, DOORWAY_AREA, COURT_AREA, PLAZA_AREA];

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
  it("chains the room, the doorway, the court and the plaza so that each touches the next", () => {
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

describe("zoneAt", () => {
  it("is the 법당 only inside its walls", () => {
    expect(zoneAt(DHARMA_ORIGIN.x, DHARMA_ORIGIN.z)).toBe("dharma");
    expect(zoneAt(DHARMA_BOUNDS.minX, DHARMA_BOUNDS.minZ)).toBe("dharma");
    expect(zoneAt(DHARMA_BOUNDS.maxX + 0.5, DHARMA_ORIGIN.z)).toBe("gatbawi");
    expect(zoneAt(COURT_AREA.minX + 1, DHARMA_ORIGIN.z)).toBe("gatbawi");
    expect(zoneAt(0, 14)).toBe("gatbawi");
    expect(zoneAt(-100, -100)).toBe("gatbawi");
  });

  it("forgives the float32 rounding of a monk standing on a wall line", () => {
    expect(zoneAt(Math.fround(DHARMA_BOUNDS.maxX), Math.fround(DHARMA_BOUNDS.maxZ))).toBe("dharma");
  });
});

describe("resolveWalkable", () => {
  it("leaves walkable points alone and pulls the rest back to the nearest ground", () => {
    expect(resolveWalkable(1, 2)).toEqual({ x: 1, z: 2 });
    expect(resolveWalkable(100, 100)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ });
    expect(resolveWalkable(-100, -100)).toEqual({ x: DHARMA_BOUNDS.minX, z: DHARMA_BOUNDS.minZ });
    expect(resolveWalkable(DOORWAY_AREA.maxX - 0.5, DHARMA_ORIGIN.z)).toEqual({ x: DOORWAY_AREA.maxX - 0.5, z: DHARMA_ORIGIN.z });
    expect(resolveWalkable(500, -500)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.minZ });
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
    expect(resolveNearby(100, 100, { x: 500, z: 500 })).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ });
  });
});

describe("random points", () => {
  it("picks a point of an area from two draws", () => {
    const draws = [0, 1];
    const point = randomPointIn(INTERIOR_AREA, () => draws.shift()!);
    expect(point.x).toBeCloseTo(INTERIOR_AREA.minX, 9);
    expect(point.z).toBeCloseTo(INTERIOR_AREA.maxZ, 9);
  });

  it("spreads walkable points over every area in proportion to its size", () => {
    const random = seededRandom(5);
    const hits = CHAIN.map(() => 0);
    const total = 20_000;
    for (let n = 0; n < total; n += 1) {
      const point = randomWalkable(random);
      expect(walkable(point), `(${point.x.toFixed(3)}, ${point.z.toFixed(3)}) is inside a wall`).toBe(true);
      const index = CHAIN.findIndex(
        (area) => point.x >= area.minX && point.x <= area.maxX && point.z >= area.minZ && point.z <= area.maxZ,
      );
      hits[index] = (hits[index] ?? 0) + 1;
    }
    const size = (area: (typeof CHAIN)[number]) => (area.maxX - area.minX) * (area.maxZ - area.minZ);
    const whole = CHAIN.reduce((sum, area) => sum + size(area), 0);
    CHAIN.forEach((area, index) => {
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
    const path = planPath({ x: 0, z: 14 }, { x: 500, z: 500 });
    expect(path.at(-1)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ });
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
    const pick = (): Point => ({ x: -34 + random() * 50, z: -14 + random() * 36 });
    for (let n = 0; n < 400; n += 1) {
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
    expect(zoneAt(inside.x, inside.z)).toBe("dharma");
    const out = slideWalkable(inside, 3, 0);
    expect(out.x).toBeCloseTo(inside.x + 3, 6);
  });

  it("ends exactly on the wall when a slanted push runs into it a hair away", () => {
    const slid = slideWalkable({ x: WORLD_BOUNDS.maxX - 0.015, z: 5 }, 0.05, 0.05);
    expect(slid.x).toBe(WORLD_BOUNDS.maxX);
    expect(slid.z).toBeCloseTo(5.05, 9);
  });

  it("stays put when it is pushed straight out of the world", () => {
    const edge = { x: WORLD_BOUNDS.maxX, z: 5 };
    expect(slideWalkable(edge, 2, 0)).toEqual(edge);
  });
});
