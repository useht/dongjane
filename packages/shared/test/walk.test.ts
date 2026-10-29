import { describe, expect, it } from "vitest";
import { DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_SEATS, GATBAWI_SEATS, WORLD_BOUNDS } from "../src/layout.ts";
import {
  COURT_AREA,
  DOORWAY_AREA,
  HOME_AREAS,
  INTERIOR_AREA,
  PLAZA_AREA,
  type Point,
  clampToHome,
  planPath,
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

  it("puts the doorway in the front wall of the room, in line with the middle of the floor", () => {
    expect(DOORWAY_AREA.minZ).toBe(DHARMA_BOUNDS.maxZ);
    expect((DOORWAY_AREA.minX + DOORWAY_AREA.maxX) / 2).toBe(DHARMA_ORIGIN.x);
    expect(DOORWAY_AREA.maxZ).toBe(COURT_AREA.minZ);
  });

  it("puts every seat on walkable ground", () => {
    for (const spot of [...GATBAWI_SEATS, ...DHARMA_SEATS]) expect(walkable(spot)).toBe(true);
  });
});

describe("zoneAt", () => {
  it("is the 법당 only inside its walls", () => {
    expect(zoneAt(DHARMA_ORIGIN.x, DHARMA_ORIGIN.z)).toBe("dharma");
    expect(zoneAt(DHARMA_BOUNDS.minX, DHARMA_BOUNDS.minZ)).toBe("dharma");
    expect(zoneAt(DHARMA_ORIGIN.x, DHARMA_BOUNDS.maxZ + 0.5)).toBe("gatbawi");
    expect(zoneAt(DHARMA_ORIGIN.x, COURT_AREA.minZ + 1)).toBe("gatbawi");
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
    expect(resolveWalkable(DHARMA_ORIGIN.x, DOORWAY_AREA.maxZ - 0.5)).toEqual({ x: DHARMA_ORIGIN.x, z: DOORWAY_AREA.maxZ - 0.5 });
    expect(resolveWalkable(500, -500)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.minZ });
  });

  it("keeps a point that sits in the court, in front of the wall", () => {
    expect(resolveWalkable(-22, 12)).toEqual({ x: -22, z: 12 });
    expect(resolveWalkable(-30, 12)).toEqual({ x: COURT_AREA.minX, z: 12 });
  });

  it("stops a walker against the front wall instead of pushing them through it", () => {
    const wallX = DHARMA_ORIGIN.x - 5;
    expect(resolveWalkable(wallX, 9)).toEqual({ x: wallX, z: DHARMA_BOUNDS.maxZ });
    expect(resolveWalkable(wallX, 10.5)).toEqual({ x: wallX, z: 10.5 });
  });

  it("prefers the area the walker stands in when two are equally near", () => {
    const inside = { x: DHARMA_ORIGIN.x - 5, z: DHARMA_BOUNDS.maxZ - 0.01 };
    const pressed = resolveWalkable(inside.x, DHARMA_BOUNDS.maxZ + (COURT_AREA.minZ - DHARMA_BOUNDS.maxZ) / 2, inside);
    expect(pressed.z).toBeLessThanOrEqual(DHARMA_BOUNDS.maxZ);
    const outside = { x: DHARMA_ORIGIN.x - 5, z: COURT_AREA.minZ + 0.01 };
    const other = resolveWalkable(outside.x, DHARMA_BOUNDS.maxZ + (COURT_AREA.minZ - DHARMA_BOUNDS.maxZ) / 2, outside);
    expect(other.z).toBeGreaterThanOrEqual(COURT_AREA.minZ);
  });

  it("clamps a computer-driven monk to its own zone", () => {
    expect(clampToHome("dharma", 100, 100)).toEqual({ x: DHARMA_BOUNDS.maxX, z: DHARMA_BOUNDS.maxZ });
    expect(clampToHome("gatbawi", -100, 100)).toEqual({ x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.maxZ });
    expect(HOME_AREAS.dharma).toBe(INTERIOR_AREA);
    expect(HOME_AREAS.gatbawi).toBe(PLAZA_AREA);
  });
});

describe("planPath", () => {
  it("is a single straight line inside one area", () => {
    expect(planPath({ x: 0, z: 14 }, { x: 3, z: 2 })).toEqual([{ x: 3, z: 2 }]);
    expect(planPath({ x: DHARMA_ORIGIN.x - 5, z: 0 }, { x: DHARMA_ORIGIN.x + 5, z: 4 })).toEqual([
      { x: DHARMA_ORIGIN.x + 5, z: 4 },
    ]);
  });

  it("ends at the nearest walkable point when the target is out of bounds", () => {
    const path = planPath({ x: 0, z: 14 }, { x: 500, z: 500 });
    expect(path.at(-1)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ });
  });

  it("leads from the plaza through the court and the doorway to a seat in the 법당", () => {
    const seat = DHARMA_SEATS[24]!;
    const from = { x: 0, z: 14 };
    const path = planPath(from, seat);
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path.at(-1)).toEqual({ x: seat.x, z: seat.z });
    const doorway = path.filter((p) => p.x > DOORWAY_AREA.minX && p.x < DOORWAY_AREA.maxX && p.z >= DHARMA_BOUNDS.maxZ - 1e-6);
    expect(doorway.length).toBeGreaterThan(0);
    assertWalkableRoute(from, path);
  });

  it("leads from a seat in the 법당 back out to the plaza the same way", () => {
    const seat = DHARMA_SEATS[3]!;
    const to = { x: 4, z: 12 };
    const path = planPath(seat, to);
    expect(path.at(-1)).toEqual(to);
    assertWalkableRoute(seat, path);
  });

  it("keeps every corner clear of the jambs of the doorway", () => {
    for (const from of [{ x: 6, z: 11 }, { x: -25, z: 12 }, { x: DHARMA_BOUNDS.minX + 0.2, z: -4 }]) {
      for (const to of [DHARMA_SEATS[0]!, DHARMA_SEATS[49]!, { x: DHARMA_ORIGIN.x, z: 0 }]) {
        for (const corner of planPath(from, to)) {
          if (corner.z > DHARMA_BOUNDS.maxZ && corner.z < COURT_AREA.minZ) {
            expect(corner.x).toBeGreaterThanOrEqual(DOORWAY_AREA.minX + 0.3);
            expect(corner.x).toBeLessThanOrEqual(DOORWAY_AREA.maxX - 0.3);
          }
        }
      }
    }
  });

  it("walks the shortest sensible way: no longer than the detour through the middle of the doorway", () => {
    const from = { x: 0, z: 14 };
    const to = { x: DHARMA_ORIGIN.x, z: 0 };
    const length = (corners: Point[]): number => {
      let total = 0;
      let at = from;
      for (const corner of corners) {
        total += Math.hypot(corner.x - at.x, corner.z - at.z);
        at = corner;
      }
      return total;
    };
    const detour = [{ x: DHARMA_ORIGIN.x, z: COURT_AREA.minZ + 0.5 }, to];
    expect(length(planPath(from, to))).toBeLessThanOrEqual(length(detour) + 1e-6);
  });

  it("never routes a random walk through a wall", () => {
    const random = seededRandom(2024);
    const pick = (): Point => ({ x: -34 + random() * 50, z: -9 + random() * 28 });
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
    const from = { x: DHARMA_ORIGIN.x - 6, z: COURT_AREA.minZ + 0.2 };
    const path = planPath(from, { x: DHARMA_ORIGIN.x - 6, z: 2 });
    assertWalkableRoute(from, path);
    expect(path.some((p) => p.x > DOORWAY_AREA.minX)).toBe(true);
  });
});

describe("slideWalkable", () => {
  it("walks the whole way when the ground allows it", () => {
    expect(slideWalkable({ x: 0, z: 14 }, 1, -2)).toEqual({ x: 1, z: 12 });
    expect(slideWalkable({ x: DHARMA_ORIGIN.x, z: 11 }, 0, -4)).toEqual({ x: DHARMA_ORIGIN.x, z: 7 });
  });

  it("stops at the front wall instead of being pulled through it", () => {
    const wallX = DHARMA_ORIGIN.x - 5;
    const stopped = slideWalkable({ x: wallX, z: COURT_AREA.minZ + 0.5 }, 0, -2);
    expect(stopped.x).toBeCloseTo(wallX, 6);
    expect(stopped.z).toBeCloseTo(COURT_AREA.minZ, 3);
  });

  it("slides along the wall when the push is slanted", () => {
    const from = { x: DHARMA_ORIGIN.x - 5, z: COURT_AREA.minZ + 0.01 };
    const slid = slideWalkable(from, -1, -1);
    expect(slid.x).toBeCloseTo(from.x - 1, 6);
    expect(slid.z).toBeGreaterThanOrEqual(COURT_AREA.minZ - 1e-3);
  });

  it("goes in through the doorway and out again", () => {
    const inside = slideWalkable({ x: DHARMA_ORIGIN.x, z: COURT_AREA.minZ + 0.5 }, 0, -3);
    expect(inside.z).toBeCloseTo(COURT_AREA.minZ + 0.5 - 3, 6);
    expect(zoneAt(inside.x, inside.z)).toBe("dharma");
    const out = slideWalkable(inside, 0, 3);
    expect(out.z).toBeCloseTo(inside.z + 3, 6);
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
