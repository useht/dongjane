import type { Bounds } from "../layout.ts";

// South of the plaza the world has building slots along an avenue (street.ts). A slot is a rectangle of ground a venue stands on:
// its footprint. The ground there is levelled to the floor's height when the client draws it.

export function slotAt(x: number, z: number, width: number, depth: number): Bounds {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}

export const SLOT_A1: Bounds = slotAt(0, 29, 14, 14);
export const SLOT_A2: Bounds = slotAt(-18, 29, 14, 14);
export const SLOT_B1: Bounds = slotAt(-2, 49, 10, 14);

// A rectangle given in metres from a slot's middle, so a venue's rooms read the same wherever its slot is.
export function inSlot(slot: Bounds, minU: number, minV: number, maxU: number, maxV: number): Bounds {
  const x = (slot.minX + slot.maxX) / 2;
  const z = (slot.minZ + slot.maxZ) / 2;
  return { minX: x + minU, maxX: x + maxU, minZ: z + minV, maxZ: z + maxV };
}

// The thickness of a walled venue's wall. Walls are only drawn, so the rooms are inset by it and joined to the outside by a door.
export const WALL = 0.4;
export const DOOR_WIDTH = 2.4;
