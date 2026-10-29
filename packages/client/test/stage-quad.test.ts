import { describe, expect, it } from "vitest";
import { type Quad, applyQuadTransform, quadTransform } from "../src/ui/stage-quad.ts";

const W = 960;
const H = 540;

// bottom-left, bottom-right, top-right, top-left of a trapezoid wider at the bottom, the way a screen looks from below
const trapezoid: Quad = [
  { x: 120, y: 420 },
  { x: 600, y: 440 },
  { x: 540, y: 150 },
  { x: 170, y: 180 },
];

function corners(matrix: string): Quad {
  return [applyQuadTransform(matrix, 0, H), applyQuadTransform(matrix, W, H), applyQuadTransform(matrix, W, 0), applyQuadTransform(matrix, 0, 0)];
}

function expectQuad(actual: Quad, wanted: Quad): void {
  actual.forEach((point, i) => {
    expect(point.x, `corner ${i} x`).toBeCloseTo((wanted[i] as { x: number }).x, 2);
    expect(point.y, `corner ${i} y`).toBeCloseTo((wanted[i] as { y: number }).y, 2);
  });
}

describe("quadTransform", () => {
  it("lays the box's four corners on the quad's four corners", () => {
    const matrix = quadTransform(W, H, trapezoid);
    expect(matrix).not.toBeNull();
    expectQuad(corners(matrix as string), trapezoid);
  });

  it("is the identity when the quad is the box itself", () => {
    const same: Quad = [
      { x: 0, y: H },
      { x: W, y: H },
      { x: W, y: 0 },
      { x: 0, y: 0 },
    ];
    const matrix = quadTransform(W, H, same) as string;
    expectQuad(corners(matrix), same);
    const middle = applyQuadTransform(matrix, W / 2, H / 2);
    expect(middle.x).toBeCloseTo(W / 2, 3);
    expect(middle.y).toBeCloseTo(H / 2, 3);
  });

  it("handles a plain parallelogram without any perspective", () => {
    const skew: Quad = [
      { x: 50, y: 300 },
      { x: 450, y: 320 },
      { x: 470, y: 120 },
      { x: 70, y: 100 },
    ];
    const matrix = quadTransform(W, H, skew) as string;
    expectQuad(corners(matrix), skew);
    const values = matrix.slice("matrix3d(".length, -1).split(",").map(Number);
    expect(values[3]).toBe(0);
    expect(values[7]).toBe(0);
  });

  it("puts the box's middle where the quad's diagonals cross, which is what perspective does", () => {
    const matrix = quadTransform(W, H, trapezoid) as string;
    const middle = applyQuadTransform(matrix, W / 2, H / 2);
    // intersection of bottom-left to top-right with bottom-right to top-left
    const [bl, br, tr, tl] = trapezoid;
    const d1 = { x: tr.x - bl.x, y: tr.y - bl.y };
    const d2 = { x: tl.x - br.x, y: tl.y - br.y };
    const t = ((br.x - bl.x) * d2.y - (br.y - bl.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
    expect(middle.x).toBeCloseTo(bl.x + d1.x * t, 2);
    expect(middle.y).toBeCloseTo(bl.y + d1.y * t, 2);
  });

  it("keeps straight lines straight: a point on the box's top edge stays on the quad's top edge", () => {
    const matrix = quadTransform(W, H, trapezoid) as string;
    const on = applyQuadTransform(matrix, W * 0.3, 0);
    const [, , tr, tl] = trapezoid;
    const cross = (on.x - tl.x) * (tr.y - tl.y) - (on.y - tl.y) * (tr.x - tl.x);
    expect(Math.abs(cross)).toBeLessThan(1e-2);
  });

  it("refuses a quad that has collapsed into a line", () => {
    const flat: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ];
    expect(quadTransform(W, H, flat)).toBeNull();
  });

  it("refuses numbers that are not finite", () => {
    const broken: Quad = [
      { x: Number.NaN, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(quadTransform(W, H, broken)).toBeNull();
  });
});
