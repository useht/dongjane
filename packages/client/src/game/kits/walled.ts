import { type Bounds, DOOR_WIDTH, SLOT_WALL } from "@dongjane/shared";
import type { KitPiece, Paint, Vec3 } from "./kit.ts";

// What the walled venues (the bathhouse, the church) build their shells from: a box, the four walls of a slot with a gap for the
// door in the north wall, and a band that runs round the outside of those walls.

export const box = (min: Vec3, max: Vec3, paint: Paint, skip?: readonly string[]): KitPiece =>
  skip ? { shape: "box", min, max, paint, skip } : { shape: "box", min, max, paint };

export interface WallHeights {
  // where the walls stand from and rise to
  readonly base: number;
  readonly top: number;
  // the underside of the beam over the door
  readonly lintel: number;
}

// The walls of a slot, SLOT_WALL thick, with a gap for the door in the north wall, in the middle of it.
export function walls(slot: Bounds, heights: WallHeights, paint: string): KitPiece[] {
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = slot;
  const { base, top, lintel } = heights;
  const middle = (x0 + x1) / 2;
  const door = DOOR_WIDTH / 2;
  return [
    box([x0, base, z0], [middle - door, top, z0 + SLOT_WALL], paint),
    box([middle + door, base, z0], [x1, top, z0 + SLOT_WALL], paint),
    box([middle - door, lintel, z0], [middle + door, top, z0 + SLOT_WALL], paint),
    box([x0, base, z1 - SLOT_WALL], [x1, top, z1], paint),
    box([x0, base, z0 + SLOT_WALL], [x0 + SLOT_WALL, top, z1 - SLOT_WALL], paint),
    box([x1 - SLOT_WALL, base, z0 + SLOT_WALL], [x1, top, z1 - SLOT_WALL], paint),
  ];
}

// A band round the wall, a little proud of it: a plinth at its foot or a beam under the eaves. With `door` the north side leaves the doorway open.
export function band(slot: Bounds, y0: number, y1: number, grow: number, paint: string, door: boolean): KitPiece[] {
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = slot;
  const middle = (x0 + x1) / 2;
  const half = DOOR_WIDTH / 2;
  const g = grow;
  const pieces: KitPiece[] = [
    box([x0 - g, y0, z1 - SLOT_WALL - g], [x1 + g, y1, z1 + g], paint),
    box([x0 - g, y0, z0 + SLOT_WALL - g], [x0 + SLOT_WALL + g, y1, z1 - SLOT_WALL + g], paint),
    box([x1 - SLOT_WALL - g, y0, z0 + SLOT_WALL - g], [x1 + g, y1, z1 - SLOT_WALL + g], paint),
  ];
  if (door) {
    pieces.push(box([x0 - g, y0, z0 - g], [middle - half, y1, z0 + SLOT_WALL + g], paint));
    pieces.push(box([middle + half, y0, z0 - g], [x1 + g, y1, z0 + SLOT_WALL + g], paint));
  } else {
    pieces.push(box([x0 - g, y0, z0 - g], [x1 + g, y1, z0 + SLOT_WALL + g], paint));
  }
  return pieces;
}

export interface WindowStyle {
  readonly y0: number;
  readonly y1: number;
  readonly frame: string;
}

const BAR = 0.12;
const MULLION = 0.05;
const FRAME_OUT = 0.1;
const PANE_OUT = 0.04;

// A framed window in a wall of the slot, `along` the wall and `width` wide: a pane that stands a little out of both faces of the wall,
// in a frame of four bars that stands a little further out, with a cross of mullions in front of the pane. `axis` is the way the wall
// runs ("z" for a wall that faces north or south) and `wall` the coordinate of its middle.
export function framedWindow(axis: "x" | "z", wall: number, along: number, width: number, style: WindowStyle, glass: string): { frames: KitPiece[]; pane: KitPiece } {
  const { y0, y1, frame } = style;
  const half = width / 2;
  const slab = (a0: number, a1: number, b0: number, b1: number, out: number, paint: Paint): KitPiece => {
    const near = wall - SLOT_WALL / 2 - out;
    const far = wall + SLOT_WALL / 2 + out;
    return axis === "z" ? box([a0, b0, near], [a1, b1, far], paint) : box([near, b0, a0], [far, b1, a1], paint);
  };
  const wood = (a0: number, a1: number, b0: number, b1: number, out = FRAME_OUT): KitPiece => slab(a0, a1, b0, b1, out, frame);
  const middle = (y0 + y1) / 2;
  return {
    frames: [
      wood(along - half - BAR, along + half + BAR, y0 - BAR, y0),
      wood(along - half - BAR, along + half + BAR, y1, y1 + BAR),
      wood(along - half - BAR, along - half, y0, y1),
      wood(along + half, along + half + BAR, y0, y1),
      wood(along - MULLION / 2, along + MULLION / 2, y0, y1, PANE_OUT + 0.02),
      wood(along - half, along + half, middle - MULLION / 2, middle + MULLION / 2, PANE_OUT + 0.02),
    ],
    pane: slab(along - half, along + half, y0, y1, PANE_OUT, glass),
  };
}
