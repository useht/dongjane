import { ITEM_CHANT, ITEM_MOKT, ITEM_ROD } from "@dongjane/shared";

export type HeldItem = typeof ITEM_MOKT | typeof ITEM_CHANT | typeof ITEM_ROD;

export const HELD_ITEMS: readonly HeldItem[] = [ITEM_MOKT, ITEM_CHANT, ITEM_ROD];

export const ITEM_INFO: Record<HeldItem, { name: string; note: string; image: string }> = {
  [ITEM_MOKT]: { name: "목탁", note: "방석에 앉아 목탁을 쳐요", image: "/items/mokt.png" },
  [ITEM_CHANT]: { name: "염불", note: "방석에 앉아 염불을 외워요", image: "/items/chant.png" },
  [ITEM_ROD]: { name: "낚싯대", note: "바닷가에서 낚싯줄을 던져요", image: "/items/rod.svg" },
};

export const BOW_IMAGE = "/items/bow.png";

export function artImage(src: string, className = ""): HTMLImageElement {
  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  image.draggable = false;
  if (className) image.className = className;
  return image;
}

export function itemImage(item: HeldItem, className = ""): HTMLImageElement {
  return artImage(ITEM_INFO[item].image, className);
}
