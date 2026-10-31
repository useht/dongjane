import { describe, expect, it } from "vitest";
import { BowWatcher, type WatchedMonk } from "../src/game/bow-watch.ts";

const monk = (id: string, mode: string, x = 0, z = 0, slot = 2): WatchedMonk => ({ id, slot, x, z, mode });

describe("BowWatcher", () => {
  it("reports a neighbour starting a bow once", () => {
    const watch = new BowWatcher();
    watch.update([monk("me", "kneel"), monk("a", "kneel", 2, 0)], "me", 0);
    expect(watch.update([monk("me", "kneel"), monk("a", "bow", 2, 0)], "me", 100).greeters).toEqual([2]);
    expect(watch.update([monk("me", "kneel"), monk("a", "bow", 2, 0)], "me", 200).greeters).toEqual([]);
  });

  it("does not repeat for each bow of a three-bow set", () => {
    const watch = new BowWatcher();
    const at = (mode: string) => [monk("me", "kneel"), monk("a", mode, 1, 1)];
    watch.update(at("kneel"), "me", 0);
    expect(watch.update(at("bow"), "me", 100).greeters).toHaveLength(1);
    watch.update(at("kneel"), "me", 2600);
    expect(watch.update(at("bow"), "me", 3200).greeters).toHaveLength(0);
    watch.update(at("kneel"), "me", 5600);
    expect(watch.update(at("bow"), "me", 6200).greeters).toHaveLength(0);
    watch.update(at("kneel"), "me", 8600);
    expect(watch.update(at("bow"), "me", 9200).greeters).toHaveLength(1);
  });

  it("ignores monks that are far away or already bowing when first seen", () => {
    const watch = new BowWatcher();
    watch.update([monk("me", "kneel"), monk("far", "kneel", 9, 0), monk("late", "bow", 1, 0)], "me", 0);
    const report = watch.update([monk("me", "kneel"), monk("far", "bow", 9, 0), monk("late", "bow", 1, 0)], "me", 100);
    expect(report.greeters).toEqual([]);
  });

  it("does not greet the local monk's own bow", () => {
    const watch = new BowWatcher();
    watch.update([monk("me", "kneel")], "me", 0);
    expect(watch.update([monk("me", "bow")], "me", 100)).toEqual({ greeters: [] });
  });

  it("spaces out several greetings arriving together", () => {
    const watch = new BowWatcher();
    const before = [monk("me", "kneel"), monk("a", "kneel", 1, 0, 2), monk("b", "kneel", -1, 0, 3)];
    const after = [monk("me", "kneel"), monk("a", "bow", 1, 0, 2), monk("b", "bow", -1, 0, 3)];
    watch.update(before, "me", 0);
    expect(watch.update(after, "me", 100).greeters).toEqual([2]);
  });

  it("forgets monks that left and starts clean after a reset", () => {
    const watch = new BowWatcher();
    watch.update([monk("me", "kneel"), monk("a", "bow", 1, 0)], "me", 0);
    watch.update([monk("me", "kneel")], "me", 100);
    expect(watch.update([monk("me", "kneel"), monk("a", "bow", 1, 0)], "me", 200).greeters).toEqual([]);
    watch.reset();
    watch.update([monk("me", "kneel"), monk("a", "kneel", 1, 0)], "me", 300);
    expect(watch.update([monk("me", "kneel"), monk("a", "bow", 1, 0)], "me", 400).greeters).toEqual([2]);
  });
});
