import { SHORE } from "../layout.ts";
import { defineVenue } from "./types.ts";

// The sand east of the plaza down to the sea; nobody kneels here, but a visitor may cast a line (fish.ts).
export const SHORE_VENUE = defineVenue({
  id: "shore",
  name: "바닷가",
  footprint: SHORE,
  areas: [SHORE],
  links: ["gatbawi", "casino"],
  npc: { stroll: true, seatWeight: 0 },
  indoor: false,
});
