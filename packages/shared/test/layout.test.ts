import { describe, expect, it } from "vitest";
import {
  ARRIVAL,
  DHARMA_BOUNDS,
  DHARMA_ORIGIN,
  DHARMA_SEATS,
  DHARMA_SEAT_SIZE,
  DHARMA_YAW,
  FISHING_REACH,
  GATBAWI_SEATS,
  GATBAWI_SEAT_SIZE,
  GATBAWI_Z,
  PLATFORM,
  PLAZA,
  SEAT_COUNT,
  SEAT_YAWS,
  SEA_LINE_X,
  SHORE,
  STEPS,
  WORLD_BOUNDS,
  ZONES,
  ZONE_CAPACITY,
  ZONE_SEATS,
  canCastAt,
  dharmaToWorld,
  isZone,
  lerpAngle,
  pickSeat,
  resolveWalkable,
  seatKey,
  seatSpot,
  worldName,
  worldToDharma,
  wrapAngle,
  yawFromDirection,
  venueAt,
} from "../src/index.ts";

describe("zones", () => {
  it("names the zones and tells each from the other", () => {
    expect(ZONES).toEqual(["gatbawi", "dharma", "bathhouse"]);
    expect(isZone("gatbawi")).toBe(true);
    expect(isZone("dharma")).toBe(true);
    expect(isZone("garden")).toBe(false);
    expect(isZone(undefined)).toBe(false);
  });

  it("seats as many as each zone admits: fifty on the plaza and in the 법당, at most that in the others", () => {
    expect(SEAT_COUNT).toBe(50);
    expect(ZONE_CAPACITY).toBe(50);
    expect(ZONE_SEATS.gatbawi).toHaveLength(ZONE_CAPACITY);
    expect(ZONE_SEATS.dharma).toHaveLength(ZONE_CAPACITY);
    for (const zone of ZONES) expect(ZONE_SEATS[zone].length).toBeLessThanOrEqual(ZONE_CAPACITY);
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
      expect(resolveWalkable(spot.x, spot.z)).toEqual({ x: spot.x, z: spot.z });
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
    expect(SEAT_YAWS.gatbawi).toBeCloseTo(yawFromDirection(0, -1));
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
    expect(DHARMA_SEATS[0]).toMatchObject({ id: 0, x: -21.6, z: 6.65, row: 0, column: 0 });
    expect(DHARMA_SEATS[4]).toMatchObject({ id: 4, x: -21.6, z: 1.45 });
    expect(DHARMA_SEATS[5]).toMatchObject({ id: 5, x: -21.6, z: -1.45 });
    expect(DHARMA_SEATS[49]).toMatchObject({ id: 49, x: -16.6, z: -6.65, row: 4, column: 9 });
    expect(DHARMA_SEATS.some((spot) => Math.abs(spot.z - DHARMA_ORIGIN.z) < 1)).toBe(false);
  });

  it("puts the first row against the altar on the back wall and the last row nearest the door", () => {
    for (const spot of DHARMA_SEATS) expect(spot.x).toBeCloseTo(-21.6 + spot.row * 1.25, 9);
    expect(new Set(DHARMA_SEATS.map((spot) => spot.x)).size).toBe(5);
  });

  it("faces every 방석 at the altar on the back wall, which is on the -x side", () => {
    expect(SEAT_YAWS.dharma).toBe(DHARMA_YAW);
    expect(SEAT_YAWS.dharma).toBeCloseTo(yawFromDirection(-1, 0), 12);
    // yaw is the direction yawFromDirection inverts: a monk looking along (dx, dz) has yaw atan2(-dx, -dz).
    const lookX = -Math.sin(SEAT_YAWS.dharma);
    const lookZ = -Math.cos(SEAT_YAWS.dharma);
    expect(lookX).toBeCloseTo(-1, 12);
    expect(lookZ).toBeCloseTo(0, 12);
    for (const spot of DHARMA_SEATS) {
      expect((DHARMA_BOUNDS.minX - spot.x) * lookX, `방석 ${spot.id} looks away from the altar`).toBeGreaterThan(0);
      expect((DHARMA_BOUNDS.maxX - spot.x) * lookX, `방석 ${spot.id} looks at the door`).toBeLessThan(0);
    }
  });

  it("keeps the 방석 apart and inside the room", () => {
    for (const spot of DHARMA_SEATS) {
      expect(resolveWalkable(spot.x, spot.z)).toEqual({ x: spot.x, z: spot.z });
      expect(spot.x).toBeGreaterThan(DHARMA_BOUNDS.minX);
      expect(spot.x).toBeLessThan(DHARMA_BOUNDS.maxX);
      expect(spot.z).toBeGreaterThan(DHARMA_BOUNDS.minZ);
      expect(spot.z).toBeLessThan(DHARMA_BOUNDS.maxZ);
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

describe("the 법당's quarter turn", () => {
  it("turns the room frame counter-clockwise seen from above, so its door lands on the +x side", () => {
    expect(DHARMA_YAW).toBe(Math.PI / 2);
    // three.js rotation.y = yaw sends the local +z (the door) to (sin yaw, 0, cos yaw).
    const door = dharmaToWorld(0, 1);
    expect(door.x - DHARMA_ORIGIN.x).toBeCloseTo(Math.sin(DHARMA_YAW), 12);
    expect(door.z - DHARMA_ORIGIN.z).toBeCloseTo(Math.cos(DHARMA_YAW), 12);
    // The room's +x turns to world -z, the same way (cos yaw, 0, -sin yaw).
    const side = dharmaToWorld(1, 0);
    expect(side.x - DHARMA_ORIGIN.x).toBeCloseTo(Math.cos(DHARMA_YAW), 12);
    expect(side.z - DHARMA_ORIGIN.z).toBeCloseTo(-Math.sin(DHARMA_YAW), 12);
  });

  it("maps floor points to the world and back", () => {
    expect(dharmaToWorld(0, 0)).toEqual({ x: DHARMA_ORIGIN.x, z: DHARMA_ORIGIN.z });
    expect(dharmaToWorld(0, 9)).toEqual({ x: -10, z: 0 });
    expect(dharmaToWorld(0, -8.4)).toEqual({ x: -27.4, z: 0 });
    for (const [x, z] of [[3.5, -2], [-9.2, 8.4], [0, 9.9], [6.65, 2.4]] as const) {
      const world = dharmaToWorld(x, z);
      const back = worldToDharma(world.x, world.z);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.z).toBeCloseTo(z, 9);
    }
  });

  it("stands the room on the west side, its front wall on the plaza side of the floor", () => {
    expect(DHARMA_BOUNDS.minX).toBeCloseTo(-23.8, 9);
    expect(DHARMA_BOUNDS.maxX).toBeCloseTo(-10.6, 9);
    expect(DHARMA_BOUNDS.minZ).toBeCloseTo(-9.2, 9);
    expect(DHARMA_BOUNDS.maxZ).toBeCloseTo(9.2, 9);
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
      for (let i = 0; i < ZONE_SEATS[zone].length; i += 1) {
        const spot = pickSeat(zone, (id) => taken.has(id));
        expect(spot).toBeDefined();
        expect(taken.has(spot!.id)).toBe(false);
        taken.add(spot!.id);
      }
      expect(pickSeat(zone, (id) => taken.has(id))).toBeUndefined();
    }
  });
});

describe("arrival", () => {
  it("brings everyone in inside the 법당, on the open floor between the last row of 방석 and the door", () => {
    expect(ARRIVAL).toEqual({ x: -14.5, z: 0, spread: 3 });
    const lastRowEdge = Math.max(...DHARMA_SEATS.map((seat) => seat.x)) + DHARMA_SEAT_SIZE.x / 2;
    for (const x of [ARRIVAL.x - ARRIVAL.spread / 2, ARRIVAL.x, ARRIVAL.x + ARRIVAL.spread / 2]) {
      expect(resolveWalkable(x, ARRIVAL.z)).toEqual({ x, z: ARRIVAL.z });
      expect(venueAt(x, ARRIVAL.z)).toBe("dharma");
      expect(x).toBeGreaterThan(lastRowEdge);
      expect(x).toBeLessThan(DHARMA_BOUNDS.maxX);
    }
  });

  it("stands the 법당 west of the plaza with its front wall at the near end of its floor", () => {
    expect(DHARMA_BOUNDS.maxX).toBeLessThan(WORLD_BOUNDS.minX);
    expect(DHARMA_BOUNDS.maxZ).toBeLessThan(WORLD_BOUNDS.maxZ);
    expect(DHARMA_ORIGIN).toEqual({ x: -19, z: 0 });
  });
});

describe("shore", () => {
  it("runs east from the plaza's edge to the waterline, as deep as the plaza", () => {
    expect(SHORE.minX).toBe(WORLD_BOUNDS.maxX);
    expect(SHORE.maxX).toBe(SEA_LINE_X);
    expect(SHORE.minZ).toBe(WORLD_BOUNDS.minZ);
    expect(SHORE.maxZ).toBe(WORLD_BOUNDS.maxZ);
    expect(SHORE.maxX - SHORE.minX).toBeGreaterThanOrEqual(5);
  });

  it("lets a fisher reach the water from a short way up the sand", () => {
    expect(FISHING_REACH).toBeGreaterThan(0);
    expect(SEA_LINE_X - FISHING_REACH).toBeGreaterThan(SHORE.minX);
  });

  it("lets a line be cast only from the last stretch of sand, inside the shore's depth", () => {
    expect(canCastAt(SEA_LINE_X, 6)).toBe(true);
    expect(canCastAt(SEA_LINE_X - FISHING_REACH, 6)).toBe(true);
    expect(canCastAt(SEA_LINE_X - FISHING_REACH - 0.01, 6)).toBe(false);
    expect(canCastAt(0, 6)).toBe(false);
    expect(canCastAt(SEA_LINE_X, SHORE.minZ - 0.1)).toBe(false);
    expect(canCastAt(SEA_LINE_X, SHORE.maxZ + 0.1)).toBe(false);
  });

  it("leaves the plaza where it was", () => {
    expect(WORLD_BOUNDS).toEqual({ minX: -7, maxX: 12.5, minZ: -2.4, maxZ: 15.5 });
    expect(PLAZA.maxX).toBeGreaterThan(WORLD_BOUNDS.maxX);
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
