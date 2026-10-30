export interface Point2 {
  x: number;
  y: number;
}

// The screen's corners as the viewer sees them on the canvas: bottom-left, bottom-right, top-right, top-left.
export type Quad = readonly [Point2, Point2, Point2, Point2];

// CSS matrix3d() that lays a width x height box (origin at its top-left corner) over a quadrilateral.
// The quad is the projected screen, so it is a perspective warp rather than a rotation, and a plain
// transform cannot make it; the 3x3 homography below is the exact map and matrix3d can carry it.
export function quadTransform(width: number, height: number, quad: Quad): string | null {
  const [bottomLeft, bottomRight, topRight, topLeft] = quad;
  const x0 = topLeft.x;
  const y0 = topLeft.y;
  const x1 = topRight.x;
  const y1 = topRight.y;
  const x2 = bottomRight.x;
  const y2 = bottomRight.y;
  const x3 = bottomLeft.x;
  const y3 = bottomLeft.y;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;

  // The unit square maps to the quad; scaling the columns lets the box's own pixels stand in for it.
  const values = [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, x0, y0, 0, 1];
  if (!values.every(Number.isFinite)) return null;
  return `matrix3d(${values.map((value) => Number(value.toPrecision(10))).join(",")})`;
}

// Where a point of the box lands under quadTransform's matrix; tests use it to check the corners.
export function applyQuadTransform(matrix: string, x: number, y: number): Point2 {
  const body = /^matrix3d\((.*)\)$/.exec(matrix)?.[1];
  if (body === undefined) throw new Error(`not a matrix3d: ${matrix}`);
  const m = body.split(",").map(Number);
  const get = (index: number): number => m[index] ?? Number.NaN;
  const w = get(3) * x + get(7) * y + get(15);
  return { x: (get(0) * x + get(4) * y + get(12)) / w, y: (get(1) * x + get(5) * y + get(13)) / w };
}
