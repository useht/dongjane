import { describe, expect, it } from "vitest";
import {
  CASINO_FLOOR,
  CASINO_DOOR,
  CASINO_YARD,
  COAST_ROAD,
  MACHINE_KINDS,
  MACHINE_REACH,
  MACHINE_SIZE,
  MACHINE_SPOTS,
  type MachineKind,
  insideCasino,
  machineFootprint,
  machineNear,
  machineSpot,
} from "../src/casino-layout.ts";
import { type Bounds, DHARMA_SEATS, SHORE, WORLD_BOUNDS, yawFromDirection } from "../src/layout.ts";
import { COURT_AREA, DOORWAY_AREA, INTERIOR_AREA, PLAZA_AREA, type Point, planPath, resolveWalkable } from "../src/walk.ts";

const CHAIN: Bounds[] = [INTERIOR_AREA, DOORWAY_AREA, COURT_AREA, PLAZA_AREA, SHORE, COAST_ROAD, CASINO_YARD, CASINO_DOOR, CASINO_FLOOR];

function walkable(point: Point): boolean {
  const solid = resolveWalkable(point.x, point.z);
  return Math.hypot(solid.x - point.x, solid.z - point.z) < 1e-4;
}

function overlapArea(a: Bounds, b: Bounds): number {
  const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return x > 0 && z > 0 ? x * z : 0;
}

const corners = (area: Bounds): Point[] => [
  { x: area.minX, z: area.minZ },
  { x: area.minX, z: area.maxZ },
  { x: area.maxX, z: area.minZ },
  { x: area.maxX, z: area.maxZ },
  { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 },
];

describe("the machines", () => {
  it("number twelve: three classic, two five-reel, two lucky-seven, two roulette and three scratch", () => {
    const count = (kind: MachineKind) => MACHINE_SPOTS.filter((spot) => spot.kind === kind).length;
    expect(MACHINE_SPOTS).toHaveLength(12);
    expect(MACHINE_KINDS.map(count)).toEqual([3, 2, 2, 2, 3]);
    expect(new Set(MACHINE_SPOTS.map((spot) => spot.id)).size).toBe(12);
    for (const spot of MACHINE_SPOTS) expect(spot.id.startsWith(spot.kind)).toBe(true);
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

  it("stands every front point on the floor, on walkable ground, in line with its machine", () => {
    for (const spot of MACHINE_SPOTS) {
      const front = { x: spot.frontX, z: spot.frontZ };
      expect(walkable(front), spot.id).toBe(true);
      expect(insideCasino(front.x, front.z), spot.id).toBe(true);
      expect(spot.frontZ).toBe(spot.z);
    }
  });

  it("keeps every footprint off the walkable ground", () => {
    for (const spot of MACHINE_SPOTS) {
      const box = machineFootprint(spot);
      for (const point of corners(box)) {
        const solid = resolveWalkable(point.x, point.z);
        expect(Math.hypot(solid.x - point.x, solid.z - point.z), `${spot.id} at (${point.x}, ${point.z})`).toBeGreaterThan(0.15);
      }
      for (const area of CHAIN) expect(overlapArea(box, area), `${spot.id} overlaps an area`).toBe(0);
    }
  });

  it("keeps the machines apart, in two bays beside the aisle and within the casino's depth", () => {
    MACHINE_SPOTS.forEach((a, i) => {
      for (const b of MACHINE_SPOTS.slice(i + 1)) {
        expect(overlapArea(machineFootprint(a), machineFootprint(b)), `${a.id} and ${b.id}`).toBe(0);
      }
    });
    for (const spot of MACHINE_SPOTS) {
      const box = machineFootprint(spot);
      expect(box.minZ).toBeGreaterThanOrEqual(CASINO_FLOOR.minZ + 1);
      expect(box.maxZ).toBeLessThanOrEqual(CASINO_FLOOR.maxZ - 1);
      if (spot.frontX < CASINO_FLOOR.minX + 1.5) {
        expect(box.maxX).toBeLessThanOrEqual(CASINO_FLOOR.minX);
        expect(box.minX).toBeGreaterThanOrEqual(6);
      } else {
        expect(box.minX).toBeGreaterThanOrEqual(CASINO_FLOOR.maxX);
        expect(box.maxX).toBeLessThanOrEqual(16.5);
      }
    }
  });

  it("faces each machine across the aisle toward its front point", () => {
    for (const spot of MACHINE_SPOTS) {
      expect(spot.yaw).toBeCloseTo(yawFromDirection(spot.frontX - spot.x, spot.frontZ - spot.z), 9);
      const box = machineFootprint(spot);
      if (spot.frontX > spot.x) expect(spot.frontX - box.maxX).toBeGreaterThan(0.5);
      else expect(box.minX - spot.frontX).toBeGreaterThan(0.5);
    }
    const west = MACHINE_SPOTS.filter((spot) => spot.frontX > spot.x);
    const east = MACHINE_SPOTS.filter((spot) => spot.frontX < spot.x);
    expect(west).toHaveLength(6);
    expect(east).toHaveLength(6);
    expect(new Set(west.map((spot) => spot.yaw)).size).toBe(1);
    expect(new Set(east.map((spot) => spot.yaw)).size).toBe(1);
    expect(west[0]!.yaw).not.toBeCloseTo(east[0]!.yaw, 3);
  });

  it("leaves room for a visitor at every front point, apart from the next one", () => {
    for (const a of MACHINE_SPOTS) {
      for (const b of MACHINE_SPOTS) {
        if (a === b || a.frontX !== b.frontX) continue;
        expect(Math.abs(a.frontZ - b.frontZ), `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("walking to a machine", () => {
  it("leads from a seat in the 법당 to the front point of every machine", () => {
    const seat = DHARMA_SEATS[24]!;
    for (const spot of MACHINE_SPOTS) {
      const path = planPath(seat, { x: spot.frontX, z: spot.frontZ });
      expect(path.at(-1), spot.id).toEqual({ x: spot.frontX, z: spot.frontZ });
      for (const corner of path) expect(walkable(corner)).toBe(true);
    }
  });

  it("lets a visitor at the front point play that machine and no other", () => {
    for (const spot of MACHINE_SPOTS) expect(machineNear(spot.frontX, spot.frontZ)?.id).toBe(spot.id);
  });

  it("reaches no machine from the doorway, the yard or the middle of the aisle", () => {
    expect(machineNear(11.25, 41)).toBeUndefined();
    expect(machineNear(11.25, 50)).toBeUndefined();
    expect(machineNear(CASINO_YARD.minX + 1, CASINO_YARD.minZ + 1)).toBeUndefined();
    expect(machineNear(0, 0)).toBeUndefined();
  });

  it("reaches a machine from just beside its front point and not from beyond the reach", () => {
    const spot = machineSpot("fiveReel-1")!;
    expect(machineNear(spot.frontX + MACHINE_REACH - 0.05, spot.frontZ)?.id).toBe("fiveReel-1");
    expect(machineNear(spot.frontX + MACHINE_REACH + 0.2, spot.frontZ)).toBeUndefined();
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
    expect(WORLD_BOUNDS.maxZ).toBeLessThan(CASINO_FLOOR.minZ - 20);
  });
});
