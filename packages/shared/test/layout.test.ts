import { describe, expect, it } from "vitest";
import {
  GATBAWI_Z,
  MAT_COLUMN_X,
  MAT_COUNT,
  MAT_ROW_Z,
  MAT_SIZE,
  MAT_SPOTS,
  MAT_YAW,
  PLATFORM,
  PLAZA,
  SPAWN_POINT,
  STEPS,
  WORLD_BOUNDS,
  matSpot,
  worldName,
  lerpAngle,
  resolveWalkable,
  wrapAngle,
  yawFromDirection,
} from "../src/index.ts";

describe("layout", () => {
  it("defines twelve mats in three rows of four, one per seat", () => {
    expect(MAT_COUNT).toBe(12);
    expect(MAT_SPOTS.map((spot) => spot.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(MAT_ROW_Z).toEqual([-1, 0.8, 2.6]);
    expect(MAT_COLUMN_X).toEqual([-2.25, -0.75, 0.75, 2.25]);
    expect(new Set(MAT_SPOTS.map((spot) => spot.z))).toEqual(new Set(MAT_ROW_Z));
    expect(MAT_SPOTS.filter((spot) => spot.z === -1).map((spot) => spot.x)).toEqual([...MAT_COLUMN_X]);
    expect(MAT_SPOTS[0]).toEqual({ id: 0, x: -2.25, z: -1 });
    expect(MAT_SPOTS[11]).toEqual({ id: 11, x: 2.25, z: 2.6 });
  });

  it("keeps the mats apart and on the plaza, clear of the steps", () => {
    for (const spot of MAT_SPOTS) {
      expect(resolveWalkable(spot.x, spot.z)).toEqual({ x: spot.x, z: spot.z });
      expect(spot.z - MAT_SIZE.z / 2).toBeGreaterThan(STEPS.maxZ);
      expect(spot.z + MAT_SIZE.z / 2).toBeLessThanOrEqual(PLAZA.maxZ);
      expect(Math.abs(spot.x) + MAT_SIZE.x / 2).toBeLessThanOrEqual(WORLD_BOUNDS.maxX);
    }
    for (const a of MAT_SPOTS) {
      for (const b of MAT_SPOTS) {
        if (a.id >= b.id) continue;
        const apartX = Math.abs(a.x - b.x) >= MAT_SIZE.x;
        const apartZ = Math.abs(a.z - b.z) >= MAT_SIZE.z;
        expect(apartX || apartZ, `mats ${a.id} and ${b.id} overlap`).toBe(true);
      }
    }
  });

  it("faces every mat toward Gatbawi", () => {
    expect(MAT_YAW).toBeCloseTo(yawFromDirection(0, -1));
    for (const spot of MAT_SPOTS) {
      expect(GATBAWI_Z).toBeLessThan(spot.z - MAT_SIZE.z / 2);
    }
  });

  it("lays the platform, steps and plaza end to end from Gatbawi", () => {
    expect(PLATFORM.maxZ).toBe(STEPS.minZ);
    expect(STEPS.maxZ).toBe(PLAZA.minZ);
    expect(GATBAWI_Z).toBeGreaterThan(PLATFORM.minZ);
    expect(GATBAWI_Z).toBeLessThan(PLATFORM.maxZ);
    expect(PLATFORM.topY).toBeCloseTo(1.2);
    expect(SPAWN_POINT).toEqual({ x: 0, z: 4.4 });
    expect(resolveWalkable(SPAWN_POINT.x, SPAWN_POINT.z)).toEqual(SPAWN_POINT);
  });

  it("looks up mats by id and rejects bad ids", () => {
    expect(matSpot(0)).toEqual({ id: 0, x: -2.25, z: -1 });
    expect(matSpot(11)).toEqual({ id: 11, x: 2.25, z: 2.6 });
    expect(matSpot(12)).toBeUndefined();
    expect(matSpot(-1)).toBeUndefined();
    expect(matSpot(1.5)).toBeUndefined();
    expect(matSpot(Number.NaN)).toBeUndefined();
  });

  it("clamps points to the world bounds", () => {
    expect(resolveWalkable(100, 100)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ });
    expect(resolveWalkable(-100, -100)).toEqual({ x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.minZ });
    expect(resolveWalkable(1, 2)).toEqual({ x: 1, z: 2 });
  });

  it("names worlds in Korean", () => {
    expect(worldName(3)).toBe("3번 월드");
  });

  it("faces yaw 0 toward Gatbawi at -z", () => {
    expect(yawFromDirection(0, -1)).toBeCloseTo(0);
    expect(yawFromDirection(1, 0)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(yawFromDirection(0, 1))).toBeCloseTo(Math.PI);
  });

  it("wraps and interpolates angles the short way", () => {
    expect(wrapAngle(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 5);
    expect(wrapAngle(-2.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 5);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5);
    const from = Math.PI - 0.1;
    const to = -Math.PI + 0.1;
    expect(Math.abs(lerpAngle(from, to, 0.5) - Math.PI)).toBeLessThan(1e-6);
  });
});
