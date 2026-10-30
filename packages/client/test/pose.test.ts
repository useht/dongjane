import { BOW_MS } from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { PoseBlend, approach, bowDepth } from "../src/game/pose.ts";

describe("bowDepth", () => {
  it("starts and ends upright", () => {
    expect(bowDepth(0, true)).toBe(0);
    expect(bowDepth(-50, true)).toBe(0);
    expect(bowDepth(BOW_MS, true)).toBe(0);
    expect(bowDepth(BOW_MS * 3, false)).toBe(0);
    expect(bowDepth(Number.NaN, true)).toBe(0);
  });

  it("reaches the floor, holds, then rises", () => {
    expect(bowDepth(BOW_MS * 0.4, true)).toBe(1);
    expect(bowDepth(BOW_MS * 0.4, false)).toBe(1);
    expect(bowDepth(BOW_MS * 0.16, false)).toBeCloseTo(0.5, 5);
    const falling = [0.6, 0.7, 0.8, 0.9, 0.99].map((u) => bowDepth(BOW_MS * u, false));
    for (let i = 1; i < falling.length; i += 1) expect(falling[i] as number).toBeLessThan(falling[i - 1] as number);
  });

  it("eased curve stays within 0..1 and differs from linear", () => {
    for (let ms = 0; ms <= BOW_MS; ms += 40) {
      const eased = bowDepth(ms, true);
      expect(eased).toBeGreaterThanOrEqual(0);
      expect(eased).toBeLessThanOrEqual(1);
    }
    expect(bowDepth(BOW_MS * 0.08, true)).toBeLessThan(bowDepth(BOW_MS * 0.08, false));
  });
});

describe("PoseBlend", () => {
  it("eases toward kneel and settles", () => {
    const pose = new PoseBlend();
    pose.update("kneel", 0.05, true);
    expect(pose.kneel).toBeGreaterThan(0);
    expect(pose.kneel).toBeLessThan(1);
    for (let i = 0; i < 80; i += 1) pose.update("kneel", 0.05, true);
    expect(pose.kneel).toBeGreaterThan(0.99);
    expect(pose.walk).toBeLessThan(0.01);
  });

  it("keeps the kneeling posture while bowing and stands back up", () => {
    const pose = new PoseBlend();
    pose.update("bow", 1, false);
    expect(pose.kneel).toBe(1);
    pose.update("stand", 1, false);
    expect(pose.kneel).toBe(0);
  });

  it("snaps without smoothing when motion is reduced", () => {
    const pose = new PoseBlend();
    pose.update("walk", 0.016, false);
    expect(pose.walk).toBe(1);
  });
});

describe("approach", () => {
  it("never overshoots", () => {
    let value = 0;
    for (let i = 0; i < 100; i += 1) {
      value = approach(value, 1, 0.1, 5);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(value).toBeGreaterThan(0.99);
  });
});
