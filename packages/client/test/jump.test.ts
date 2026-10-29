import { JUMP_MS } from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { JumpTracker } from "../src/game/jump-tracker.ts";
import { hopArc } from "../src/game/pose.ts";

describe("JumpTracker", () => {
  it("treats the first sighting as a baseline, whatever the counter is", () => {
    const tracker = new JumpTracker();
    expect(tracker.observe("a", 0)).toBe(false);
    expect(tracker.observe("b", 7)).toBe(false);
  });

  it("triggers when the counter changes afterwards", () => {
    const tracker = new JumpTracker();
    tracker.observe("a", 0);
    expect(tracker.observe("a", 1)).toBe(true);
    expect(tracker.observe("a", 2)).toBe(true);
  });

  it("does not trigger while the counter stays the same", () => {
    const tracker = new JumpTracker();
    tracker.observe("a", 3);
    expect(tracker.observe("a", 3)).toBe(false);
    expect(tracker.observe("a", 3)).toBe(false);
  });

  it("tracks monks independently", () => {
    const tracker = new JumpTracker();
    tracker.observe("a", 0);
    tracker.observe("b", 0);
    expect(tracker.observe("a", 1)).toBe(true);
    expect(tracker.observe("b", 0)).toBe(false);
  });

  it("treats a monk who is forgotten and seen again as a first sighting", () => {
    const tracker = new JumpTracker();
    tracker.observe("a", 0);
    tracker.observe("a", 1);
    tracker.forget("a");
    expect(tracker.observe("a", 5)).toBe(false);
    expect(tracker.observe("a", 6)).toBe(true);
  });

  it("triggers when the counter wraps to a lower value", () => {
    const tracker = new JumpTracker();
    tracker.observe("a", 0xffffffff);
    expect(tracker.observe("a", 0)).toBe(true);
  });
});

describe("hopArc", () => {
  it("is on the ground before takeoff and after landing", () => {
    expect(hopArc(0)).toBe(0);
    expect(hopArc(-20)).toBe(0);
    expect(hopArc(Number.NaN)).toBe(0);
    expect(hopArc(JUMP_MS)).toBe(0);
    expect(hopArc(JUMP_MS * 4)).toBe(0);
    expect(hopArc(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("peaks at 1 halfway and rises then falls", () => {
    expect(hopArc(JUMP_MS / 2)).toBeCloseTo(1, 6);
    expect(hopArc(JUMP_MS * 0.25)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(hopArc(JUMP_MS * 0.1)).toBeLessThan(hopArc(JUMP_MS * 0.3));
    expect(hopArc(JUMP_MS * 0.9)).toBeLessThan(hopArc(JUMP_MS * 0.7));
  });
});
