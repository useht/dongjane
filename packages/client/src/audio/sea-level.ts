import { INDOOR, SEA_LINE_X, venueAt } from "@dongjane/shared";

// The surf is at full strength within SEA_FULL_METRES of the waterline and fades out to nothing by SEA_FADE_METRES.
export const SEA_FULL_METRES = 6;
export const SEA_FADE_METRES = 25;

// How loud the sea is, 0 to 1, for a monk standing at this point. It depends on nothing but where they are, so every
// visitor hears the same sea from the same spot without a message crossing the network. Indoors there is none.
export function seaLevel(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z) || INDOOR[venueAt(x, z)]) return 0;
  const away = Math.max(0, SEA_LINE_X - x);
  if (away <= SEA_FULL_METRES) return 1;
  if (away >= SEA_FADE_METRES) return 0;
  const t = (away - SEA_FULL_METRES) / (SEA_FADE_METRES - SEA_FULL_METRES);
  return 1 - t * t * (3 - 2 * t);
}
