import { type BufferGeometry, Vector3 } from "three";

type Corners = [Vector3, Vector3, Vector3];

// A mesh as triangles of vertex indices, with the vertices that share a position (the file splits them for their normals) given one id,
// so two triangles that meet along an edge are neighbours whichever of those vertices they use.
export type WeldedMesh = { triangles: [number, number, number][]; id: number[] };

export function weld(geometry: BufferGeometry): WeldedMesh {
  const position = geometry.getAttribute("position");
  const ids = new Map<string, number>();
  const id: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map((value) => Math.round(value * 1e5)).join(",");
    if (!ids.has(key)) ids.set(key, ids.size);
    id.push(ids.get(key) as number);
  }
  const index = geometry.index;
  const count = (index ? index.count : position.count) / 3;
  const triangles = Array.from({ length: count }, (_, t): [number, number, number] => {
    const corner = (k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
    return [corner(0), corner(1), corner(2)];
  });
  return { triangles, id };
}

// Whether the segment p-q passes through the inside of the triangle abc (Moller-Trumbore, the ends and the rim excluded).
const EDGE_1 = new Vector3();
const EDGE_2 = new Vector3();
const DIRECTION = new Vector3();
const FROM = new Vector3();
const CROSS_H = new Vector3();
const CROSS_Q = new Vector3();
const MARGIN = 1e-6;

function pierces(p: Vector3, q: Vector3, a: Vector3, b: Vector3, c: Vector3): boolean {
  EDGE_1.subVectors(b, a);
  EDGE_2.subVectors(c, a);
  DIRECTION.subVectors(q, p);
  CROSS_H.crossVectors(DIRECTION, EDGE_2);
  const det = EDGE_1.dot(CROSS_H);
  if (Math.abs(det) < 1e-18) return false;
  FROM.subVectors(p, a);
  const u = FROM.dot(CROSS_H) / det;
  if (u < MARGIN || u > 1 - MARGIN) return false;
  CROSS_Q.crossVectors(FROM, EDGE_1);
  const v = DIRECTION.dot(CROSS_Q) / det;
  if (v < MARGIN || u + v > 1 - MARGIN) return false;
  const t = EDGE_2.dot(CROSS_Q) / det;
  return t > MARGIN && t < 1 - MARGIN;
}

// How many pairs of the mesh's triangles pass through each other once its vertices are at `points`, not counting the pairs that share a
// corner. Two triangles cross when an edge of one pierces the other.
export function crossingPairs(mesh: WeldedMesh, points: Vector3[]): number {
  const { triangles, id } = mesh;
  const corners = triangles.map((t) => t.map((i) => points[i] as Vector3) as Corners);
  const low = corners.map((c) => new Vector3(Math.min(c[0].x, c[1].x, c[2].x), Math.min(c[0].y, c[1].y, c[2].y), Math.min(c[0].z, c[1].z, c[2].z)));
  const high = corners.map((c) => new Vector3(Math.max(c[0].x, c[1].x, c[2].x), Math.max(c[0].y, c[1].y, c[2].y), Math.max(c[0].z, c[1].z, c[2].z)));
  const order = triangles.map((_, i) => i).sort((a, b) => (low[a] as Vector3).x - (low[b] as Vector3).x);
  const pierce = (from: Corners, into: Corners): boolean =>
    pierces(from[0], from[1], into[0], into[1], into[2]) || pierces(from[1], from[2], into[0], into[1], into[2]) || pierces(from[2], from[0], into[0], into[1], into[2]);
  let pairs = 0;
  for (let n = 0; n < order.length; n += 1) {
    const first = order[n] as number;
    const lo1 = low[first] as Vector3;
    const hi1 = high[first] as Vector3;
    for (let m = n + 1; m < order.length; m += 1) {
      const second = order[m] as number;
      const lo2 = low[second] as Vector3;
      const hi2 = high[second] as Vector3;
      if (lo2.x > hi1.x) break;
      if (lo2.y > hi1.y || lo1.y > hi2.y || lo2.z > hi1.z || lo1.z > hi2.z) continue;
      if ((triangles[first] as number[]).some((i) => (triangles[second] as number[]).some((j) => id[i] === id[j]))) continue;
      const a = corners[first] as Corners;
      const b = corners[second] as Corners;
      if (pierce(a, b) || pierce(b, a)) pairs += 1;
    }
  }
  return pairs;
}

// How many edges of the mesh do not belong to exactly two of its triangles: none for a closed surface.
export function looseEdges(mesh: WeldedMesh): number {
  const uses = new Map<string, number>();
  for (const triangle of mesh.triangles) {
    for (let k = 0; k < 3; k += 1) {
      const a = mesh.id[triangle[k] as number] as number;
      const b = mesh.id[triangle[(k + 1) % 3] as number] as number;
      const edge = a < b ? `${a}-${b}` : `${b}-${a}`;
      uses.set(edge, (uses.get(edge) ?? 0) + 1);
    }
  }
  return [...uses.values()].filter((count) => count !== 2).length;
}
