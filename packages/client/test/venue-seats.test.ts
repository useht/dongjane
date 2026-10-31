import { describe, expect, it } from "vitest";
import { GATBAWI_SEAT_TOP, INDOOR, SEAT_TOPS, ZONES } from "@dongjane/shared";
import { monkRig } from "../src/game/monk-assets.ts";
import { SEAT_TOP } from "../src/game/monk-model.ts";

// The shared rules know how high each zone's seat is; the monk model is drawn to kneel on the 방석's height.
describe("the seats of the venues", () => {
  it("seats a kneeling monk at the height the monk was built for in the 법당", () => {
    expect(SEAT_TOPS.dharma).toBe(monkRig.seatTop);
    expect(SEAT_TOPS.dharma).toBe(SEAT_TOP);
  });

  it("keeps the 돗자리 at its own height", () => {
    expect(SEAT_TOPS.gatbawi).toBe(GATBAWI_SEAT_TOP);
  });

  it("has a height and a view for every zone", () => {
    for (const zone of ZONES) {
      expect(SEAT_TOPS[zone], zone).toBeGreaterThan(0);
      expect(typeof INDOOR[zone], zone).toBe("boolean");
    }
  });
});
