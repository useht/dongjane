import type { Bounds, SeatSpot } from "../layout.ts";

// A venue is a place in the world with its own ground, and maybe its own seats and things to do. The world is the list of
// its venues (index.ts); the rules, the walk graph and the client read that list and spell no venue's name themselves.
// A venue file may import layout.ts and casino-layout.ts but never anything that imports the registry.

// Where visitors kneel in a venue: the spots, the way a seated monk faces, and how the rows are counted.
export interface SeatGroup {
  // what one place is called: 돗자리, 방석
  readonly name: string;
  readonly spots: readonly SeatSpot[];
  readonly yaw: number;
  // how far back a spot is from what the venue faces, and how far it is to the side of the middle line
  readonly depth: (spot: SeatSpot) => number;
  readonly offset: (spot: SeatSpot) => number;
  // how high a kneeling monk sits above the ground
  readonly top: number;
}

// Something to do at a spot on the floor: (x, z) is its middle, yaw the way its front faces, and (frontX, frontZ) the point
// a visitor stands on to use it.
export interface ActivitySpot {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly frontX: number;
  readonly frontZ: number;
}

export interface VenueDef {
  // the wire id: the `zone` field of a message and of a seat is this string
  readonly id: string;
  readonly name: string;
  // the ground the venue stands on; a walker inside it is "in" the venue
  readonly footprint: Bounds;
  // the convex rectangles feet may stand on here; two that touch along an edge are joined by a doorstep
  readonly areas: readonly Bounds[];
  // the ids of the venues whose areas this venue's areas may touch (the walk graph joins touching areas of linked venues)
  readonly links: readonly string[];
  readonly seats?: SeatGroup;
  readonly activities?: readonly ActivitySpot[];
  readonly npc: {
    // whether the computer-driven monks stroll over this venue's areas
    readonly stroll: boolean;
    // how readily a monk who wants a change of scene walks to this venue's seats (0: never)
    readonly seatWeight: number;
  };
  // walls and a roof: the camera comes in under the roof, and the sea is not heard
  readonly indoor: boolean;
}

// A venue's definition keeps its literal id, so the seated ones can be told apart by type.
export function defineVenue<const T extends VenueDef>(venue: T): T {
  return venue;
}

export function boundsOf(areas: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(...areas.map((area) => area.minX)),
    maxX: Math.max(...areas.map((area) => area.maxX)),
    minZ: Math.min(...areas.map((area) => area.minZ)),
    maxZ: Math.max(...areas.map((area) => area.maxZ)),
  };
}
