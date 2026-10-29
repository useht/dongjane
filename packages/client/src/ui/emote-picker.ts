import { EMOTE_KEYS } from "@dongjane/shared";
import { h } from "./dom.ts";
import { EMOTE_LABELS, emoteImage } from "./emote-art.ts";
import { Sheet } from "./sheet.ts";

export class EmotePicker {
  readonly sheet: Sheet;

  constructor(host: HTMLElement, onPick: (emote: number) => void) {
    this.sheet = new Sheet(host, "이모티콘");
    const grid = h("div", "emote-grid");
    EMOTE_KEYS.forEach((key, index) => {
      const choice = h("button", "emote-choice", emoteImage(index), h("span", "emote-name", EMOTE_LABELS[key]));
      choice.type = "button";
      choice.addEventListener("click", () => {
        this.sheet.close();
        onPick(index);
      });
      grid.append(choice);
    });
    this.sheet.body.append(grid);
  }
}
