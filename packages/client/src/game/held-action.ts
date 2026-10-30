import { ITEM_CHANT, ITEM_MOKT, ITEM_ROD, canCastAt } from "@dongjane/shared";

export type HeldAction = "knock" | "chant" | "cast" | "reel";

export interface HeldActor {
  mode: string;
  seatId: number;
  item: number;
  x?: number;
  z?: number;
}

export function isSeated(actor: Pick<HeldActor, "mode" | "seatId">): boolean {
  return actor.seatId >= 0 && (actor.mode === "kneel" || actor.mode === "bow");
}

// The action that replaces bowing: a seated monk with the wooden fish or the beads, or a
// monk with the rod, standing at the water's edge to cast, or already fishing to reel in.
export function heldAction(actor: HeldActor | null | undefined): HeldAction | null {
  if (!actor) return null;
  if (actor.item === ITEM_ROD) {
    if (actor.mode === "fish") return "reel";
    if (actor.seatId < 0 && actor.x !== undefined && actor.z !== undefined && canCastAt(actor.x, actor.z)) return "cast";
    return null;
  }
  if (!isSeated(actor)) return null;
  if (actor.item === ITEM_MOKT) return "knock";
  if (actor.item === ITEM_CHANT) return "chant";
  return null;
}
