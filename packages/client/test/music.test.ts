import { describe, expect, it } from "vitest";
import { DHARMA_BOUNDS, DHARMA_ORIGIN, WORLD_BOUNDS, dharmaToWorld } from "@dongjane/shared";
import { DHARMA, DHARMA_DOOR } from "../src/game/dharma-layout.ts";
import { DEEP_METRES, OUTSIDE_METRES, SEEK_LOOKAHEAD_SECONDS, aimAhead, areaMix, chantMix, loopPosition } from "../src/audio/music.ts";

const LOOP_SECONDS = 116;

describe("loopPosition", () => {
  it("is the same place of the loop for everyone who reads the same server time", () => {
    expect(loopPosition(1_700_000_000_000, LOOP_SECONDS)).toBe(loopPosition(1_700_000_000_000, LOOP_SECONDS));
  });

  it("wraps around the length of the loop", () => {
    expect(loopPosition(0, 100)).toBe(0);
    expect(loopPosition(30_000, 100)).toBeCloseTo(30, 9);
    expect(loopPosition(130_000, 100)).toBeCloseTo(30, 9);
    expect(loopPosition(100_000, 100)).toBeCloseTo(0, 9);
  });

  it("moves one second per second and stays inside the loop", () => {
    for (let ms = 0; ms < 1_000_000; ms += 137_321) {
      const here = loopPosition(ms, LOOP_SECONDS);
      expect(here).toBeGreaterThanOrEqual(0);
      expect(here).toBeLessThan(LOOP_SECONDS);
      const later = loopPosition(ms + 2_500, LOOP_SECONDS);
      expect((later - here + LOOP_SECONDS) % LOOP_SECONDS).toBeCloseTo(2.5, 6);
    }
  });

  it("answers 0 when there is nothing sensible to answer", () => {
    expect(loopPosition(5_000, 0)).toBe(0);
    expect(loopPosition(5_000, Number.NaN)).toBe(0);
    expect(loopPosition(Number.NaN, 100)).toBe(0);
    expect(loopPosition(5_000, -3)).toBe(0);
  });

  it("copes with a clock before the epoch", () => {
    expect(loopPosition(-30_000, 100)).toBeCloseTo(70, 9);
  });
});

describe("aimAhead", () => {
  it("aims a little past the loop's place and wraps at its end", () => {
    expect(aimAhead(10, 100)).toBeCloseTo(10 + SEEK_LOOKAHEAD_SECONDS, 9);
    expect(aimAhead(99.9, 100)).toBeCloseTo(SEEK_LOOKAHEAD_SECONDS - 0.1, 9);
  });
});

describe("areaMix", () => {
  // The door is in the room's front wall; the room is turned so that wall faces +x: inside is toward -x, outside toward +x.
  const { x: doorX, z: doorZ } = dharmaToWorld(0, DHARMA.frontZ);

  it("is half and half in the doorway", () => {
    expect(areaMix(doorX, doorZ)).toBeCloseTo(0.5, 9);
  });

  it("is the chant alone from three metres inside, wherever across the room", () => {
    expect(areaMix(doorX - DEEP_METRES, doorZ)).toBe(1);
    expect(areaMix(doorX - DEEP_METRES, DHARMA_BOUNDS.maxZ - 1)).toBe(1);
    expect(areaMix(DHARMA_ORIGIN.x, DHARMA_ORIGIN.z)).toBe(1);
    expect(areaMix(DHARMA_BOUNDS.minX + 1, DHARMA_ORIGIN.z)).toBe(1);
  });

  it("is the concert alone from six metres outside the door", () => {
    expect(areaMix(doorX + OUTSIDE_METRES, doorZ)).toBe(0);
    expect(areaMix(doorX + OUTSIDE_METRES + 4, doorZ)).toBe(0);
    expect(areaMix(0, 14)).toBe(0);
  });

  it("falls steadily from the doorway to six metres out, and rises steadily to three metres in", () => {
    let last = areaMix(doorX, doorZ);
    for (let step = 1; step <= 12; step += 1) {
      const next = areaMix(doorX + step * 0.5, doorZ);
      expect(next).toBeLessThanOrEqual(last);
      last = next;
    }
    last = areaMix(doorX, doorZ);
    for (let step = 1; step <= 12; step += 1) {
      const next = areaMix(doorX - step * 0.25, doorZ);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });

  it("does not jump where the room meets the court", () => {
    expect(Math.abs(areaMix(doorX - 0.001, doorZ) - areaMix(doorX + 0.001, doorZ))).toBeLessThan(0.01);
  });

  it("counts the court beside the door and the plaza as outdoors", () => {
    expect(areaMix(doorX + 1, doorZ + DHARMA_DOOR.halfWidth + 5)).toBeLessThan(0.1);
    expect(areaMix(0, 0)).toBe(0);
    // The plaza's near edge is only the court's width from the porch, so the room's share still reaches it a little.
    expect(areaMix(WORLD_BOUNDS.minX, doorZ)).toBeLessThan(0.3);
  });

  it("stays between 0 and 1 and answers 0 for nonsense", () => {
    for (let x = -32; x <= 14; x += 2.3) {
      for (let z = -12; z <= 18; z += 1.7) {
        const mix = areaMix(x, z);
        expect(mix).toBeGreaterThanOrEqual(0);
        expect(mix).toBeLessThanOrEqual(1);
      }
    }
    expect(areaMix(Number.NaN, 3)).toBe(0);
  });
});

describe("chantMix", () => {
  const { x: doorX, z: doorZ } = dharmaToWorld(0, DHARMA.frontZ);

  it("is silent outside the door, the half-metre of porch included", () => {
    expect(chantMix(doorX + 0.5, doorZ)).toBe(0);
    expect(chantMix(doorX + 1, doorZ)).toBe(0);
    expect(chantMix(doorX + OUTSIDE_METRES, doorZ)).toBe(0);
    expect(chantMix(doorX + 1, doorZ + DHARMA_DOOR.halfWidth + 5)).toBe(0);
    expect(chantMix(0, 0)).toBe(0);
    expect(chantMix(WORLD_BOUNDS.minX, doorZ)).toBe(0);
  });

  it("is half in the doorway, where the room ends", () => {
    expect(chantMix(doorX, doorZ)).toBeCloseTo(0.5, 9);
  });

  it("is the chant alone from three metres inside", () => {
    expect(chantMix(doorX - DEEP_METRES, doorZ)).toBe(1);
    expect(chantMix(DHARMA_ORIGIN.x, DHARMA_ORIGIN.z)).toBe(1);
  });

  it("is areaMix at every point inside the room", () => {
    for (const x of [DHARMA_BOUNDS.minX, DHARMA_ORIGIN.x, doorX - 2, doorX - 0.5, doorX]) {
      for (const z of [DHARMA_BOUNDS.minZ, DHARMA_ORIGIN.z, doorZ, DHARMA_BOUNDS.maxZ]) {
        expect(chantMix(x, z)).toBe(areaMix(x, z));
      }
    }
  });

  it("answers 0 for nonsense", () => {
    expect(chantMix(Number.NaN, doorZ)).toBe(0);
    expect(chantMix(doorX - 1, Number.NaN)).toBe(0);
    expect(chantMix(Number.POSITIVE_INFINITY, doorZ)).toBe(0);
  });
});
