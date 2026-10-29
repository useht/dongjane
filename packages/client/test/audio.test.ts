import { describe, expect, it } from "vitest";
import { ChantBellScheduler } from "../src/audio/chant-bell.ts";
import { BELL_FUNDAMENTAL_HZ, BELL_PARTIALS } from "../src/audio/engine.ts";

const chant = { startsAt: 1_000_000, durationMs: 180_000 };

describe("ChantBellScheduler", () => {
  it("rings once when the start was seen coming", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt - 60_000);
    expect(bell.shouldRing(chant, chant.startsAt - 1)).toBe(false);
    expect(bell.shouldRing(chant, chant.startsAt + 200)).toBe(true);
    expect(bell.shouldRing(chant, chant.startsAt + 400)).toBe(false);
  });

  it("stays quiet for someone who arrives mid-chant", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt + 60_000);
    expect(bell.shouldRing(chant, chant.startsAt + 60_000)).toBe(false);
  });

  it("rings for someone who joins in the first seconds", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt + 1_500);
    expect(bell.shouldRing(chant, chant.startsAt + 1_500)).toBe(true);
  });

  it("does not ring late after a long stall", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt - 5_000);
    expect(bell.shouldRing(chant, chant.startsAt + 30_000)).toBe(false);
  });

  it("rings again for the next chant", () => {
    const bell = new ChantBellScheduler();
    const next = { startsAt: chant.startsAt + 1_800_000, durationMs: 180_000 };
    bell.observe(chant, chant.startsAt - 1000);
    expect(bell.shouldRing(chant, chant.startsAt + 100)).toBe(true);
    bell.observe(next, chant.startsAt + 200_000);
    expect(bell.shouldRing(next, next.startsAt + 100)).toBe(true);
  });

  it("ignores an empty chant", () => {
    const bell = new ChantBellScheduler();
    bell.observe({ startsAt: 0, durationMs: 0 }, 5);
    expect(bell.shouldRing({ startsAt: 0, durationMs: 0 }, 5)).toBe(false);
  });
});

describe("bell recipe", () => {
  it("has a low fundamental with shorter-lived higher partials", () => {
    expect(BELL_FUNDAMENTAL_HZ).toBeLessThan(300);
    for (let i = 1; i < BELL_PARTIALS.length; i += 1) {
      const previous = BELL_PARTIALS[i - 1];
      const current = BELL_PARTIALS[i];
      expect(current?.decay).toBeLessThan(previous?.decay ?? 0);
      expect(current?.ratio).toBeGreaterThan(previous?.ratio ?? 0);
      expect(current?.gain).toBeLessThan(previous?.gain ?? 0);
    }
  });
});
