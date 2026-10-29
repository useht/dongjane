import { readFileSync } from "node:fs";
import { COURT_AREA, DHARMA_ORIGIN, DHARMA_SEAT_SIZE, GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_SEAT_TOP, GATBAWI_Z, PLATFORM, PLAZA, STEPS, WORLD_BOUNDS } from "@dongjane/shared";
import {
  BUDDHA,
  BUDDHA_MESHES,
  DHARMA_MESHES,
  DHARMA_PROTOTYPES,
  GATBAWI_MESHES,
  TEXTURED,
  VENUE_MESHES,
  VENUE_PROTOTYPES,
  WORLD_MESHES,
  WORLD_PROTOTYPES,
} from "../src/assets/contract.ts";
import { ALTAR, BUDDHA_AT, BUDDHA_HEIGHT, CANDLE_SPOTS, DHARMA, DHARMA_DOOR, DHARMA_SHELL, FRONT_PILLARS_X, LOTUS_EMBED, SIDE_PILLARS_Z, hangingLanterns } from "../src/game/dharma-layout.ts";
import { GATBAWI_STATUE } from "../src/game/landscape-layout.ts";
import { CANOPY, PADS, SCREEN, STAGE, STAGE_YAW } from "../src/game/venue-layout.ts";
import { THEME } from "../src/theme.ts";

export const SOURCE_DIR = new URL("../blender/sources/buddha/", import.meta.url);

// blender/sources/buddha/source.json: where the scanned Buddha came from and how it is oriented. `file` is committed beside it
// when it is small; a bigger source is left out of the repository and `download` says where build-assets.ts fetches it from.
export interface BuddhaSource {
  title: string;
  url: string;
  file: string;
  sha256: string;
  author: string;
  licence: string;
  licenceKind: string;
  replicaNotice: string;
  upAxis: "X" | "Y" | "Z";
  frontAxis: string;
  download?: string;
  companions: Record<string, string>;
}

export function buddhaSource(): BuddhaSource {
  return JSON.parse(readFileSync(new URL("source.json", SOURCE_DIR), "utf8")) as BuddhaSource;
}

// Everything the Blender scripts may know about the game. They read this JSON and spell no
// dimension, colour or mesh name of their own, so the models cannot drift from the code.
export function assetInputs() {
  const source = buddhaSource();
  return {
    layout: { GATBAWI_Z, PLATFORM, STEPS, PLAZA, WORLD_BOUNDS, COURT_AREA, DHARMA_ORIGIN, GATBAWI_SEAT_SIZE, GATBAWI_SEAT_TOP, GATBAWI_SEATS, GATBAWI_STATUE },
    // The source's own hash (and its companions') stands for the scan, so a different scan makes a different stamp; its path is added
    // when the build runs.
    buddha: { ...BUDDHA, sha256: source.sha256, companions: source.companions, upAxis: source.upAxis, frontAxis: source.frontAxis },
    venue: { STAGE, STAGE_YAW, SCREEN, CANOPY, PADS },
    dharma: {
      DHARMA,
      ALTAR,
      BUDDHA_AT,
      BUDDHA_HEIGHT,
      LOTUS_EMBED,
      DHARMA_DOOR,
      DHARMA_SHELL,
      DHARMA_SEAT_SIZE,
      CANDLE_SPOTS,
      SIDE_PILLARS_Z,
      FRONT_PILLARS_X,
      lanterns: hangingLanterns(),
    },
    material: THEME.material,
    names: {
      GATBAWI_MESHES,
      BUDDHA_MESHES,
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
