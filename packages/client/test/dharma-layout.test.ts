import { describe, expect, it } from "vitest";
import { COURT_AREA, DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_SEATS, DHARMA_SEAT_SIZE, DOORWAY_AREA, WORLD_BOUNDS, ZONE_CAPACITY } from "@dongjane/shared";
import { ALTAR, BUDDHA_AT, CANDLE_SPOTS, DHARMA, DHARMA_DOOR, DHARMA_SHELL, FLAME_HEIGHT, FRONT_PILLARS_X, SIDE_PILLARS_Z, hangingLanterns } from "../src/game/dharma-layout.ts";

describe("the room", () => {
  it("holds the altar against the back wall with the Buddha in the middle of it", () => {
    expect(ALTAR.minZ).toBeGreaterThan(DHARMA.backZ);
    expect(ALTAR.halfWidth).toBeLessThan(DHARMA.halfWidth);
    expect(BUDDHA_AT.x).toBe(0);
    expect(BUDDHA_AT.z).toBeGreaterThan(ALTAR.minZ);
    expect(BUDDHA_AT.z).toBeLessThan(ALTAR.maxZ);
    expect(BUDDHA_AT.y).toBeGreaterThan(ALTAR.topY);
  });

  it("stands every candle on the altar, and its flame above the wax", () => {
    for (const [x, z] of CANDLE_SPOTS) {
      expect(Math.abs(x)).toBeLessThan(ALTAR.halfWidth);
      expect(z).toBeGreaterThan(ALTAR.minZ);
      expect(z).toBeLessThan(ALTAR.maxZ);
    }
    expect(FLAME_HEIGHT).toBeGreaterThan(0.4);
  });

  it("puts the door inside the front wall", () => {
    expect(DHARMA_DOOR.halfWidth).toBeLessThan(DHARMA.halfWidth);
    expect(DHARMA_DOOR.height).toBeLessThan(DHARMA.wallHeight);
  });

  it("keeps the pillars off the doorway and inside the walls", () => {
    for (const x of FRONT_PILLARS_X) {
      expect(Math.abs(x)).toBeGreaterThan(DHARMA_DOOR.halfWidth);
      expect(Math.abs(x)).toBeLessThan(DHARMA.halfWidth);
    }
    for (const z of SIDE_PILLARS_Z) {
      expect(z).toBeGreaterThan(DHARMA.backZ);
      expect(z).toBeLessThan(DHARMA.frontZ);
    }
  });

  it("seats as many as the zone admits, all inside where visitors may walk", () => {
    expect(DHARMA_SEATS).toHaveLength(ZONE_CAPACITY);
    for (const spot of DHARMA_SEATS) {
      expect(spot.x - DHARMA_SEAT_SIZE.x / 2).toBeGreaterThanOrEqual(DHARMA_BOUNDS.minX);
      expect(spot.x + DHARMA_SEAT_SIZE.x / 2).toBeLessThanOrEqual(DHARMA_BOUNDS.maxX);
      expect(spot.z).toBeGreaterThanOrEqual(DHARMA_BOUNDS.minZ);
      expect(spot.z).toBeLessThanOrEqual(DHARMA_BOUNDS.maxZ);
    }
  });
});

describe("hangingLanterns", () => {
  const lanterns = hangingLanterns();

  it("hangs the same lanterns every time", () => {
    expect(hangingLanterns()).toEqual(lanterns);
    expect(lanterns).toHaveLength(48);
  });

  it("keeps each one under the ceiling and inside the walls", () => {
    for (const lantern of lanterns) {
      expect(lantern.y).toBeGreaterThan(DHARMA.wallHeight - 1.5);
      expect(lantern.y).toBeLessThan(DHARMA.ceilingHeight - 1);
      expect(Math.abs(lantern.x)).toBeLessThan(DHARMA.halfWidth);
      expect(lantern.z).toBeGreaterThan(DHARMA.backZ);
      expect(lantern.z).toBeLessThan(DHARMA.frontZ);
      expect(lantern.tone).toBeGreaterThanOrEqual(0);
      expect(lantern.tone).toBeLessThan(1);
      expect(lantern.scale).toBeGreaterThan(1);
      expect(lantern.scale).toBeLessThan(1.3);
    }
  });
});

describe("the outside", () => {
  it("runs the porch out to the court the visitors walk along, and the doorway across to it", () => {
    expect(DHARMA_ORIGIN.z + DHARMA_SHELL.porchZ).toBe(COURT_AREA.minZ);
    expect(DHARMA_ORIGIN.z + DHARMA.frontZ).toBeLessThan(DHARMA_ORIGIN.z + DHARMA_SHELL.porchZ);
    expect(DOORWAY_AREA.maxZ).toBe(COURT_AREA.minZ);
    expect(DOORWAY_AREA.minZ).toBe(DHARMA_BOUNDS.maxZ);
  });

  it("opens the walkers' doorway inside the doorway of the wall, with room for the body on both sides", () => {
    expect(DOORWAY_AREA.maxX - DHARMA_ORIGIN.x).toBeLessThan(DHARMA_DOOR.halfWidth);
    expect(DHARMA_ORIGIN.x - DOORWAY_AREA.minX).toBeLessThan(DHARMA_DOOR.halfWidth);
  });

  it("stands the plinth clear of the plaza and the roof high over its edge", () => {
    expect(DHARMA_ORIGIN.x + DHARMA.halfWidth + DHARMA_SHELL.plinth).toBeLessThan(WORLD_BOUNDS.minX);
    const eaveEdge = DHARMA_ORIGIN.x + DHARMA.halfWidth + DHARMA_SHELL.eave;
    expect(eaveEdge - WORLD_BOUNDS.minX).toBeLessThan(0.5);
    expect(DHARMA_SHELL.beamTop).toBeGreaterThanOrEqual(DHARMA.wallHeight);
    expect(DHARMA_SHELL.beamTop).toBeGreaterThan(3);
  });
});
