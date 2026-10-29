import { describe, expect, it } from "vitest";
import {
  DHARMA_BOUNDS,
  DHARMA_SEATS,
  DHARMA_SEAT_SIZE,
  GATBAWI_SEATS,
  GATBAWI_SEAT_SIZE,
  GATBAWI_Z,
  PLATFORM,
  PLAZA,
  SEAT_COUNT,
  SEAT_YAW,
  STEPS,
  WORLD_BOUNDS,
  ZONES,
  ZONE_BOUNDS,
  ZONE_CAPACITY,
  ZONE_SEATS,
  ZONE_SPAWN,
  isZone,
  lerpAngle,
  otherZone,
  pickSeat,
  resolveWalkable,
  seatKey,
  seatSpot,
  worldName,
  wrapAngle,
  yawFromDirection,
} from "../src/index.ts";

describe("zones", () => {
  it("names two zones and tells each from the other", () => {
    expect(ZONES).toEqual(["gatbawi", "dharma"]);
    expect(isZone("gatbawi")).toBe(true);
    expect(isZone("dharma")).toBe(true);
    expect(isZone("garden")).toBe(false);
    expect(isZone(undefined)).toBe(false);
    expect(otherZone("gatbawi")).toBe("dharma");
    expect(otherZone("dharma")).toBe("gatbawi");
  });

  it("seats exactly as many as each zone admits", () => {
    expect(SEAT_COUNT).toBe(50);
    expect(ZONE_CAPACITY).toBe(50);
    for (const zone of ZONES) expect(ZONE_SEATS[zone]).toHaveLength(ZONE_CAPACITY);
  });
});

describe("gatbawi seats", () => {
  it("lays fifty mats in ten rows of five, front row first", () => {
    expect(GATBAWI_SEATS.map((spot) => spot.id)).toEqual(Array.from({ length: 50 }, (_, id) => id));
    expect(GATBAWI_SEATS[0]).toMatchObject({ id: 0, x: -2.4, z: -1.3, row: 0, column: 0 });
    expect(GATBAWI_SEATS[2]).toMatchObject({ id: 2, x: 0, z: -1.3 });
    expect(GATBAWI_SEATS[49]).toMatchObject({ id: 49, x: 2.4, z: 11.75, row: 9, column: 4 });
    expect(new Set(GATBAWI_SEATS.map((spot) => spot.x))).toEqual(new Set([-2.4, -1.2, 0, 1.2, 2.4]));
    expect(new Set(GATBAWI_SEATS.map((spot) => spot.z)).size).toBe(10);
  });

  it("keeps the mats apart and on the plaza, clear of the steps", () => {
    for (const spot of GATBAWI_SEATS) {
      expect(resolveWalkable("gatbawi", spot.x, spot.z)).toEqual({ x: spot.x, z: spot.z });
      expect(spot.z - GATBAWI_SEAT_SIZE.z / 2).toBeGreaterThan(STEPS.maxZ);
      expect(spot.z + GATBAWI_SEAT_SIZE.z / 2).toBeLessThanOrEqual(PLAZA.maxZ);
    }
    for (const a of GATBAWI_SEATS) {
      for (const b of GATBAWI_SEATS) {
        if (a.id >= b.id) continue;
        const apartX = Math.abs(a.x - b.x) >= GATBAWI_SEAT_SIZE.x;
        const apartZ = Math.abs(a.z - b.z) >= GATBAWI_SEAT_SIZE.z;
        expect(apartX || apartZ, `mats ${a.id} and ${b.id} overlap`).toBe(true);
      }
    }
  });

  it("faces every mat toward Gatbawi", () => {
    expect(SEAT_YAW).toBeCloseTo(yawFromDirection(0, -1));
    for (const spot of GATBAWI_SEATS) expect(GATBAWI_Z).toBeLessThan(spot.z - GATBAWI_SEAT_SIZE.z / 2);
  });

  it("lays the platform, steps and plaza end to end from Gatbawi", () => {
    expect(PLATFORM.maxZ).toBe(STEPS.minZ);
    expect(STEPS.maxZ).toBe(PLAZA.minZ);
    expect(GATBAWI_Z).toBeGreaterThan(PLATFORM.minZ);
    expect(GATBAWI_Z).toBeLessThan(PLATFORM.maxZ);
    expect(PLATFORM.topY).toBeCloseTo(1.2);
    expect(WORLD_BOUNDS.maxZ).toBeLessThanOrEqual(PLAZA.maxZ);
    expect(WORLD_BOUNDS.minX).toBeGreaterThanOrEqual(PLAZA.minX);
    expect(WORLD_BOUNDS.maxX).toBeLessThanOrEqual(PLAZA.maxX);
  });
});

describe("dharma seats", () => {
  it("lays fifty 방석 in two blocks of five rows with an aisle down the middle", () => {
    expect(DHARMA_SEATS.map((spot) => spot.id)).toEqual(Array.from({ length: 50 }, (_, id) => id));
    expect(DHARMA_SEATS[0]).toMatchObject({ id: 0, x: -6.65, z: -2.6, row: 0, column: 0 });
    expect(DHARMA_SEATS[4]).toMatchObject({ id: 4, x: -1.45 });
    expect(DHARMA_SEATS[5]).toMatchObject({ id: 5, x: 1.45 });
    expect(DHARMA_SEATS[49]).toMatchObject({ id: 49, x: 6.65, z: 2.4, row: 4, column: 9 });
    expect(DHARMA_SEATS.some((spot) => Math.abs(spot.x) < 1)).toBe(false);
  });

  it("keeps the 방석 apart and inside the room", () => {
    for (const spot of DHARMA_SEATS) {
      expect(resolveWalkable("dharma", spot.x, spot.z)).toEqual({ x: spot.x, z: spot.z });
    }
    for (const a of DHARMA_SEATS) {
      for (const b of DHARMA_SEATS) {
        if (a.id >= b.id) continue;
        const apartX = Math.abs(a.x - b.x) >= DHARMA_SEAT_SIZE.x;
        const apartZ = Math.abs(a.z - b.z) >= DHARMA_SEAT_SIZE.z;
        expect(apartX || apartZ, `방석 ${a.id} and ${b.id} overlap`).toBe(true);
      }
    }
  });
});

describe("seats", () => {
  it("looks seats up by zone and id and rejects bad ids", () => {
    expect(seatSpot("gatbawi", 0)).toBe(GATBAWI_SEATS[0]);
    expect(seatSpot("dharma", 49)).toBe(DHARMA_SEATS[49]);
    expect(seatSpot("gatbawi", 50)).toBeUndefined();
    expect(seatSpot("dharma", -1)).toBeUndefined();
    expect(seatSpot("gatbawi", 1.5)).toBeUndefined();
    expect(seatSpot("gatbawi", Number.NaN)).toBeUndefined();
    expect(seatKey("gatbawi", 12)).toBe("gatbawi:12");
  });

  it("picks the free seat in the front row, then nearest the middle, then lowest id", () => {
    expect(pickSeat("gatbawi", () => false)?.id).toBe(2);
    expect(pickSeat("gatbawi", (id) => id === 2)?.id).toBe(1);
    expect(pickSeat("gatbawi", (id) => id === 2 || id === 1)?.id).toBe(3);
    expect(pickSeat("gatbawi", (id) => id < 5)?.id).toBe(7);
    expect(pickSeat("dharma", () => false)?.id).toBe(4);
    expect(pickSeat("dharma", (id) => id === 4)?.id).toBe(5);
    expect(pickSeat("dharma", (id) => id < 10)?.id).toBe(14);
    expect(pickSeat("gatbawi", () => true)).toBeUndefined();
  });

  it("fills a whole zone one pick at a time without repeating a seat", () => {
    for (const zone of ZONES) {
      const taken = new Set<number>();
      for (let i = 0; i < ZONE_CAPACITY; i += 1) {
        const spot = pickSeat(zone, (id) => taken.has(id));
        expect(spot).toBeDefined();
        expect(taken.has(spot!.id)).toBe(false);
        taken.add(spot!.id);
      }
      expect(pickSeat(zone, (id) => taken.has(id))).toBeUndefined();
    }
  });
});

describe("walking", () => {
  it("spawns each zone's visitors on walkable ground clear of every seat row's front", () => {
    for (const zone of ZONES) {
      const spawn = ZONE_SPAWN[zone];
      for (const x of [spawn.x - spawn.spread / 2, spawn.x + spawn.spread / 2]) {
        expect(resolveWalkable(zone, x, spawn.z)).toEqual({ x, z: spawn.z });
      }
    }
    expect(ZONE_SPAWN.gatbawi).toMatchObject({ x: 0, z: 14 });
    expect(ZONE_SPAWN.dharma).toMatchObject({ x: 0, z: 7.4 });
  });

  it("clamps points to each zone's bounds", () => {
    expect(resolveWalkable("gatbawi", 100, 100)).toEqual({ x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ });
    expect(resolveWalkable("gatbawi", -100, -100)).toEqual({ x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.minZ });
    expect(resolveWalkable("dharma", 100, 100)).toEqual({ x: DHARMA_BOUNDS.maxX, z: DHARMA_BOUNDS.maxZ });
    expect(resolveWalkable("dharma", -100, -100)).toEqual({ x: DHARMA_BOUNDS.minX, z: DHARMA_BOUNDS.minZ });
    expect(resolveWalkable("gatbawi", 1, 2)).toEqual({ x: 1, z: 2 });
    expect(ZONE_BOUNDS.gatbawi).toBe(WORLD_BOUNDS);
    expect(ZONE_BOUNDS.dharma).toBe(DHARMA_BOUNDS);
  });
});

describe("angles and names", () => {
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
