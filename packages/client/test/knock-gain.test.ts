import { describe, expect, it } from "vitest";
import { KNOCK_AUDIBLE_GAIN, KNOCK_HEARING_RANGE, knockGain } from "../src/audio/knock-gain.ts";

describe("knockGain", () => {
  it("is full at the knocker and silent at the edge of the range", () => {
    expect(knockGain(0)).toBe(1);
    expect(knockGain(KNOCK_HEARING_RANGE)).toBe(0);
    expect(knockGain(KNOCK_HEARING_RANGE * 2)).toBe(0);
  });

  it("falls off linearly in between", () => {
    expect(knockGain(KNOCK_HEARING_RANGE / 2)).toBeCloseTo(0.5, 10);
    expect(knockGain(KNOCK_HEARING_RANGE / 4)).toBeCloseTo(0.75, 10);
  });

  it("never grows with distance", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= KNOCK_HEARING_RANGE + 2; d += 0.25) {
      const gain = knockGain(d);
      expect(gain).toBeLessThanOrEqual(last);
      expect(gain).toBeGreaterThanOrEqual(0);
      last = gain;
    }
  });

  it("clamps bad distances", () => {
    expect(knockGain(-3)).toBe(1);
    expect(knockGain(Number.NaN)).toBe(0);
    expect(knockGain(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("lets the next seat over hear it clearly but not the far wall of the 법당", () => {
    expect(knockGain(2)).toBeGreaterThan(KNOCK_AUDIBLE_GAIN);
    expect(knockGain(7.8)).toBeLessThan(KNOCK_AUDIBLE_GAIN);
  });
});
