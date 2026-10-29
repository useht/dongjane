import { GATBAWI_Z, MAT_SIZE, MAT_SPOTS, PLATFORM, PLAZA, STEPS, WORLD_BOUNDS } from "@dongjane/shared";
import { GATBAWI_MESHES, MONK_PARTS, TEXTURED, WORLD_MESHES, WORLD_PROTOTYPES } from "../src/assets/contract.ts";
import { MONK_RIG } from "../src/game/monk-rig.ts";
import { THEME } from "../src/theme.ts";

// Everything the Blender scripts may know about the game. They read this JSON and spell no
// dimension, colour or mesh name of their own, so the models cannot drift from the code.
export function assetInputs() {
  return {
    layout: { GATBAWI_Z, PLATFORM, STEPS, PLAZA, WORLD_BOUNDS, MAT_SIZE, MAT_SPOTS },
    monk: MONK_RIG,
    material: THEME.material,
    names: { MONK_PARTS, GATBAWI_MESHES, WORLD_MESHES, WORLD_PROTOTYPES, TEXTURED },
  };
}
