import { describe, expect, it } from "vitest";
import { normalizeHue, randomHue, seatLabel, visitorTitle } from "../src/index.ts";

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

describe("visitor titles", () => {
  it("gives no title before the first bow", () => {
    expect(visitorTitle(0)).toBeNull();
    expect(visitorTitle(-3)).toBeNull();
    expect(visitorTitle(Number.NaN)).toBeNull();
  });

  it("switches title at each bow-count boundary", () => {
    expect(visitorTitle(1)).toBe("초심 수행자");
    expect(visitorTitle(4)).toBe("초심 수행자");
    expect(visitorTitle(5)).toBe("정진 수행자");
    expect(visitorTitle(14)).toBe("정진 수행자");
    expect(visitorTitle(15)).toBe("도를 닦는 이");
    expect(visitorTitle(29)).toBe("도를 닦는 이");
    expect(visitorTitle(30)).toBe("도인");
    expect(visitorTitle(5000)).toBe("도인");
  });
});
