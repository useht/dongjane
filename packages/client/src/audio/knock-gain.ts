// The cushions span about 6 units and the walkable floor 10 by 8, so 8 units lets a knock reach
// most of the hall at a whisper while the neighbouring cushions still hear it plainly.
export const KNOCK_HEARING_RANGE = 8;
export const KNOCK_AUDIBLE_GAIN = 0.05;

export function knockGain(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.min(1, Math.max(0, 1 - Math.max(0, distance) / KNOCK_HEARING_RANGE));
}
