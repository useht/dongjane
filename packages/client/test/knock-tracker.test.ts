import { describe, expect, it } from "vitest";
import { KnockTracker } from "../src/game/knock-tracker.ts";

describe("KnockTracker", () => {
  it("does not report the counter a monk already has when first seen", () => {
    const tracker = new KnockTracker();
    expect(tracker.observe("a", 7)).toBe(false);
    expect(tracker.observe("b", 0)).toBe(false);
  });

  it("reports a knock when the counter goes up and not while it stays the same", () => {
    const tracker = new KnockTracker();
    tracker.observe("a", 0);
    expect(tracker.observe("a", 1)).toBe(true);
    expect(tracker.observe("a", 1)).toBe(false);
    expect(tracker.observe("a", 3)).toBe(true);
  });

  it("keeps a counter per monk", () => {
    const tracker = new KnockTracker();
    tracker.observe("a", 0);
    tracker.observe("b", 0);
    expect(tracker.observe("a", 1)).toBe(true);
    expect(tracker.observe("b", 0)).toBe(false);
  });

  it("ignores a counter that goes backwards", () => {
    const tracker = new KnockTracker();
    tracker.observe("a", 5);
    expect(tracker.observe("a", 2)).toBe(false);
    expect(tracker.observe("a", 3)).toBe(true);
  });

  it("treats a monk as new again after forget or reset", () => {
    const tracker = new KnockTracker();
    tracker.observe("a", 1);
    tracker.observe("b", 1);
    tracker.forget("a");
    expect(tracker.observe("a", 9)).toBe(false);
    tracker.reset();
    expect(tracker.observe("b", 4)).toBe(false);
  });
});
