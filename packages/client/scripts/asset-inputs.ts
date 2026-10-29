import { BUDDHA_MESHES, WORLD_MESHES, WORLD_PROTOTYPES, MONK_PARTS, TEXTURED } from "../src/assets/contract.ts";
import { BUDDHA_Z, LANDSCAPE_FRONT_Z, LANDSCAPE_HALF_WIDTH, LANDSCAPE_LAYOUT } from "../src/game/landscape-layout.ts";
import { MONK_RIG } from "../src/game/monk-rig.ts";
import { THEME } from "../src/theme.ts";

// Everything the Blender scripts may know about the game. They read this JSON and spell no
// dimension, colour or mesh name of their own, so the models cannot drift from the code.
export function assetInputs() {
  return {
    layout: { LANDSCAPE_HALF_WIDTH, LANDSCAPE_FRONT_Z, BUDDHA_Z },
    world: LANDSCAPE_LAYOUT,
    monk: MONK_RIG,
    scene: THEME.scene,
    material: THEME.material,
    names: { MONK_PARTS, WORLD_MESHES, WORLD_PROTOTYPES, BUDDHA_MESHES, TEXTURED },
  };
}
