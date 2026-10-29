import { ITEM_CHANT, ITEM_MOKT, ITEM_NONE } from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { heldAction, isSeated } from "../src/game/held-action.ts";

describe("heldAction", () => {
  it("is the knock for a seated monk holding the wooden fish", () => {
    expect(heldAction({ mode: "kneel", cushionId: 2, item: ITEM_MOKT })).toBe("knock");
    expect(heldAction({ mode: "bow", cushionId: 2, item: ITEM_MOKT })).toBe("knock");
  });

  it("is the chant for a seated monk holding the prayer beads", () => {
    expect(heldAction({ mode: "kneel", cushionId: 0, item: ITEM_CHANT })).toBe("chant");
    expect(heldAction({ mode: "bow", cushionId: 0, item: ITEM_CHANT })).toBe("chant");
  });

  it("falls back to bowing with nothing in hand", () => {
    expect(heldAction({ mode: "kneel", cushionId: 0, item: ITEM_NONE })).toBeNull();
  });

  it("has no action while standing or walking, item or not", () => {
    expect(heldAction({ mode: "stand", cushionId: -1, item: ITEM_MOKT })).toBeNull();
    expect(heldAction({ mode: "walk", cushionId: -1, item: ITEM_CHANT })).toBeNull();
    expect(heldAction({ mode: "kneel", cushionId: -1, item: ITEM_MOKT })).toBeNull();
    expect(heldAction(null)).toBeNull();
  });

  it("treats kneeling and bowing on a cushion as seated", () => {
    expect(isSeated({ mode: "kneel", cushionId: 1 })).toBe(true);
    expect(isSeated({ mode: "bow", cushionId: 1 })).toBe(true);
    expect(isSeated({ mode: "walk", cushionId: 1 })).toBe(false);
  });
});
