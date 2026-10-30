import { describe, expect, it } from "vitest";
import { SCRATCH_REVEAL_AT, ScratchCoverage } from "../src/casino/scratch-card.ts";

describe("ScratchCoverage", () => {
  it("starts fully coated", () => {
    const coverage = new ScratchCoverage();
    expect(coverage.share).toBe(0);
    expect(coverage.revealed).toBe(false);
  });

  it("counts the coating a dot takes off, and nothing twice", () => {
    const coverage = new ScratchCoverage();
    coverage.dot(0.5, 0.5, 0.1);
    const once = coverage.share;
    expect(once).toBeGreaterThan(0.02);
    expect(once).toBeLessThan(0.05);
    coverage.dot(0.5, 0.5, 0.1);
    expect(coverage.share).toBe(once);
  });

  it("clips a stroke at the edge of the card", () => {
    const coverage = new ScratchCoverage();
    coverage.stroke(-0.5, -0.5, -0.2, -0.2, 0.05);
    expect(coverage.share).toBe(0);
    coverage.stroke(-0.5, 0.5, 1.5, 0.5, 0.05);
    expect(coverage.share).toBeGreaterThan(0.08);
    expect(coverage.share).toBeLessThan(0.14);
  });

  it("fills a gap between two pointer positions with no holes", () => {
    const coverage = new ScratchCoverage();
    coverage.stroke(0.1, 0.5, 0.9, 0.5, 0.04);
    const strip = coverage.share;
    const direct = new ScratchCoverage();
    for (let step = 0; step <= 200; step += 1) direct.dot(0.1 + (0.8 * step) / 200, 0.5, 0.04);
    expect(strip).toBeCloseTo(direct.share, 2);
  });

  it("is revealed at about sixty percent, and not before", () => {
    expect(SCRATCH_REVEAL_AT).toBe(0.6);
    const coverage = new ScratchCoverage();
    let rows = 0;
    while (!coverage.revealed && rows < 40) {
      coverage.stroke(0, rows / 40 + 0.0125, 1, rows / 40 + 0.0125, 0.02);
      rows += 1;
    }
    expect(rows).toBe(24);
    expect(coverage.revealed).toBe(true);
    expect(coverage.share).toBeGreaterThanOrEqual(0.6);
    expect(coverage.share).toBeLessThan(0.7);
  });

  it("clears all at once and starts over", () => {
    const coverage = new ScratchCoverage();
    coverage.clearAll();
    expect(coverage.share).toBe(1);
    expect(coverage.revealed).toBe(true);
    coverage.reset();
    expect(coverage.share).toBe(0);
    expect(coverage.revealed).toBe(false);
  });
});
