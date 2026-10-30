import { ITEM_CHANT, ITEM_MOKT, ITEM_NONE, ITEM_ROD, SEA_LINE_X, FISHING_REACH, SHORE } from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { heldAction, isSeated } from "../src/game/held-action.ts";

describe("heldAction", () => {
  it("is the knock for a seated monk holding the wooden fish", () => {
    expect(heldAction({ mode: "kneel", seatId: 2, item: ITEM_MOKT })).toBe("knock");
    expect(heldAction({ mode: "bow", seatId: 2, item: ITEM_MOKT })).toBe("knock");
  });

  it("is the chant for a seated monk holding the prayer beads", () => {
    expect(heldAction({ mode: "kneel", seatId: 0, item: ITEM_CHANT })).toBe("chant");
    expect(heldAction({ mode: "bow", seatId: 0, item: ITEM_CHANT })).toBe("chant");
  });

  it("falls back to bowing with nothing in hand", () => {
    expect(heldAction({ mode: "kneel", seatId: 0, item: ITEM_NONE })).toBeNull();
  });

  it("has no action while standing or walking, item or not", () => {
    expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_MOKT })).toBeNull();
    expect(heldAction({ mode: "walk", seatId: -1, item: ITEM_CHANT })).toBeNull();
    expect(heldAction({ mode: "kneel", seatId: -1, item: ITEM_MOKT })).toBeNull();
    expect(heldAction(null)).toBeNull();
  });

  describe("the fishing rod", () => {
    const EDGE = { x: SEA_LINE_X - 0.4, z: 6 };

    it("casts for a monk with the rod standing or walking at the water's edge", () => {
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_ROD, ...EDGE })).toBe("cast");
      expect(heldAction({ mode: "walk", seatId: -1, item: ITEM_ROD, ...EDGE })).toBe("cast");
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_ROD, x: SEA_LINE_X - FISHING_REACH, z: 6 })).toBe("cast");
    });

    it("reels in while fishing", () => {
      expect(heldAction({ mode: "fish", seatId: -1, item: ITEM_ROD, ...EDGE })).toBe("reel");
    });

    it("has no action away from the water, so Space keeps jumping", () => {
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_ROD, x: SHORE.minX + 0.5, z: 6 })).toBeNull();
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_ROD, x: SEA_LINE_X - FISHING_REACH - 0.1, z: 6 })).toBeNull();
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_ROD, x: 0, z: 6 })).toBeNull();
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_ROD })).toBeNull();
    });

    it("keeps bowing for a seated monk, even one whose seat is by the water", () => {
      expect(heldAction({ mode: "kneel", seatId: 3, item: ITEM_ROD, ...EDGE })).toBeNull();
      expect(heldAction({ mode: "bow", seatId: 3, item: ITEM_ROD, ...EDGE })).toBeNull();
    });

    it("does not cast with nothing or another item in hand at the water", () => {
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_NONE, ...EDGE })).toBeNull();
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_MOKT, ...EDGE })).toBeNull();
      expect(heldAction({ mode: "stand", seatId: -1, item: ITEM_CHANT, ...EDGE })).toBeNull();
    });
  });

  it("treats kneeling and bowing on a seat as seated", () => {
    expect(isSeated({ mode: "kneel", seatId: 1 })).toBe(true);
    expect(isSeated({ mode: "bow", seatId: 1 })).toBe(true);
    expect(isSeated({ mode: "walk", seatId: 1 })).toBe(false);
  });
});
