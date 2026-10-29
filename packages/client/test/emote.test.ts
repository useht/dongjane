import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMOTE_KEYS } from "@dongjane/shared";
import { EMOTE_SHOW_MS, EmoteTracker } from "../src/game/emote-tracker.ts";

const NOW = 10_000;

function activeIds(tracker: EmoteTracker, nowMs: number): string[] {
  return [...tracker.active(nowMs)].map((entry) => entry.monkId);
}

describe("EmoteTracker", () => {
  it("does not show the counter a monk already has when first seen", () => {
    const tracker = new EmoteTracker();
    expect(tracker.observe("a", 4, 2, NOW)).toBe(false);
    expect(activeIds(tracker, NOW)).toEqual([]);
    expect(tracker.observe("b", 0, 0, NOW)).toBe(false);
    expect(activeIds(tracker, NOW)).toEqual([]);
  });

  it("shows the new emoticon when the counter changes", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0, 0, NOW);
    expect(tracker.observe("a", 1, 6, NOW + 100)).toBe(true);
    expect([...tracker.active(NOW + 100)]).toEqual([{ monkId: "a", emote: 6, shownAt: NOW + 100 }]);
  });

  it("does not show again while the counter stays the same", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0, 0, NOW);
    tracker.observe("a", 1, 3, NOW + 100);
    const [first] = [...tracker.active(NOW + 200)];

    expect(tracker.observe("a", 1, 3, NOW + 1000)).toBe(false);
    expect([...tracker.active(NOW + 1000)]).toEqual([first]);

    tracker.active(NOW + 100 + EMOTE_SHOW_MS);
    expect(tracker.observe("a", 1, 3, NOW + 100 + EMOTE_SHOW_MS + 50)).toBe(false);
    expect(activeIds(tracker, NOW + 100 + EMOTE_SHOW_MS + 50)).toEqual([]);
  });

  it("replaces a monk's earlier bubble with the next emoticon", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0, 0, NOW);
    tracker.observe("a", 1, 3, NOW + 100);
    const [first] = [...tracker.active(NOW + 200)];
    tracker.observe("a", 2, 5, NOW + 1800);
    const shown = [...tracker.active(NOW + 1800)];
    expect(shown).toHaveLength(1);
    expect(shown[0]).toEqual({ monkId: "a", emote: 5, shownAt: NOW + 1800 });
    expect(shown[0]).not.toBe(first);
  });

  it("expires a bubble after EMOTE_SHOW_MS", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0, 0, NOW);
    tracker.observe("a", 1, 1, NOW);
    expect(activeIds(tracker, NOW + EMOTE_SHOW_MS - 1)).toEqual(["a"]);
    expect(activeIds(tracker, NOW + EMOTE_SHOW_MS)).toEqual([]);
  });

  it("tracks monks independently", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0, 0, NOW);
    tracker.observe("b", 0, 0, NOW);
    tracker.observe("a", 1, 2, NOW + 500);
    tracker.observe("b", 1, 4, NOW + 1500);
    expect(activeIds(tracker, NOW + 1600)).toEqual(["a", "b"]);
    expect(activeIds(tracker, NOW + 500 + EMOTE_SHOW_MS)).toEqual(["b"]);
  });

  it("treats a monk who is forgotten and seen again as a first sighting", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0, 0, NOW);
    tracker.observe("a", 1, 2, NOW + 100);
    tracker.forget("a");
    expect(activeIds(tracker, NOW + 200)).toEqual([]);
    expect(tracker.observe("a", 7, 2, NOW + 300)).toBe(false);
    expect(activeIds(tracker, NOW + 300)).toEqual([]);
  });

  it("shows the emoticon when the counter wraps to a lower value", () => {
    const tracker = new EmoteTracker();
    tracker.observe("a", 0xffffffff, 0, NOW);
    expect(tracker.observe("a", 0, 1, NOW + 100)).toBe(true);
  });
});

describe("emoticon art", () => {
  const publicDir = fileURLToPath(new URL("../public/emoji/", import.meta.url));

  it("ships a png for every emoticon key", () => {
    const missing = EMOTE_KEYS.filter((key) => !existsSync(`${publicDir}${key}.png`));
    expect(missing).toEqual([]);
  });
});
