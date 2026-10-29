import { describe, expect, it } from "vitest";
import { loopPosition } from "../src/audio/music.ts";

describe("loopPosition", () => {
  it("is the same place of the loop for everyone who reads the same server time", () => {
    expect(loopPosition(1_700_000_000_000, 131.9)).toBe(loopPosition(1_700_000_000_000, 131.9));
  });

  it("wraps around the length of the loop", () => {
    expect(loopPosition(0, 100)).toBe(0);
    expect(loopPosition(30_000, 100)).toBeCloseTo(30, 9);
    expect(loopPosition(130_000, 100)).toBeCloseTo(30, 9);
    expect(loopPosition(100_000, 100)).toBeCloseTo(0, 9);
  });

  it("moves one second per second and stays inside the loop", () => {
    for (let ms = 0; ms < 1_000_000; ms += 137_321) {
      const here = loopPosition(ms, 131.9);
      expect(here).toBeGreaterThanOrEqual(0);
      expect(here).toBeLessThan(131.9);
      const later = loopPosition(ms + 2_500, 131.9);
      expect((later - here + 131.9) % 131.9).toBeCloseTo(2.5, 6);
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
