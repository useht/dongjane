import { BUDDHA_Z, HALL_FRONT_Z, HALL_HALF_WIDTH } from "@dongjane/shared";
import { BUDDHA_MESHES, HALL_MESHES, HALL_PROTOTYPES, MONK_PARTS, TEXTURED } from "../src/assets/contract.ts";
import { HALL_LAYOUT } from "../src/game/hall-layout.ts";
import { MONK_RIG } from "../src/game/monk-rig.ts";
import { THEME } from "../src/theme.ts";

// Everything the Blender scripts may know about the game. They read this JSON and spell no
// dimension, colour or mesh name of their own, so the models cannot drift from the code.
export function assetInputs() {
  return {
    layout: { HALL_HALF_WIDTH, HALL_FRONT_Z, BUDDHA_Z },
    hall: HALL_LAYOUT,
    monk: MONK_RIG,
    material: THEME.material,
    names: { MONK_PARTS, HALL_MESHES, HALL_PROTOTYPES, BUDDHA_MESHES, TEXTURED },
  };
}
