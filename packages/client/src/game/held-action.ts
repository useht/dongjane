import { ITEM_CHANT, ITEM_MOKT } from "@dongjane/shared";

export type HeldAction = "knock" | "chant";

export interface HeldActor {
  mode: string;
  seatId: number;
  item: number;
}

export function isSeated(actor: Pick<HeldActor, "mode" | "seatId">): boolean {
  return actor.seatId >= 0 && (actor.mode === "kneel" || actor.mode === "bow");
}

// The action that replaces bowing: only a seated monk with something in hand has one.
export function heldAction(actor: HeldActor | null | undefined): HeldAction | null {
  if (!actor || !isSeated(actor)) return null;
  if (actor.item === ITEM_MOKT) return "knock";
  if (actor.item === ITEM_CHANT) return "chant";
  return null;
}
