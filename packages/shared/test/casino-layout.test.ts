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
  MACHINE_KINDS,
  MACHINE_REACH,
  MACHINE_SIZE,
  MACHINE_SPOTS,
  type MachineKind,
  type MachineSpot,
  insideCasino,
  machineFootprint,
  machineNear,
  machineSpot,
} from "../src/casino-layout.ts";
import { type Bounds, DHARMA_SEATS, SHORE, WORLD_BOUNDS, yawFromDirection } from "../src/layout.ts";
import { COURT_AREA, DOORWAY_AREA, INTERIOR_AREA, PLAZA_AREA, type Point, planPath, resolveWalkable } from "../src/walk.ts";

const AREAS: Bounds[] = [INTERIOR_AREA, DOORWAY_AREA, COURT_AREA, PLAZA_AREA, SHORE, COAST_ROAD, CASINO_YARD, CASINO_DOOR, ...CASINO_AREAS];

function walkable(point: Point): boolean {
  const solid = resolveWalkable(point.x, point.z);
  return Math.hypot(solid.x - point.x, solid.z - point.z) < 1e-4;
}

function overlapArea(a: Bounds, b: Bounds): number {
  const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return x > 0 && z > 0 ? x * z : 0;
}

// The shortest distance between two rectangles (0 when they touch or overlap).
function gapBetween(a: Bounds, b: Bounds): number {
  const x = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const z = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(x, z);
}

const corners = (area: Bounds): Point[] => [
  { x: area.minX, z: area.minZ },
  { x: area.minX, z: area.maxZ },
  { x: area.maxX, z: area.minZ },
  { x: area.maxX, z: area.maxZ },
  { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 },
];

const facesEast = (spot: MachineSpot): boolean => spot.frontX > spot.x;
const rowsOf = (): Map<number, MachineSpot[]> => {
  const rows = new Map<number, MachineSpot[]>();
  for (const spot of MACHINE_SPOTS) rows.set(spot.frontX, [...(rows.get(spot.frontX) ?? []), spot]);
  return rows;
};

describe("the machines", () => {
  it("number at least fifty, of every kind, so fifty visitors can each play at once", () => {
    const count = (kind: MachineKind) => MACHINE_SPOTS.filter((spot) => spot.kind === kind).length;
    expect(MACHINE_SPOTS.length).toBeGreaterThanOrEqual(50);
    for (const kind of MACHINE_KINDS) expect(count(kind), kind).toBeGreaterThanOrEqual(2);
    expect(MACHINE_KINDS.map(count).reduce((sum, n) => sum + n, 0)).toBe(MACHINE_SPOTS.length);
    expect(new Set(MACHINE_SPOTS.map((spot) => spot.id)).size).toBe(MACHINE_SPOTS.length);
    for (const spot of MACHINE_SPOTS) expect(spot.id.startsWith(`${spot.kind}-`), spot.id).toBe(true);
  });

  it("numbers each kind from 1 without gaps", () => {
    for (const kind of MACHINE_KINDS) {
      const ids = MACHINE_SPOTS.filter((spot) => spot.kind === kind).map((spot) => spot.id);
      expect(ids).toEqual(ids.map((_, i) => `${kind}-${i + 1}`));
    }
  });

  it("finds a machine by its id", () => {
    expect(machineSpot("roulette-2")?.kind).toBe("roulette");
    expect(machineSpot("scratch-3")).toBe(MACHINE_SPOTS.find((spot) => spot.id === "scratch-3"));
    expect(machineSpot("poker-1")).toBeUndefined();
  });

  it("sizes each footprint by its kind and centres it on the machine", () => {
    for (const spot of MACHINE_SPOTS) {
      const box = machineFootprint(spot);
      const { width, depth } = MACHINE_SIZE[spot.kind];
      expect(box.maxX - box.minX).toBeCloseTo(depth, 9);
      expect(box.maxZ - box.minZ).toBeCloseTo(width, 9);
      expect((box.minX + box.maxX) / 2).toBeCloseTo(spot.x, 9);
      expect((box.minZ + box.maxZ) / 2).toBeCloseTo(spot.z, 9);
    }
  });

  it("stands every front point on an aisle, on walkable ground, in line with its machine", () => {
    for (const spot of MACHINE_SPOTS) {
      const front = { x: spot.frontX, z: spot.frontZ };
      expect(walkable(front), spot.id).toBe(true);
      expect(insideCasino(front.x, front.z), spot.id).toBe(true);
      expect(spot.frontZ).toBe(spot.z);
      const aisle = [CASINO_AISLE_WEST, CASINO_AISLE_EAST].find((area) => front.x > area.minX && front.x < area.maxX && front.z > area.minZ && front.z < area.maxZ);
      expect(aisle, `${spot.id} is on an aisle`).toBeDefined();
    }
  });

  it("keeps every footprint off the walkable ground, and well clear of it", () => {
    for (const spot of MACHINE_SPOTS) {
      const box = machineFootprint(spot);
      for (const point of corners(box)) {
        const solid = resolveWalkable(point.x, point.z);
        expect(Math.hypot(solid.x - point.x, solid.z - point.z), `${spot.id} at (${point.x}, ${point.z})`).toBeGreaterThan(0.15);
      }
      for (const area of AREAS) {
        expect(overlapArea(box, area), `${spot.id} overlaps an area`).toBe(0);
        expect(gapBetween(box, area), `${spot.id} touches an area`).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it("keeps the machines apart, in rows beside the two aisles and within the length of the aisles", () => {
    MACHINE_SPOTS.forEach((a, i) => {
      for (const b of MACHINE_SPOTS.slice(i + 1)) {
        expect(overlapArea(machineFootprint(a), machineFootprint(b)), `${a.id} and ${b.id}`).toBe(0);
      }
    });
    for (const spot of MACHINE_SPOTS) {
      const box = machineFootprint(spot);
      expect(box.minZ, spot.id).toBeGreaterThanOrEqual(CASINO_AISLE_WEST.minZ + 0.3);
      expect(box.maxZ, spot.id).toBeLessThanOrEqual(CASINO_AISLE_WEST.maxZ - 0.3);
      const west = box.maxX <= CASINO_AISLE_WEST.minX;
      const island = box.minX >= CASINO_AISLE_WEST.maxX && box.maxX <= CASINO_AISLE_EAST.minX;
      const east = box.minX >= CASINO_AISLE_EAST.maxX;
      expect(west || island || east, `${spot.id} stands in a row`).toBe(true);
      if (west) expect(box.minX, spot.id).toBeGreaterThanOrEqual(CASINO_AISLE_WEST.minX - 1.1);
      if (east) expect(box.maxX, spot.id).toBeLessThanOrEqual(CASINO_AISLE_EAST.maxX + 1.1);
    }
  });

  it("fills four rows: both sides of each aisle", () => {
    const rows = rowsOf();
    expect([...rows.keys()].sort((a, b) => a - b)).toHaveLength(4);
    for (const row of rows.values()) expect(row.length).toBeGreaterThanOrEqual(10);
    const [west, ...rest] = [...rows.keys()].sort((a, b) => a - b);
    expect(west).toBeGreaterThan(CASINO_AISLE_WEST.minX);
    expect(rest.at(-1)).toBeLessThan(CASINO_AISLE_EAST.maxX);
    const row = (x: number) => (rows.get(x) as MachineSpot[]).length;
    const sorted = [...rows.keys()].sort((a, b) => a - b);
    expect(row(sorted[0] as number)).toBeGreaterThanOrEqual(14);
    expect(row(sorted[3] as number)).toBeGreaterThanOrEqual(14);
  });

  it("faces each machine across the aisle toward its front point", () => {
    for (const spot of MACHINE_SPOTS) {
      expect(spot.yaw).toBeCloseTo(yawFromDirection(spot.frontX - spot.x, spot.frontZ - spot.z), 9);
      const box = machineFootprint(spot);
      if (facesEast(spot)) expect(spot.frontX - box.maxX, spot.id).toBeGreaterThan(0.5);
      else expect(box.minX - spot.frontX, spot.id).toBeGreaterThan(0.5);
    }
    const east = MACHINE_SPOTS.filter(facesEast);
    const west = MACHINE_SPOTS.filter((spot) => !facesEast(spot));
    expect(east.length).toBeGreaterThanOrEqual(20);
    expect(west.length).toBeGreaterThanOrEqual(20);
    expect(new Set(east.map((spot) => spot.yaw)).size).toBe(1);
    expect(new Set(west.map((spot) => spot.yaw)).size).toBe(1);
    expect(east[0]!.yaw).not.toBeCloseTo(west[0]!.yaw, 3);
  });

  it("lets a roulette table fill the island's whole depth, with no machine behind it", () => {
    const tables = MACHINE_SPOTS.filter((spot) => spot.kind === "roulette");
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const table of tables) {
      const box = machineFootprint(table);
      expect(box.minX).toBeCloseTo(CASINO_AISLE_WEST.maxX + 0.2, 9);
      expect(box.maxX).toBeCloseTo(CASINO_AISLE_EAST.minX - 0.2, 9);
    }
  });

  it("leaves room for a visitor at every front point, apart from the next one", () => {
    for (const a of MACHINE_SPOTS) {
      for (const b of MACHINE_SPOTS) {
        if (a === b || a.frontX !== b.frontX) continue;
        expect(Math.abs(a.frontZ - b.frontZ), `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });

  it("keeps the two sides of an aisle too far apart for one spot to reach a machine on each", () => {
    for (const aisle of [CASINO_AISLE_WEST, CASINO_AISLE_EAST]) {
      const fronts = [...new Set(MACHINE_SPOTS.map((spot) => spot.frontX))].filter((x) => x > aisle.minX && x < aisle.maxX);
      expect(fronts).toHaveLength(2);
      const middle = (aisle.minX + aisle.maxX) / 2;
      for (const x of fronts) expect(Math.abs(x - middle)).toBeGreaterThan(MACHINE_REACH);
    }
  });
});

describe("the floor", () => {
  it("is a ring: the lobby, the west aisle, the cross room and the east aisle, each touching the next", () => {
    const ring = [CASINO_LOBBY, CASINO_AISLE_WEST, CASINO_CROSS, CASINO_AISLE_EAST, CASINO_LOBBY];
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i] as Bounds;
      const b = ring[i + 1] as Bounds;
      const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const along = Math.abs(a.maxZ - b.minZ) < 1e-9 || Math.abs(b.maxZ - a.minZ) < 1e-9;
      expect(along, `link ${i} meets end to end`).toBe(true);
      expect(width, `link ${i}`).toBeGreaterThanOrEqual(2.6);
    }
  });

  it("bounds the four areas by CASINO_FLOOR", () => {
    for (const area of CASINO_AREAS) {
      expect(area.minX).toBeGreaterThanOrEqual(CASINO_FLOOR.minX);
      expect(area.maxX).toBeLessThanOrEqual(CASINO_FLOOR.maxX);
      expect(area.minZ).toBeGreaterThanOrEqual(CASINO_FLOOR.minZ);
      expect(area.maxZ).toBeLessThanOrEqual(CASINO_FLOOR.maxZ);
    }
  });

  it("puts the road, the yard, the doorway and the east aisle on one centre line, with the lobby across it", () => {
    const middle = (area: Bounds) => (area.minX + area.maxX) / 2;
    for (const area of [COAST_ROAD, CASINO_YARD, CASINO_DOOR, CASINO_AISLE_EAST]) expect(middle(area)).toBeCloseTo(CASINO_LINE_X, 9);
    expect(CASINO_LOBBY.minX).toBeLessThan(CASINO_DOOR.minX);
    expect(CASINO_LOBBY.maxX).toBeGreaterThan(CASINO_DOOR.maxX);
  });
});

describe("walking to a machine", () => {
  it("leads from a seat in the 법당 to the front point of every machine, on ground all the way", () => {
    const seat = DHARMA_SEATS[24]!;
    for (const spot of MACHINE_SPOTS) {
      const path = planPath(seat, { x: spot.frontX, z: spot.frontZ });
      expect(path.at(-1), spot.id).toEqual({ x: spot.frontX, z: spot.frontZ });
      let previous: Point = seat;
      for (const corner of path) {
        for (let step = 0; step <= 10; step += 1) {
          const t = step / 10;
          const point = { x: previous.x + (corner.x - previous.x) * t, z: previous.z + (corner.z - previous.z) * t };
          expect(walkable(point), `${spot.id} at (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`).toBe(true);
        }
        previous = corner;
      }
    }
  });

  it("lets a visitor at the front point play that machine and no other", () => {
    for (const spot of MACHINE_SPOTS) expect(machineNear(spot.frontX, spot.frontZ)?.id).toBe(spot.id);
  });

  it("reaches no machine from the doorway, the yard, the lobby or the middle of an aisle", () => {
    expect(machineNear(CASINO_LINE_X, CASINO_DOOR.minZ + 1)).toBeUndefined();
    expect(machineNear(CASINO_LINE_X, 42)).toBeUndefined();
    expect(machineNear(9, 42)).toBeUndefined();
    expect(machineNear((CASINO_AISLE_WEST.minX + CASINO_AISLE_WEST.maxX) / 2, 54)).toBeUndefined();
    expect(machineNear(CASINO_LINE_X, 54)).toBeUndefined();
    expect(machineNear(11.4, CASINO_CROSS.minZ + 1.5)).toBeUndefined();
    expect(machineNear(CASINO_YARD.minX + 1, CASINO_YARD.minZ + 1)).toBeUndefined();
    expect(machineNear(0, 0)).toBeUndefined();
  });

  it("reaches a machine from just beside its front point and not from beyond the reach", () => {
    const spot = machineSpot("fiveReel-1")!;
    const toward = facesEast(spot) ? 1 : -1;
    expect(machineNear(spot.frontX + toward * (MACHINE_REACH - 0.05), spot.frontZ)?.id).toBe("fiveReel-1");
    expect(machineNear(spot.frontX + toward * (MACHINE_REACH + 0.2), spot.frontZ)).toBeUndefined();
  });

  it("is a walk of tens of metres from the plaza, not a step", () => {
    const path = planPath({ x: 0, z: 14 }, { x: 9, z: 42.4 });
    let length = 0;
    let at: Point = { x: 0, z: 14 };
    for (const corner of path) {
      length += Math.hypot(corner.x - at.x, corner.z - at.z);
      at = corner;
    }
    expect(length).toBeGreaterThan(30);
    expect(WORLD_BOUNDS.maxZ).toBeLessThan(CASINO_LOBBY.minZ - 20);
  });
});
