export const EMOTE_KEYS = ["gassho", "smile", "heart", "thumbs", "lotus", "sleepy", "question", "tear"] as const;
export type EmoteKey = (typeof EMOTE_KEYS)[number];
export const EMOTE_COUNT = EMOTE_KEYS.length;

export function isValidEmote(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < EMOTE_COUNT;
}
