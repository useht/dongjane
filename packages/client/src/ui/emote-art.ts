import { EMOTE_KEYS, type EmoteKey } from "@dongjane/shared";

export const EMOTE_LABELS: Record<EmoteKey, string> = {
  gassho: "인사해요",
  smile: "웃어요",
  heart: "고마워요",
  thumbs: "좋아요",
  lotus: "평온해요",
  sleepy: "졸려요",
  question: "궁금해요",
  tear: "슬퍼요",
};

export function emoteImage(index: number, className = ""): HTMLImageElement {
  const key = EMOTE_KEYS[index] ?? EMOTE_KEYS[0];
  const image = document.createElement("img");
  image.src = `/emoji/${key}.png`;
  image.alt = "";
  image.draggable = false;
  if (className) image.className = className;
  return image;
}
