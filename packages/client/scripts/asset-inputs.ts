import { DHARMA_SEAT_SIZE, GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_SEAT_TOP, GATBAWI_Z, PLATFORM, PLAZA, STEPS, WORLD_BOUNDS } from "@dongjane/shared";
import {
  DHARMA_MESHES,
  DHARMA_PROTOTYPES,
  GATBAWI_MESHES,
  TEXTURED,
  VENUE_MESHES,
  VENUE_PROTOTYPES,
  WORLD_MESHES,
  WORLD_PROTOTYPES,
} from "../src/assets/contract.ts";
import { ALTAR, BUDDHA_AT, CANDLE_SPOTS, DHARMA, DHARMA_DOOR, FRONT_PILLARS_X, SIDE_PILLARS_Z, hangingLanterns } from "../src/game/dharma-layout.ts";
import { CANOPY, PADS, SCREEN, STAGE, STAGE_YAW, TEMPLE } from "../src/game/venue-layout.ts";
import { THEME } from "../src/theme.ts";

// Everything the Blender scripts may know about the game. They read this JSON and spell no
// dimension, colour or mesh name of their own, so the models cannot drift from the code.
export function assetInputs() {
  return {
    layout: { GATBAWI_Z, PLATFORM, STEPS, PLAZA, WORLD_BOUNDS, GATBAWI_SEAT_SIZE, GATBAWI_SEAT_TOP, GATBAWI_SEATS },
    venue: { STAGE, STAGE_YAW, SCREEN, CANOPY, TEMPLE, PADS },
    dharma: {
      DHARMA,
      ALTAR,
      BUDDHA_AT,
      DHARMA_DOOR,
      DHARMA_SEAT_SIZE,
      CANDLE_SPOTS,
      SIDE_PILLARS_Z,
      FRONT_PILLARS_X,
      lanterns: hangingLanterns(),
    },
    material: THEME.material,
    names: {
      GATBAWI_MESHES,
      WORLD_MESHES,
      WORLD_PROTOTYPES,
      VENUE_MESHES,
      VENUE_PROTOTYPES,
      DHARMA_MESHES,
      DHARMA_PROTOTYPES,
      TEXTURED,
    },
  };
}
