import { WORLD_BOUNDS, type Bounds } from "../layout.ts";
import { defineVenue } from "./types.ts";

// The avenue along the plaza's south edge, which the venues south of the plaza open onto. Nobody kneels here and the computer-driven
// monks keep to the plaza. It touches the court and the plaza along their whole south edge, and the apron of each venue on it.
export const AVENUE: Bounds = { minX: -30, maxX: WORLD_BOUNDS.maxX, minZ: WORLD_BOUNDS.maxZ, maxZ: WORLD_BOUNDS.maxZ + 4 };

export const STREET_VENUE = defineVenue({
  id: "street",
  name: "저잣길",
  footprint: AVENUE,
  areas: [AVENUE],
  links: ["gatbawi", "bathhouse"],
  npc: { stroll: false, seatWeight: 0 },
  indoor: false,
  quests: false,
});
