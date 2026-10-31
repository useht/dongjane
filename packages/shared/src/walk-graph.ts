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

// The nodes to pass through, in order, on the shortest way from one of `from` to one of `to` (the two ends are the nodes
// a point stands in; a point on a doorstep stands in two). Length is the distance between the centres of the areas.
export function routeBetween(graph: readonly WalkNode[], from: readonly number[], to: readonly number[]): number[] {
  let best: number[] = [from[0] ?? 0];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const source of from.length > 0 ? from : [0]) {
    const cost = graph.map(() => Number.POSITIVE_INFINITY);
    const previous = graph.map(() => -1);
    const done = graph.map(() => false);
    cost[source] = 0;
    for (;;) {
      let at = -1;
      for (let index = 0; index < graph.length; index += 1) {
        if (!done[index] && (cost[index] as number) < (at < 0 ? Number.POSITIVE_INFINITY : (cost[at] as number))) at = index;
      }
      if (at < 0) break;
      done[at] = true;
      const here = graph[at] as WalkNode;
      for (const next of here.neighbours) {
        const there = graph[next] as WalkNode;
        const total = (cost[at] as number) + Math.hypot(there.centre.x - here.centre.x, there.centre.z - here.centre.z);
        if (total < (cost[next] as number)) {
          cost[next] = total;
          previous[next] = at;
        }
      }
    }
    for (const target of to.length > 0 ? to : [0]) {
      if ((cost[target] as number) >= bestCost) continue;
      bestCost = cost[target] as number;
      const route = [target];
      while (route[0] !== source) route.unshift(previous[route[0] as number] as number);
      best = route;
    }
  }
  return best;
}
