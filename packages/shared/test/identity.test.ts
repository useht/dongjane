import { describe, expect, it } from "vitest";
import { defaultName, normalizeHue, randomHue, sanitizeName } from "../src/index.ts";

describe("sanitizeName", () => {
  it("trims and keeps Korean names intact", () => {
    expect(sanitizeName("  동자승  ")).toBe("동자승");
  });

  it("limits to 8 characters by code point", () => {
    expect(sanitizeName("가나다라마바사아자차")).toBe("가나다라마바사아");
    expect(sanitizeName("🙏🙏🙏🙏🙏🙏🙏🙏🙏🙏")).toBe("🙏🙏🙏🙏🙏🙏🙏🙏");
  });

  it("strips control and invisible format characters", () => {
    expect(sanitizeName("a\u0000b\u0007c‮d​e")).toBe("abcde");
    expect(sanitizeName("line\nbreak\tname")).toBe("linebrea");
  });

  it("collapses whitespace", () => {
    expect(sanitizeName("a    b")).toBe("a b");
  });

  it("returns an empty string for non-strings and blanks", () => {
    expect(sanitizeName(42)).toBe("");
    expect(sanitizeName(null)).toBe("");
    expect(sanitizeName("   \u0000  ")).toBe("");
  });

  it("does not leave a trailing space after truncation", () => {
    expect(sanitizeName("1234567 8")).toBe("1234567");
  });
});

describe("hue and default names", () => {
  it("normalizes hue into 0..359", () => {
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(-30)).toBe(330);
    expect(normalizeHue(120.4)).toBe(120);
    expect(normalizeHue(Number.NaN)).toBeNull();
    expect(normalizeHue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeHue("12")).toBeNull();
  });

  it("generates default names and hues from an injected random", () => {
    expect(defaultName(() => 0)).toBe("동자10");
    expect(defaultName(() => 0.999)).toBe("동자99");
    expect(randomHue(() => 0.5)).toBe(180);
    expect(randomHue(() => 0.9999)).toBeLessThan(360);
  });
});
