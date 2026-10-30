import { describe, expect, it } from "vitest";
import { ARRIVAL, CASINO_DOOR, CASINO_FLOOR, CASINO_YARD, COAST_ROAD, MACHINE_SPOTS, type Bounds, machineFootprint } from "@dongjane/shared";
import {
  CASINO_CAMERA_BOUNDS,
  CASINO_COLUMNS,
  CASINO_KEEP_OUT,
  CASINO_LAMPS,
  CASINO_LIGHT,
  CASINO_NEAR,
  CASINO_PAD,
  CASINO_PAVING,
  CASINO_ROOM,
  CASINO_SHELL,
  CASINO_SIGN,
  CASINO_TOP,
  casinoNearness,
  distanceToBounds,
  insideBounds,
} from "../src/game/casino-layout.ts";
import { GROUND_UNDER, SAND_Y } from "../src/game/shore.ts";

const contains = (outer: Bounds, inner: Bounds, slack = 1e-9): boolean =>
  inner.minX >= outer.minX - slack && inner.maxX <= outer.maxX + slack && inner.minZ >= outer.minZ - slack && inner.maxZ <= outer.maxZ + slack;

describe("the casino's building", () => {
  it("surrounds the walkable floor, the machines and the room's own walls, with its door in the front wall", () => {
    expect(contains(CASINO_ROOM, CASINO_FLOOR)).toBe(true);
    for (const spot of MACHINE_SPOTS) expect(contains(CASINO_ROOM, machineFootprint(spot)), spot.id).toBe(true);
    expect(CASINO_ROOM.minX).toBeCloseTo(CASINO_SHELL.minX + CASINO_SHELL.wall, 9);
    expect(CASINO_ROOM.maxZ).toBeCloseTo(CASINO_SHELL.maxZ - CASINO_SHELL.wall, 9);
    expect(CASINO_DOOR.minZ).toBe(CASINO_YARD.maxZ);
    expect(CASINO_DOOR.maxZ).toBe(CASINO_FLOOR.minZ);
    expect(CASINO_SHELL.minZ).toBeGreaterThan(CASINO_DOOR.minZ);
    expect(CASINO_SHELL.minZ + CASINO_SHELL.wall).toBeLessThan(CASINO_DOOR.maxZ);
    expect(CASINO_DOOR.minX).toBeGreaterThan(CASINO_SHELL.minX);
    expect(CASINO_DOOR.maxX).toBeLessThan(CASINO_SHELL.maxX);
    expect((CASINO_DOOR.minX + CASINO_DOOR.maxX) / 2, "the door is in line with the middle of the aisle").toBeCloseTo((CASINO_FLOOR.minX + CASINO_FLOOR.maxX) / 2, 9);
  });

  it("keeps the land it stands on west of the sea, which begins at x = 17.5", () => {
    expect(CASINO_SHELL.maxX).toBeLessThan(17.5);
    for (const box of CASINO_PAD.boxes) expect(box.maxX + CASINO_PAD.margin).toBeLessThan(17.5 + 0.5);
  });

  it("is taller than its walls only by the sign tower, and the tower stands clear of the sign's board", () => {
    expect(CASINO_SHELL.topY).toBeGreaterThan(CASINO_SHELL.ceilingY);
    expect(CASINO_SHELL.doorHeight).toBeLessThan(CASINO_SHELL.ceilingY);
    expect(CASINO_SIGN.bottom).toBeGreaterThan(CASINO_SHELL.topY);
    expect(CASINO_SIGN.bottom + CASINO_SIGN.height).toBeLessThan(CASINO_TOP);
    expect(CASINO_SIGN.halfWidth * 2).toBeLessThan(CASINO_SHELL.maxX - CASINO_SHELL.minX);
  });

  it("stands the two columns in the bays, outside the aisle and inside the room", () => {
    for (const column of CASINO_COLUMNS) {
      expect(insideBounds(CASINO_ROOM, column.x, column.z)).toBe(true);
      expect(insideBounds(CASINO_FLOOR, column.x, column.z)).toBe(false);
      expect(distanceToBounds(CASINO_FLOOR, column.x, column.z)).toBeGreaterThan(column.radius);
    }
  });

  it("hangs its lamps under the ceiling inside the room and the sign's lamp out in front of the door", () => {
    for (const [x, y, z] of [...CASINO_LAMPS.gold, ...CASINO_LAMPS.pink, ...CASINO_LAMPS.cyan]) {
      expect(insideBounds(CASINO_ROOM, x, z), `lamp at ${x}, ${z}`).toBe(true);
      expect(y).toBeLessThan(CASINO_SHELL.ceilingY);
    }
    for (const [x, y, z] of CASINO_LAMPS.sign) {
      expect(z, "the sign's lamp stands in front of the wall").toBeLessThan(CASINO_SHELL.minZ);
      expect(y).toBeGreaterThan(CASINO_SHELL.topY);
      expect(x).toBeGreaterThan(CASINO_SHELL.minX);
      expect(x).toBeLessThan(CASINO_SHELL.maxX);
    }
    expect(CASINO_LIGHT.sign.distance, "the sign's light reaches the door").toBeGreaterThan(CASINO_SHELL.minZ - CASINO_LAMPS.sign[0][2]);
    expect(CASINO_LIGHT.decay).toBeGreaterThan(0);
  });
});

describe("the casino's pad and paving", () => {
  it("levels the ground to the height the shore's sand lies at, so the road meets the shore with no step", () => {
    expect(CASINO_PAD.y).toBeCloseTo(SAND_Y - GROUND_UNDER, 9);
  });

  it("reaches over the road, the yard and the walls, and so over everything a visitor walks on out there", () => {
    // The doorway runs from the yard into the walls, so it is covered by two of the boxes together: every point is tried.
    for (const area of [COAST_ROAD, CASINO_YARD, CASINO_DOOR, CASINO_FLOOR]) {
      for (let i = 0; i <= 10; i += 1) {
        for (let j = 0; j <= 10; j += 1) {
          const x = area.minX + ((area.maxX - area.minX) * i) / 10;
          const z = area.minZ + ((area.maxZ - area.minZ) * j) / 10;
          expect(CASINO_PAD.boxes.some((box) => insideBounds(box, x, z)), `${x}, ${z}`).toBe(true);
        }
      }
    }
    expect(CASINO_PAD.boxes.some((box) => contains(box, CASINO_SHELL))).toBe(true);
  });

  it("paves a margin past the road and the yard, and the doorsill through the front wall", () => {
    expect(contains(CASINO_PAVING.road, COAST_ROAD)).toBe(true);
    expect(contains(CASINO_PAVING.yard, { ...CASINO_YARD, maxZ: CASINO_SHELL.minZ })).toBe(true);
    expect(CASINO_PAVING.sill.minX).toBe(CASINO_DOOR.minX);
    expect(CASINO_PAVING.sill.maxX).toBe(CASINO_DOOR.maxX);
    expect(CASINO_PAVING.sill.minZ).toBe(CASINO_SHELL.minZ);
    expect(CASINO_PAVING.sill.maxZ).toBe(CASINO_ROOM.minZ);
  });
});

describe("the casino's camera box", () => {
  it("lies inside the room, from just above the floor to above the roof", () => {
    expect(CASINO_CAMERA_BOUNDS.minX).toBeGreaterThan(CASINO_ROOM.minX);
    expect(CASINO_CAMERA_BOUNDS.maxX).toBeLessThan(CASINO_ROOM.maxX);
    expect(CASINO_CAMERA_BOUNDS.minZ).toBeGreaterThan(CASINO_ROOM.minZ);
    expect(CASINO_CAMERA_BOUNDS.maxZ).toBeLessThan(CASINO_ROOM.maxZ);
    expect(CASINO_CAMERA_BOUNDS.minY).toBeGreaterThan(0);
    expect(CASINO_CAMERA_BOUNDS.maxY).toBeGreaterThan(CASINO_SHELL.topY);
  });

  it("is kept out of from outside by a box over the whole shell", () => {
    expect(CASINO_KEEP_OUT.minX).toBeLessThanOrEqual(CASINO_SHELL.minX);
    expect(CASINO_KEEP_OUT.maxX).toBeGreaterThanOrEqual(CASINO_SHELL.maxX);
    expect(CASINO_KEEP_OUT.minZ).toBeLessThanOrEqual(CASINO_SHELL.minZ);
    expect(CASINO_KEEP_OUT.maxZ).toBeGreaterThanOrEqual(CASINO_SHELL.maxZ);
    expect(CASINO_KEEP_OUT.maxY).toBeGreaterThan(CASINO_TOP);
  });
});

describe("insideBounds and distanceToBounds", () => {
  const box: Bounds = { minX: 0, maxX: 4, minZ: 10, maxZ: 12 };

  it("tell what is in a rectangle, its edges included", () => {
    expect(insideBounds(box, 2, 11)).toBe(true);
    expect(insideBounds(box, 0, 10)).toBe(true);
    expect(insideBounds(box, 4, 12)).toBe(true);
    expect(insideBounds(box, 4.01, 11)).toBe(false);
    expect(insideBounds(box, 2, 9.99)).toBe(false);
  });

  it("measure the straight way to the rectangle: zero on it, a side's distance beside it, a corner's across it", () => {
    expect(distanceToBounds(box, 2, 11)).toBe(0);
    expect(distanceToBounds(box, 4, 12)).toBe(0);
    expect(distanceToBounds(box, 7, 11)).toBe(3);
    expect(distanceToBounds(box, 2, 5)).toBe(5);
    expect(distanceToBounds(box, 7, 16)).toBe(5);
  });
});

describe("casinoNearness", () => {
  it("is 1 inside the walls and within the full distance of them, and 0 beyond the far one", () => {
    expect(casinoNearness((CASINO_FLOOR.minX + CASINO_FLOOR.maxX) / 2, (CASINO_FLOOR.minZ + CASINO_FLOOR.maxZ) / 2)).toBe(1);
    expect(casinoNearness(CASINO_SHELL.minX, CASINO_SHELL.minZ)).toBe(1);
    expect(casinoNearness(11.25, CASINO_SHELL.minZ - CASINO_NEAR.full)).toBe(1);
    expect(casinoNearness(11.25, CASINO_SHELL.minZ - CASINO_NEAR.none)).toBe(0);
    expect(casinoNearness(11.25, CASINO_SHELL.minZ - CASINO_NEAR.none - 10)).toBe(0);
  });

  it("falls steadily between the two, with no step", () => {
    let last = 1;
    for (let distance = CASINO_NEAR.full; distance <= CASINO_NEAR.none; distance += 0.5) {
      const now = casinoNearness(11.25, CASINO_SHELL.minZ - distance);
      expect(now, `at ${distance} m`).toBeLessThanOrEqual(last + 1e-12);
      expect(last - now, `between ${distance - 0.5} and ${distance} m`).toBeLessThan(0.2);
      last = now;
    }
    expect(casinoNearness(11.25, CASINO_SHELL.minZ - (CASINO_NEAR.full + CASINO_NEAR.none) / 2)).toBeCloseTo(0.5, 6);
  });

  it("is 0 where a visitor arrives, in the 법당, and up through the plaza", () => {
    expect(casinoNearness(ARRIVAL.x, ARRIVAL.z)).toBe(0);
  });

  it("measures from the walls, not from a point: it is the same all along a wall's side", () => {
    expect(casinoNearness(CASINO_SHELL.minX - 8, 45)).toBeCloseTo(casinoNearness(CASINO_SHELL.minX - 8, 40), 12);
  });
});
