import type { Bounds } from "@dongjane/shared";
import { bathhouseKit } from "./bathhouse.ts";
import { churchKit } from "./church.ts";
import type { KitSpec } from "./kit.ts";
import { streetKit } from "./street.ts";

export type { KitCamera, KitLamp, KitLook, KitMesh, KitPiece, KitPieces, KitSpec } from "./kit.ts";
export { PAD_HEIGHT, meshNames } from "./kit.ts";

// Every venue built from a kit, in the order of the venue registry: the street first, then the buildings that open onto it. A new
// venue's models, ground and camera all come from its entry here.
export const KITS: readonly KitSpec[] = [streetKit(), bathhouseKit(), churchKit()];

export const KIT_IDS: readonly string[] = KITS.map((kit) => kit.id);

export function kitById(id: string): KitSpec | undefined {
  return KITS.find((kit) => kit.id === id);
}

// The ground every kit levels flat under itself.
export const KIT_PADS: readonly Bounds[] = KITS.flatMap((kit) => kit.pads);
