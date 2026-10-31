import { type Bounds, DHARMA_PORCH_Z, GATBAWI_SEATS, GATBAWI_SEAT_TOP, WORLD_BOUNDS, dharmaToWorld } from "../layout.ts";
import { boundsOf, defineVenue } from "./types.ts";

// 갓바위: the open plaza before the stone Buddha, where visitors kneel on 돗자리, and the court between it and the 법당's door
// (the door faces +x, so the court is the strip along the plaza's west edge). The court covers the plaza's whole depth (z).
export const PLAZA_AREA: Bounds = WORLD_BOUNDS;
export const COURT_AREA: Bounds = {
  minX: dharmaToWorld(0, DHARMA_PORCH_Z).x,
  maxX: WORLD_BOUNDS.minX,
  minZ: WORLD_BOUNDS.minZ,
  maxZ: WORLD_BOUNDS.maxZ,
};

const AREAS = [COURT_AREA, PLAZA_AREA] as const;

export const GATBAWI_VENUE = defineVenue({
  id: "gatbawi",
  name: "갓바위",
  footprint: boundsOf(AREAS),
  areas: AREAS,
  links: ["dharma", "shore", "street"],
  seats: {
    name: "돗자리",
    spots: GATBAWI_SEATS,
    // Every mat faces -z, toward Gatbawi, which is yaw 0 in yawFromDirection's convention.
    yaw: 0,
    // Gatbawi's rows run along z and its middle is x = 0.
    depth: (spot) => spot.z,
    offset: (spot) => Math.abs(spot.x),
    top: GATBAWI_SEAT_TOP,
  },
  npc: { stroll: true, seatWeight: 1 },
  indoor: false,
  quests: true,
});
