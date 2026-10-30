import { describe, expect, it } from "vitest";
import { ROULETTE_POCKETS, rouletteColor } from "@dongjane/shared";
import { WHEEL_ORDER, WHEEL_SPIN_MS, WHEEL_STEP, ballAt, landingRotation, pocketAtPointer, wheelRotation } from "../src/casino/wheel.ts";

describe("wheel order", () => {
  it("holds every pocket once, with zero first", () => {
    expect(WHEEL_ORDER).toHaveLength(ROULETTE_POCKETS);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: ROULETTE_POCKETS }, (_, pocket) => pocket));
    expect(WHEEL_ORDER[0]).toBe(0);
  });

  it("alternates red and black all the way round, as the real wheel does", () => {
    const colors = WHEEL_ORDER.slice(1).map(rouletteColor);
    colors.forEach((color, at) => expect(color).toBe(at % 2 === 0 ? "red" : "black"));
  });

  it("puts the odd and even numbers on both colours", () => {
    expect(WHEEL_ORDER.slice(1).filter((pocket) => pocket % 2 === 1)).toHaveLength(18);
  });
});

describe("landing", () => {
  it("brings the decided pocket under the pointer from any rotation", () => {
    for (const current of [0, 1.234, 5.5, 40, -3, 123.456]) {
      for (let pocket = 0; pocket < ROULETTE_POCKETS; pocket += 1) {
        const target = landingRotation(current, pocket, 3);
        expect(pocketAtPointer(target), `pocket ${pocket} from ${current}`).toBe(pocket);
      }
    }
  });

  it("turns at least the turns asked for, and always clockwise", () => {
    for (let pocket = 0; pocket < ROULETTE_POCKETS; pocket += 1) {
      const target = landingRotation(2, pocket, 3);
      expect(target - 2).toBeGreaterThanOrEqual(3 * Math.PI * 2 - 1e-9);
      expect(target - 2).toBeLessThan(4 * Math.PI * 2);
    }
    expect(landingRotation(0, 0, 0)).toBeCloseTo(0);
  });

  it("reads the pocket under the pointer at rest", () => {
    expect(pocketAtPointer(0)).toBe(0);
    expect(pocketAtPointer(-WHEEL_STEP)).toBe(WHEEL_ORDER[1]);
    expect(pocketAtPointer(-WHEEL_STEP * 0.4)).toBe(0);
  });
});

describe("wheel and ball motion", () => {
  it("runs 2.2 s, starts where it was and slows to rest exactly on the target", () => {
    expect(WHEEL_SPIN_MS).toBe(2200);
    expect(wheelRotation(1, 30, 0, WHEEL_SPIN_MS)).toBe(1);
    expect(wheelRotation(1, 30, WHEEL_SPIN_MS, WHEEL_SPIN_MS)).toBe(30);
    expect(wheelRotation(1, 30, 5000, WHEEL_SPIN_MS)).toBe(30);
    let before = 1;
    for (let ms = 0; ms <= WHEEL_SPIN_MS; ms += 16) {
      const at = wheelRotation(1, 30, ms, WHEEL_SPIN_MS);
      expect(at).toBeGreaterThanOrEqual(before);
      before = at;
    }
  });

  it("goes straight to the target without motion", () => {
    expect(wheelRotation(1, 30, 0, 0)).toBe(30);
    expect(ballAt(0, 0)).toEqual({ angle: 0, drop: 0 });
  });

  it("keeps the ball on the track, then drops it into the pocket at the pointer", () => {
    expect(ballAt(0, WHEEL_SPIN_MS).drop).toBe(1);
    expect(ballAt(WHEEL_SPIN_MS * 0.5, WHEEL_SPIN_MS).drop).toBe(1);
    expect(ballAt(WHEEL_SPIN_MS * 0.9, WHEEL_SPIN_MS).drop).toBeLessThan(1);
    expect(ballAt(WHEEL_SPIN_MS, WHEEL_SPIN_MS)).toEqual({ angle: 0, drop: 0 });
    let before = 1;
    for (let ms = 0; ms <= WHEEL_SPIN_MS; ms += 16) {
      const { drop } = ballAt(ms, WHEEL_SPIN_MS);
      expect(drop).toBeLessThanOrEqual(before);
      before = drop;
    }
  });
});
