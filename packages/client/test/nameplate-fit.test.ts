import { describe, expect, it } from "vitest";
import { fitPlate } from "../src/game/nameplate-fit.ts";

describe("fitPlate", () => {
  it("leaves a plate in the middle of the screen alone", () => {
    expect(fitPlate(0.1, 0.2, 0.2)).toEqual({ shift: 0, opacity: 1 });
  });

  it("pulls a plate that would be clipped by the left edge back inside", () => {
    const fit = fitPlate(-0.95, 0, 0.2);
    expect(-0.95 + fit.shift - 0.2).toBeGreaterThanOrEqual(-1);
    expect(fit.shift).toBeGreaterThan(0);
    expect(fit.opacity).toBe(1);
  });

  it("pulls a plate that would be clipped by the right edge back inside", () => {
    const fit = fitPlate(0.9, 0, 0.2);
    expect(0.9 + fit.shift + 0.2).toBeLessThanOrEqual(1);
    expect(fit.shift).toBeLessThan(0);
  });

  it("fades the plate once its monk is past the edge and hides it further out", () => {
    const partway = fitPlate(1.1, 0, 0.2);
    expect(partway.opacity).toBeGreaterThan(0);
    expect(partway.opacity).toBeLessThan(1);
    expect(fitPlate(1.4, 0, 0.2).opacity).toBe(0);
    expect(fitPlate(0, -1.4, 0.2).opacity).toBe(0);
    expect(fitPlate(0, 1.1, 0.2).opacity).toBeLessThan(1);
  });

  it("centres a plate wider than the screen instead of overflowing", () => {
    expect(fitPlate(0.3, 0, 1.4).shift).toBeCloseTo(-0.3, 9);
  });
});
