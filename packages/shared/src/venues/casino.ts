import { CASINO_DOOR, CASINO_FLOOR, CASINO_YARD, COAST_ROAD, MACHINE_SPOTS } from "../casino-layout.ts";
import { boundsOf, defineVenue } from "./types.ts";

// The casino far to the south: the coast road, the yard, the doorway and the floor between the rows of machines. The rules
// treat it as open ground (no seats), and the computer-driven monks never walk this far.
const AREAS = [COAST_ROAD, CASINO_YARD, CASINO_DOOR, CASINO_FLOOR] as const;

export const CASINO_VENUE = defineVenue({
  id: "casino",
  name: "카지노",
  footprint: boundsOf(AREAS),
  areas: AREAS,
  links: ["shore"],
  activities: MACHINE_SPOTS,
  npc: { stroll: false, seatWeight: 0 },
  indoor: true,
});
