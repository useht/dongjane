import { describe, expect, it } from "vitest";
import { normalizeHue, randomHue, seatLabel } from "../src/index.ts";

describe("hue and seat labels", () => {
  it("normalizes hue into 0..359", () => {
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(-30)).toBe(330);
    expect(normalizeHue(120.4)).toBe(120);
    expect(normalizeHue(Number.NaN)).toBeNull();
    expect(normalizeHue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeHue("12")).toBeNull();
  });

  it("generates hues from an injected random", () => {
    expect(randomHue(() => 0.5)).toBe(180);
    expect(randomHue(() => 0.9999)).toBeLessThan(360);
  });

  it("labels a seat number for display", () => {
    expect(seatLabel(1)).toBe("1번 동자");
    expect(seatLabel(12)).toBe("12번 동자");
  });
});
