import { describe, expect, it } from "vitest";
import { PLAZA, WORLD_BOUNDS } from "@dongjane/shared";
import { CANOPY, SCREEN, STAGE, STAGE_YAW, TEMPLE, TEMPLE_DOOR_X, lanternSpots, screenCorners, stageToWorld, stringPoint } from "../src/game/venue-layout.ts";

describe("the stage", () => {
  it("turns its front toward the middle of the mats", () => {
    const front = stageToWorld(0, 1);
    const toward = { x: STAGE.aimX - STAGE.x, z: STAGE.aimZ - STAGE.z };
    const length = Math.hypot(toward.x, toward.z);
    expect(front.x - STAGE.x).toBeCloseTo(toward.x / length, 3);
    expect(front.z - STAGE.z).toBeCloseTo(toward.z / length, 3);
    expect(Math.abs(STAGE_YAW)).toBeGreaterThan(0.3);
  });

  it("keeps its deck off the plaza and out of the walkable area", () => {
    for (const u of [-1, 1]) {
      for (const v of [-1, 1]) {
        const corner = stageToWorld((u * STAGE.width) / 2, (v * STAGE.depth) / 2);
        expect(corner.z, `corner ${u},${v}`).toBeLessThan(WORLD_BOUNDS.minZ);
      }
    }
  });

  it("hangs a flat screen of the stated size, facing the audience", () => {
    const [bottomLeft, bottomRight, topRight, topLeft] = screenCorners();
    expect(Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.z - bottomLeft.z)).toBeCloseTo(SCREEN.width, 6);
    expect(topLeft.y - bottomLeft.y).toBeCloseTo(SCREEN.height, 6);
    expect(bottomLeft.y).toBe(SCREEN.bottom);
    expect(topRight.x).toBeCloseTo(bottomRight.x, 6);
    expect(topRight.z).toBeCloseTo(bottomRight.z, 6);
    expect(topLeft.x).toBeCloseTo(bottomLeft.x, 6);
    // The front normal is the left-to-right edge turned a quarter toward the audience; the aim point must lie on that side.
    const rightX = bottomRight.x - bottomLeft.x;
    const rightZ = bottomRight.z - bottomLeft.z;
    const facing = -rightZ * (STAGE.aimX - bottomLeft.x) + rightX * (STAGE.aimZ - bottomLeft.z);
    expect(facing).toBeGreaterThan(0);
  });
});

describe("the lantern canopy", () => {
  it("joins poles that exist and never the same pair twice", () => {
    const seen = new Set<string>();
    for (const [a, b] of CANOPY.strings) {
      expect(CANOPY.poles[a]).toBeDefined();
      expect(CANOPY.poles[b]).toBeDefined();
      expect(a).not.toBe(b);
      expect(seen.has(`${a}-${b}`)).toBe(false);
      seen.add(`${a}-${b}`);
    }
  });

  it("sags in the middle of a string and holds at its poles", () => {
    const from = { x: 0, z: 0 };
    const to = { x: 5, z: 0 };
    expect(stringPoint(from, to, 0).y).toBe(CANOPY.height);
    expect(stringPoint(from, to, 1).y).toBe(CANOPY.height);
    expect(stringPoint(from, to, 0.5).y).toBeCloseTo(CANOPY.height - CANOPY.sag, 9);
  });

  it("hangs a hundred and eighty lanterns, each on its string, the same way every time", () => {
    const spots = lanternSpots();
    expect(spots).toHaveLength(180);
    expect(lanternSpots()).toEqual(spots);
    for (const spot of spots) {
      expect(spot.y).toBeLessThanOrEqual(CANOPY.height);
      expect(spot.y).toBeGreaterThanOrEqual(CANOPY.height - CANOPY.sag - 1e-9);
      expect(spot.tone).toBeGreaterThanOrEqual(0);
      expect(spot.tone).toBeLessThan(1);
      expect(spot.scale).toBeGreaterThan(0.8);
    }
    const tones = new Set(spots.map((spot) => Math.floor(spot.tone * 6)));
    expect(tones.size).toBe(6);
  });
});

describe("the temple", () => {
  it("stands beside the plaza, its door wall facing it", () => {
    expect(TEMPLE.maxX).toBeLessThanOrEqual(PLAZA.minX + 0.2);
    expect(TEMPLE_DOOR_X).toBe(TEMPLE.maxX - TEMPLE.eave);
    expect(TEMPLE.doorZ - TEMPLE.doorWidth / 2).toBeGreaterThan(TEMPLE.minZ);
    expect(TEMPLE.doorZ + TEMPLE.doorWidth / 2).toBeLessThan(TEMPLE.maxZ);
    expect(TEMPLE.doorZ).toBeGreaterThanOrEqual(PLAZA.minZ);
    expect(TEMPLE.doorZ).toBeLessThanOrEqual(PLAZA.maxZ);
  });
});
