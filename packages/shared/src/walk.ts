import { type Bounds, DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_PORCH_Z, SHORE, WORLD_BOUNDS, type Zone, dharmaToWorld } from "./layout.ts";

// Where feet may go. The world is four rectangles in a chain: the plaza, the court between the plaza and the 법당's
// porch (the door faces +x, so the court is the strip along the plaza's west edge), the doorway through the front
// wall, and the room inside. Every rectangle is convex, so a straight line between two points of the same one is
// always walkable, and a walk across the world is a few such lines joined at the places where two rectangles touch.

export interface Point {
  x: number;
  z: number;
}

export const PLAZA_AREA: Bounds = WORLD_BOUNDS;
// The court covers the plaza's whole depth (z) and runs from the porch's edge to the plaza.
export const COURT_AREA: Bounds = {
  minX: dharmaToWorld(0, DHARMA_PORCH_Z).x,
  maxX: WORLD_BOUNDS.minX,
  minZ: WORLD_BOUNDS.minZ,
  maxZ: WORLD_BOUNDS.maxZ,
};
// The doorway runs through the front wall and the porch, 2.8 m wide, centred on the door.
export const DOORWAY_AREA: Bounds = {
  minX: DHARMA_BOUNDS.maxX,
  maxX: COURT_AREA.minX,
  minZ: DHARMA_ORIGIN.z - 1.4,
  maxZ: DHARMA_ORIGIN.z + 1.4,
};
export const INTERIOR_AREA: Bounds = DHARMA_BOUNDS;

// The chain, from the room outward: each area touches the next along a doorstep.
const CHAIN: readonly Bounds[] = [INTERIOR_AREA, DOORWAY_AREA, COURT_AREA, PLAZA_AREA, SHORE];

// A walker's body is wider than a point: crossing a doorstep, it stays this far from the edge of the opening.
const DOORSTEP_MARGIN = 0.35;
// Positions travel as 32-bit floats, so a monk standing on an edge may be a hair outside it.
const EDGE = 1e-5;
const SAME_POINT = 1e-3;
const TIE = 1e-9;
// A walk through a few doorsteps settles in a handful of rounds; it is called done when no corner moves more than this.
const SETTLE_ROUNDS = 24;
const SETTLED = 1e-6;

function contains(area: Bounds, x: number, z: number): boolean {
  return x >= area.minX - EDGE && x <= area.maxX + EDGE && z >= area.minZ - EDGE && z <= area.maxZ + EDGE;
}

function clampTo(area: Bounds, x: number, z: number): Point {
  return { x: Math.min(area.maxX, Math.max(area.minX, x)), z: Math.min(area.maxZ, Math.max(area.minZ, z)) };
}

export function randomPointIn(area: Bounds, random: () => number): Point {
  return { x: area.minX + random() * (area.maxX - area.minX), z: area.minZ + random() * (area.maxZ - area.minZ) };
}

const CHAIN_AREAS = CHAIN.map((area) => (area.maxX - area.minX) * (area.maxZ - area.minZ));
const CHAIN_AREA_TOTAL = CHAIN_AREAS.reduce((sum, area) => sum + area, 0);

// A point spread evenly over every walkable area of the world.
export function randomWalkable(random: () => number): Point {
  let pick = random() * CHAIN_AREA_TOTAL;
  let index = 0;
  while (index < CHAIN.length - 1 && pick >= (CHAIN_AREAS[index] as number)) {
    pick -= CHAIN_AREAS[index] as number;
    index += 1;
  }
  return randomPointIn(CHAIN[index] as Bounds, random);
}

function indexesAt(x: number, z: number): number[] {
  const found: number[] = [];
  CHAIN.forEach((area, index) => {
    if (contains(area, x, z)) found.push(index);
  });
  return found;
}

// The walkable point nearest to (x, z). When two areas are equally near, the one `from` stands in wins, so a walker
// pressing against a wall slides along it instead of being pulled through the doorway.
export function resolveWalkable(x: number, z: number, from?: Point): Point {
  const home = from ? indexesAt(from.x, from.z) : [];
  let best: Point = { x, z };
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIsHome = false;
  CHAIN.forEach((area, index) => {
    const point = clampTo(area, x, z);
    const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
    const isHome = home.includes(index);
    const closer = distance < bestDistance - TIE;
    const tie = Math.abs(distance - bestDistance) <= TIE && isHome && !bestIsHome;
    if (closer || tie) {
      best = point;
      bestDistance = distance;
      bestIsHome = isHome;
    }
  });
  return best;
}

// Like resolveWalkable, but only on the ground `from` stands on, so a short stroll against a wall slides along it
// instead of jumping to a nearer room behind the wall; crossing between areas is for planPath.
export function resolveNearby(x: number, z: number, from: Point): Point {
  const here = indexesAt(from.x, from.z);
  if (here.length === 0) return resolveWalkable(x, z, from);
  let best = { x, z };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const index of here) {
    const point = clampTo(CHAIN[index] as Bounds, x, z);
    const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

// The zone a walker is in: the 법당 inside its front door, the open ground otherwise (the doorstep included).
export function zoneAt(x: number, z: number): Zone {
  return contains(INTERIOR_AREA, x, z) ? "dharma" : "gatbawi";
}

// The stretch of floor two neighbouring areas share, pulled in from both ends so a monk does not scrape the jamb.
function doorstep(a: Bounds, b: Bounds): { from: Point; to: Point } {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minZ = Math.max(a.minZ, b.minZ);
  const maxZ = Math.min(a.maxZ, b.maxZ);
  const inset = (low: number, high: number): [number, number] =>
    high - low > DOORSTEP_MARGIN * 2 ? [low + DOORSTEP_MARGIN, high - DOORSTEP_MARGIN] : [(low + high) / 2, (low + high) / 2];
  const [x0, x1] = inset(minX, maxX);
  const [z0, z1] = inset(minZ, maxZ);
  return { from: { x: x0, z: z0 }, to: { x: x1, z: z1 } };
}

// The point of the doorstep that makes the walk `a` -> doorstep -> `b` shortest: where the straight line from `a` to `b`
// crosses it, or, when both lie on one side of it, where the line from `a` to `b` mirrored across it does; clamped to the
// doorstep when that misses it.
function crossing(step: { from: Point; to: Point }, a: Point, b: Point): Point {
  const alongX = step.to.x - step.from.x > step.to.z - step.from.z;
  // The doorstep is a segment at `level` on the axis it does not run along; `a` and `b` are seen as (across, along).
  const level = alongX ? step.from.z : step.from.x;
  const [low, high] = alongX ? [step.from.x, step.to.x] : [step.from.z, step.to.z];
  const [aAcross, aAlong] = alongX ? [a.z, a.x] : [a.x, a.z];
  const [bAcross, bAlong] = alongX ? [b.z, b.x] : [b.x, b.z];
  const mirrored = (aAcross - level) * (bAcross - level) > 0 ? 2 * level - bAcross : bAcross;
  const span = mirrored - aAcross;
  const t = Math.abs(span) < EDGE ? 0.5 : (level - aAcross) / span;
  const along = Math.min(high, Math.max(low, aAlong + (bAlong - aAlong) * Math.min(1, Math.max(0, t))));
  return alongX ? { x: along, z: level } : { x: level, z: along };
}

// The corners of the shortest walk from `start` through each doorstep in turn to `end`. Every doorstep's crossing is
// the best one given its neighbours, and the neighbours move as the crossings do, so they are settled by going round
// until nothing moves (the length is convex in the crossings, so this ends at the shortest walk).
function shortestCrossings(steps: readonly { from: Point; to: Point }[], start: Point, end: Point): Point[] {
  const corners: Point[] = steps.map((step) => ({ x: (step.from.x + step.to.x) / 2, z: (step.from.z + step.to.z) / 2 }));
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    let moved = 0;
    steps.forEach((step, index) => {
      const before = (corners[index - 1] ?? start) as Point;
      const after = (corners[index + 1] ?? end) as Point;
      const next = crossing(step, before, after);
      moved = Math.max(moved, Math.hypot(next.x - (corners[index] as Point).x, next.z - (corners[index] as Point).z));
      corners[index] = next;
    });
    if (moved < SETTLED) break;
  }
  return corners;
}

function nearestPair(from: readonly number[], to: readonly number[]): [number, number] {
  let best: [number, number] = [from[0] ?? 0, to[0] ?? 0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const a of from) {
    for (const b of to) {
      if (Math.abs(a - b) < bestGap) {
        bestGap = Math.abs(a - b);
        best = [a, b];
      }
    }
  }
  return best;
}

// The corners to walk through, in order, to get from `from` to the walkable point nearest `to`; the last one is that
// point itself. Inside one area it is just the point; between areas it passes each doorstep on the way.
export function planPath(from: Point, to: Point): Point[] {
  const end = resolveWalkable(to.x, to.z, from);
  const start = resolveWalkable(from.x, from.z);
  const [first, last] = nearestPair(indexesAt(start.x, start.z), indexesAt(end.x, end.z));
  const direction = first <= last ? 1 : -1;
  const steps: { from: Point; to: Point }[] = [];
  for (let index = first; index !== last; index += direction) {
    steps.push(doorstep(CHAIN[index] as Bounds, CHAIN[index + direction] as Bounds));
  }
  const path: Point[] = [];
  let previous: Point = start;
  for (const corner of shortestCrossings(steps, start, end)) {
    if (Math.hypot(corner.x - previous.x, corner.z - previous.z) > SAME_POINT) path.push(corner);
    previous = corner;
  }
  path.push(end);
  return path;
}

// The part of the straight walk from `from` by (dx, dz) that lies inside one area, as the fractions of the walk it covers
// (null when none of it does).
function insideArea(area: Bounds, from: Point, dx: number, dz: number): [number, number] | null {
  let low = 0;
  let high = 1;
  const axes: [number, number, number, number][] = [
    [from.x, dx, area.minX - EDGE, area.maxX + EDGE],
    [from.z, dz, area.minZ - EDGE, area.maxZ + EDGE],
  ];
  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-12) {
      if (start < min || start > max) return null;
      continue;
    }
    const a = (min - start) / delta;
    const b = (max - start) / delta;
    low = Math.max(low, Math.min(a, b));
    high = Math.min(high, Math.max(a, b));
  }
  return low <= high ? [low, high] : null;
}

// The farthest point along the straight walk from `from` by (dx, dz) that is still on ground: the walk may cross from one
// area into the next, and stops on the edge of the last one it can stay in.
function walkAsFarAsPossible(from: Point, dx: number, dz: number): Point {
  const target = { x: from.x + dx, z: from.z + dz };
  const spans = CHAIN.map((area) => insideArea(area, from, dx, dz));
  if (!spans.some((span) => span !== null && span[0] <= 1e-9)) return resolveWalkable(from.x, from.z);
  let reach = 0;
  for (let round = 0; round < CHAIN.length; round += 1) {
    let grown = reach;
    for (const span of spans) {
      if (span && span[0] <= reach + 1e-9 && span[1] > grown) grown = span[1];
    }
    if (grown === reach) break;
    reach = grown;
  }
  if (reach >= 1) return target;
  return resolveWalkable(from.x + dx * reach, from.z + dz * reach, from);
}

// Where a walker who pushes by (dx, dz) ends up: the whole way when the ground allows it, otherwise as far as it
// allows, sliding along a wall the way a walker would: one axis and then the other, whichever order carries them farther.
export function slideWalkable(from: Point, dx: number, dz: number): Point {
  const full = walkAsFarAsPossible(from, dx, dz);
  if (Math.hypot(full.x - from.x - dx, full.z - from.z - dz) < 1e-9) return full;
  const xFirst = walkAsFarAsPossible(walkAsFarAsPossible(from, dx, 0), 0, dz);
  const zFirst = walkAsFarAsPossible(walkAsFarAsPossible(from, 0, dz), dx, 0);
  let best = full;
  for (const candidate of [xFirst, zFirst]) {
    if (Math.hypot(candidate.x - from.x, candidate.z - from.z) > Math.hypot(best.x - from.x, best.z - from.z) + 1e-9) best = candidate;
  }
  return best;
}
