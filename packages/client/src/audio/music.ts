import { DHARMA_BOUNDS, dharmaToWorld } from "@dongjane/shared";
import { DHARMA, DHARMA_DOOR } from "../game/dharma-layout.ts";

// Where a loop of this length is at the server's time. Everyone computes the same answer, so everyone hears the same bar.
export function loopPosition(serverMs: number, durationSeconds: number): number {
  if (!(durationSeconds > 0) || !Number.isFinite(serverMs)) return 0;
  const position = (serverMs / 1000) % durationSeconds;
  return position < 0 ? position + durationSeconds : position;
}

// A seek takes a moment to land, so it aims this far ahead of where the loop is now.
export const SEEK_LOOKAHEAD_SECONDS = 0.3;

export function aimAhead(target: number, durationSeconds: number): number {
  return durationSeconds > 0 ? (target + SEEK_LOOKAHEAD_SECONDS) % durationSeconds : target;
}

// Both soundtracks always run; where the visitor stands only sets their loudness (areaMix, and chantMix for the 법당 video).
export const DEEP_METRES = 3;
export const OUTSIDE_METRES = 6;

// The middle of the front door, in the front wall's plane; the door faces +x.
const DOORWAY = dharmaToWorld(0, DHARMA.frontZ);

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isInsideRoom(x: number, z: number): boolean {
  return x >= DHARMA_BOUNDS.minX && x <= DOORWAY.x && z >= DHARMA_BOUNDS.minZ && z <= DHARMA_BOUNDS.maxZ;
}

export function areaMix(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  if (isInsideRoom(x, z)) return 0.5 + 0.5 * unit((DOORWAY.x - x) / DEEP_METRES);
  const beside = Math.max(0, Math.abs(z - DOORWAY.z) - DHARMA_DOOR.halfWidth);
  const away = Math.hypot(beside, Math.max(0, x - DOORWAY.x));
  return 0.5 * (1 - unit(away / OUTSIDE_METRES));
}

// The 법당's share: areaMix inside the room (the doorway included), nothing anywhere outside it.
export function chantMix(x: number, z: number): number {
  return Number.isFinite(x) && Number.isFinite(z) && isInsideRoom(x, z) ? areaMix(x, z) : 0;
}

// A concert video nobody can hear is ended after this long.
export const QUIET_PAUSE_MS = 20_000;
