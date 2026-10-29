import { GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_Z, PLATFORM, PLAZA, STEPS, WORLD_BOUNDS } from "@dongjane/shared";
import { GATBAWI_MESHES, MONK_PARTS, TEXTURED, VENUE_MESHES, VENUE_PROTOTYPES, WORLD_MESHES, WORLD_PROTOTYPES } from "../src/assets/contract.ts";
import { MONK_RIG } from "../src/game/monk-rig.ts";
import { CANOPY, PADS, SCREEN, STAGE, STAGE_YAW, TEMPLE } from "../src/game/venue-layout.ts";
import { THEME } from "../src/theme.ts";

// Everything the Blender scripts may know about the game. They read this JSON and spell no
// dimension, colour or mesh name of their own, so the models cannot drift from the code.
export function assetInputs() {
  return {
    layout: { GATBAWI_Z, PLATFORM, STEPS, PLAZA, WORLD_BOUNDS, GATBAWI_SEAT_SIZE, GATBAWI_SEATS },
    monk: MONK_RIG,
    venue: { STAGE, STAGE_YAW, SCREEN, CANOPY, TEMPLE, PADS },
    material: THEME.material,
    names: { MONK_PARTS, GATBAWI_MESHES, WORLD_MESHES, WORLD_PROTOTYPES, VENUE_MESHES, VENUE_PROTOTYPES, TEXTURED },
  };
}
