import {
  type Bounds,
  DHARMA_BOUNDS,
  DHARMA_ORIGIN,
  DHARMA_PORCH_Z,
  DHARMA_SEATS,
  DHARMA_SEAT_TOP,
  DHARMA_YAW,
  dharmaToWorld,
} from "../layout.ts";
import { boundsOf, defineVenue } from "./types.ts";

// 법당: the room the visitors arrive in, where they kneel on 방석. The doorway runs through the front wall and the porch, 2.8 m
// wide, centred on the door, out to the court (where the plaza's venue begins).
export const INTERIOR_AREA: Bounds = DHARMA_BOUNDS;
export const DOORWAY_AREA: Bounds = {
  minX: DHARMA_BOUNDS.maxX,
  maxX: dharmaToWorld(0, DHARMA_PORCH_Z).x,
  minZ: DHARMA_ORIGIN.z - 1.4,
  maxZ: DHARMA_ORIGIN.z + 1.4,
};

export const DHARMA_VENUE = defineVenue({
  id: "dharma",
  name: "법당",
  // Inside the front door only: the doorstep and the doorway are the open ground.
  footprint: boundsOf([INTERIOR_AREA]),
  areas: [INTERIOR_AREA, DOORWAY_AREA],
  links: ["gatbawi"],
  seats: {
    name: "방석",
    spots: DHARMA_SEATS,
    // Every 방석 faces the altar on the room's back wall, which the quarter turn has put on the -x side.
    yaw: DHARMA_YAW,
    // The room's rows run along x (the altar is on its -x side) and its aisle is z = DHARMA_ORIGIN.z.
    depth: (spot) => spot.x,
    offset: (spot) => Math.abs(spot.z - DHARMA_ORIGIN.z),
    top: DHARMA_SEAT_TOP,
  },
  npc: { stroll: true, seatWeight: 1 },
  indoor: true,
});
