import { button } from "./dom.ts";

export const CHIP_LABEL = "소리 켜기";
export const CHIP_TAP_LABEL = "영상 화면을 눌러 주세요";

// Shown when the browser keeps the concert video muted until someone taps the player itself.
export class SoundChip {
  private readonly node: HTMLButtonElement;

  constructor(host: HTMLElement, onPress: () => void) {
    this.node = button(CHIP_LABEL, "sound-chip hidden", () => {
      this.node.textContent = CHIP_TAP_LABEL;
      onPress();
    });
    host.append(this.node);
  }

  show(shown: boolean): void {
    this.node.classList.toggle("hidden", !shown);
    if (!shown) this.node.textContent = CHIP_LABEL;
  }
}
