export const ITEM_NONE = 0;
export const ITEM_MOKT = 1;
export const ITEM_CHANT = 2;
export const ITEM_COUNT = 3;

export type Item = typeof ITEM_NONE | typeof ITEM_MOKT | typeof ITEM_CHANT;

export function isValidItem(value: unknown): value is Item {
  return typeof value === "number" && Number.isInteger(value) && value >= ITEM_NONE && value < ITEM_COUNT;
}
