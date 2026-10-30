import { describe, expect, it } from "vitest";
import { SLOT_KINDS, SLOT_LAYOUT, SLOT_STRIPS, spinSlot } from "@dongjane/shared";
import {
  FIRST_REEL_STOP_MS,
  crossedSymbol,
  easeOut,
  reelPosition,
  reelSchedule,
  reelTravel,
  spinDuration,
  visibleRows,
  windowAt,
} from "../src/casino/reels.ts";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe("reel schedule", () => {
  it("stops the first reel at 1.2 s and the last between 1.9 and 2.2 s, one after another", () => {
    for (const kind of SLOT_KINDS) {
      const schedule = reelSchedule(kind, false);
      expect(schedule).toHaveLength(SLOT_LAYOUT[kind].reels);
      expect(schedule[0]).toBe(FIRST_REEL_STOP_MS);
      expect(schedule).toEqual([...schedule].sort((a, b) => a - b));
      expect(new Set(schedule).size).toBe(schedule.length);
      expect(spinDuration(schedule)).toBeGreaterThanOrEqual(1900);
      expect(spinDuration(schedule)).toBeLessThanOrEqual(2200);
    }
  });

  it("stops every reel at once without motion", () => {
    for (const kind of SLOT_KINDS) {
      expect(reelSchedule(kind, true).every((at) => at === 0)).toBe(true);
      expect(spinDuration(reelSchedule(kind, true))).toBe(0);
    }
  });
});

describe("reel travel", () => {
  it("ends on the stop, whatever the start, after a run long enough to look like a spin", () => {
    const length = SLOT_STRIPS.classic.length;
    for (let from = 0; from < length; from += 1) {
      for (let stop = 0; stop < length; stop += 1) {
        const travel = reelTravel(from, stop, length, 1200);
        expect(travel).toBeGreaterThanOrEqual(19);
        expect((from + travel) % length).toBe(stop);
      }
    }
  });

  it("sends a reel with no run to make straight to its stop", () => {
    expect(reelTravel(3, 9, 32, 0)).toBe(6);
    expect(reelTravel(9, 3, 32, 0)).toBe(26);
    expect(reelTravel(4, 4, 32, 0)).toBe(0);
    expect(reelPosition(3, 6, 0, 0)).toBe(9);
  });

  it("runs further for a later stop", () => {
    expect(reelTravel(0, 0, 32, 2200)).toBeGreaterThan(reelTravel(0, 0, 32, 1200));
  });
});

describe("reel position", () => {
  it("starts where it was, only moves forward, and comes to rest exactly on the stop", () => {
    const travel = reelTravel(5, 12, 32, 1500);
    expect(reelPosition(5, travel, 0, 1500)).toBe(5);
    let before = 5;
    for (let ms = 0; ms <= 1500; ms += 16) {
      const at = reelPosition(5, travel, ms, 1500);
      expect(at).toBeGreaterThanOrEqual(before);
      before = at;
    }
    expect(reelPosition(5, travel, 1500, 1500)).toBe(5 + travel);
    expect(reelPosition(5, travel, 9999, 1500)).toBe(5 + travel);
  });

  it("slows down toward the end", () => {
    const travel = 40;
    const early = reelPosition(0, travel, 100, 1000) - reelPosition(0, travel, 0, 1000);
    const late = reelPosition(0, travel, 1000, 1000) - reelPosition(0, travel, 900, 1000);
    expect(late).toBeLessThan(early);
  });

  it("counts a symbol going by", () => {
    expect(crossedSymbol(2.1, 2.9)).toBe(false);
    expect(crossedSymbol(2.9, 3.1)).toBe(true);
    expect(crossedSymbol(2.9, 5.2)).toBe(true);
  });

  it("eases out within 0 to 1", () => {
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe("reel window", () => {
  it("wraps round the strip and carries the symbol sliding in", () => {
    const strip = SLOT_STRIPS.classic;
    const last = windowAt("classic", strip.length - 1, 1);
    expect(last.index).toBe(strip.length - 1);
    expect(last.symbols).toEqual([strip[strip.length - 1], strip[0]]);
    const wrapped = windowAt("classic", strip.length + 2.25, 1);
    expect(wrapped.index).toBe(2);
    expect(wrapped.offset).toBeCloseTo(0.25);
  });

  it("shows, once every reel has stopped, exactly the grid the shared rules decided", () => {
    const random = seeded(7);
    for (const kind of SLOT_KINDS) {
      const length = SLOT_STRIPS[kind].length;
      const schedule = reelSchedule(kind, false);
      const from = Array.from({ length: SLOT_LAYOUT[kind].reels }, () => Math.floor(random() * length));
      for (let game = 0; game < 40; game += 1) {
        const spin = spinSlot(kind, 10, random);
        const rows = visibleRows(kind);
        spin.stops.forEach((stop, reel) => {
          const travel = reelTravel(from[reel] as number, stop, length, schedule[reel] as number);
          const end = reelPosition(from[reel] as number, travel, schedule[reel] as number, schedule[reel] as number);
          const shown = windowAt(kind, end, rows);
          expect(shown.offset, `${kind} reel ${reel}`).toBe(0);
          expect(shown.symbols.slice(0, rows), `${kind} reel ${reel}`).toEqual(spin.grid[reel]);
          from[reel] = stop;
        });
      }
    }
  });

  it("shows the same grid at once without motion", () => {
    const random = seeded(11);
    for (const kind of SLOT_KINDS) {
      const spin = spinSlot(kind, 10, random);
      spin.stops.forEach((stop, reel) => {
        const travel = reelTravel(17, stop, SLOT_STRIPS[kind].length, 0);
        const shown = windowAt(kind, reelPosition(17, travel, 0, 0), visibleRows(kind));
        expect(shown.symbols.slice(0, visibleRows(kind))).toEqual(spin.grid[reel]);
      });
    }
  });

  it("shows one row on the one-line machines and three on the five-reel", () => {
    expect(visibleRows("classic")).toBe(1);
    expect(visibleRows("luckySeven")).toBe(1);
    expect(visibleRows("fiveReel")).toBe(3);
  });
});
