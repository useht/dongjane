import { describe, expect, it } from "vitest";
import {
  MAT_COUNT,
  MAT_SPOTS,
  WALK_BOUNDS,
  matSpot,
  worldName,
  lerpAngle,
  resolveWalkable,
  wrapAngle,
  yawFromDirection,
} from "../src/index.ts";

describe("layout", () => {
  it("defines eight mats in two rows of four, all inside the walkable rect", () => {
    expect(MAT_COUNT).toBe(8);
    expect(new Set(MAT_SPOTS.map((spot) => spot.id)).size).toBe(8);
    expect(new Set(MAT_SPOTS.map((spot) => spot.z))).toEqual(new Set([-1.2, 1.2]));
    expect(MAT_SPOTS.filter((spot) => spot.z === -1.2).map((spot) => spot.x)).toEqual([-3, -1, 1, 3]);
    for (const spot of MAT_SPOTS) {
      expect(resolveWalkable(spot.x, spot.z)).toEqual({ x: spot.x, z: spot.z });
    }
  });

  it("looks up mats by id and rejects bad ids", () => {
    expect(matSpot(0)).toEqual({ id: 0, x: -3, z: -1.2 });
    expect(matSpot(7)).toEqual({ id: 7, x: 3, z: 1.2 });
    expect(matSpot(8)).toBeUndefined();
    expect(matSpot(-1)).toBeUndefined();
    expect(matSpot(1.5)).toBeUndefined();
    expect(matSpot(Number.NaN)).toBeUndefined();
  });

  it("clamps points to the walkable rect", () => {
    expect(resolveWalkable(100, 100)).toEqual({ x: WALK_BOUNDS.maxX, z: WALK_BOUNDS.maxZ });
    expect(resolveWalkable(-100, -100)).toEqual({ x: WALK_BOUNDS.minX, z: WALK_BOUNDS.minZ });
    expect(resolveWalkable(1, 2)).toEqual({ x: 1, z: 2 });
  });

  it("names worlds in Korean", () => {
    expect(worldName(3)).toBe("3번 월드");
  });

  it("faces yaw 0 toward the Buddha at -z", () => {
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
