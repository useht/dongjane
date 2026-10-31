import type { Bounds } from "./layout.ts";
import type { VenueDef } from "./venues/types.ts";

// The walkable world as a graph: every area of every venue is a node, and two areas that touch along an edge (a doorstep) are
// neighbours, as long as their venues are the same or linked. The nodes are numbered breadth-first from the area the
// visitors arrive in, so the numbers do not depend on the order the venues are listed in.

export interface WalkNode {
  readonly area: Bounds;
  readonly venue: string;
  // the computer-driven monks stroll here
  readonly stroll: boolean;
  readonly neighbours: readonly number[];
  readonly centre: { readonly x: number; readonly z: number };
}

// Areas whose edges differ by less than this are taken to touch.
const TOUCH = 1e-6;

export function touches(a: Bounds, b: Bounds): boolean {
  const across = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const along = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return (Math.abs(across) <= TOUCH && along > TOUCH) || (Math.abs(along) <= TOUCH && across > TOUCH);
}

const holds = (area: Bounds, x: number, z: number): boolean => x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;

export function buildWalkGraph(venues: readonly VenueDef[], arrival: { readonly x: number; readonly z: number }): readonly WalkNode[] {
  const listed = venues.flatMap((venue) => venue.areas.map((area) => ({ area, venue })));
  const joined = (a: VenueDef, b: VenueDef): boolean => a.id === b.id || a.links.includes(b.id) || b.links.includes(a.id);
  const adjacent: number[][] = listed.map((a, i) =>
    listed.flatMap((b, j) => (i !== j && joined(a.venue, b.venue) && touches(a.area, b.area) ? [j] : [])),
  );

  const first = listed.findIndex((entry) => holds(entry.area, arrival.x, arrival.z));
  if (first < 0) throw new Error("the arrival point is on no walkable area");
  const order = [first];
  const seen = new Set(order);
  for (let at = 0; at < order.length; at += 1) {
    for (const next of adjacent[order[at] as number] as number[]) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
    }
  }
  const lost = listed.findIndex((_, index) => !seen.has(index));
  if (lost >= 0) throw new Error(`an area of ${(listed[lost] as (typeof listed)[number]).venue.id} is not joined to the arrival`);

  const numbered = new Map(order.map((listedIndex, index) => [listedIndex, index]));
  return order.map((listedIndex) => {
    const { area, venue } = listed[listedIndex] as (typeof listed)[number];
    const neighbours = (adjacent[listedIndex] as number[]).map((next) => numbered.get(next) as number).sort((a, b) => a - b);
    return {
      area,
      venue: venue.id,
      stroll: venue.npc.stroll,
      neighbours,
      centre: { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 },
    };
  });
}

// Every way from area `from` to one of the areas `goals` that never visits an area twice, as lists of node numbers. Where the
// graph has a ring (the casino's floor) there is more than one, and the caller picks the shortest by the walk itself.
export function routesBetween(graph: readonly WalkNode[], from: number, goals: readonly number[]): number[][] {
  const found: number[][] = [];
  const walk = (trail: number[]): void => {
    const at = trail[trail.length - 1] as number;
    if (goals.includes(at)) {
      found.push(trail);
      return;
    }
    for (const next of graph[at]?.neighbours ?? []) if (!trail.includes(next)) walk([...trail, next]);
  };
  walk([from]);
  return found;
}
