import { describe, expect, it } from "vitest";
import { AdaptiveScale, detectQuality } from "../src/game/quality.ts";

const desktop = { devicePixelRatio: 3, cores: 12, memoryGb: 16, coarsePointer: false, maxAnisotropy: 16 };

describe("detectQuality", () => {
  it("caps the pixel ratio at 2 on desktop and keeps the 1024 shadow map", () => {
    const q = detectQuality(desktop);
    expect(q.pixelRatioCap).toBe(2);
    expect(q.shadowMapSize).toBe(1024);
    expect(q.weak).toBe(false);
    expect(q.anisotropy).toBe(8);
    expect(q.leaves).toBeGreaterThan(0);
    expect(q.precipitation).toBeGreaterThan(0);
    expect(q.lanterns).toBe(180);
    expect(q.dust).toBe(90);
    expect([q.videoWidth, q.videoHeight]).toEqual([960, 540]);
  });

  it("lowers the cost on weak phones", () => {
    const q = detectQuality({ devicePixelRatio: 3, cores: 4, memoryGb: 2, coarsePointer: true, maxAnisotropy: 4 });
    expect(q.weak).toBe(true);
    expect(q.pixelRatioCap).toBeLessThanOrEqual(1.25);
    expect(q.shadowMapSize).toBe(512);
    expect(q.anisotropy).toBe(2);
    const strong = detectQuality(desktop);
    expect(q.leaves).toBeLessThan(strong.leaves);
    expect(q.precipitation).toBeLessThan(strong.precipitation);
    expect(q.lanterns).toBe(strong.lanterns / 2);
    expect(q.dust).toBeLessThan(strong.dust);
    expect(q.dust).toBeGreaterThan(0);
    expect([q.videoWidth, q.videoHeight]).toEqual([640, 360]);
    expect(q.leaves).toBeGreaterThan(0);
    expect(q.precipitation).toBeGreaterThan(0);
  });

  it("treats a capable phone as normal but below desktop resolution", () => {
    const q = detectQuality({ devicePixelRatio: 3, cores: 8, memoryGb: 8, coarsePointer: true, maxAnisotropy: 16 });
    expect(q.weak).toBe(false);
    expect(q.pixelRatioCap).toBe(1.75);
  });

  it("survives missing or odd inputs", () => {
    const q = detectQuality({ devicePixelRatio: Number.NaN, cores: undefined, memoryGb: undefined, coarsePointer: false, maxAnisotropy: 0 });
    expect(q.pixelRatioCap).toBe(1);
    expect(q.anisotropy).toBe(1);
  });
});

describe("AdaptiveScale", () => {
  const feed = (scale: AdaptiveScale, ms: number, frames: number): Array<number | null> =>
    Array.from({ length: frames }, () => scale.push(ms));

  it("steps down on slow frames but never below the floor", () => {
    const scale = new AdaptiveScale(2, 2, 1);
    const changes = feed(scale, 40, 60 * 5).filter((value) => value !== null);
    expect(changes).toEqual([1.75, 1.5, 1.25, 1]);
    expect(scale.ratio).toBe(1);
  });

  it("recovers only after sustained calm", () => {
    const scale = new AdaptiveScale(1, 2, 0.75);
    expect(feed(scale, 8, 60 * 2).filter((value) => value !== null)).toEqual([]);
    expect(feed(scale, 8, 60).filter((value) => value !== null)).toEqual([1.25]);
  });

  it("holds steady in the middle band and ignores bad samples", () => {
    const scale = new AdaptiveScale(1.5, 2);
    expect(feed(scale, 20, 300).filter((value) => value !== null)).toEqual([]);
    expect(scale.push(Number.NaN)).toBeNull();
    expect(scale.push(5000)).toBeNull();
  });
});
