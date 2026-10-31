import { Hint, type HintLook } from "./hint.ts";
import type { HintAction } from "./stage-video.ts";

const LOOKS: Record<HintAction, HintLook> = {
  play: { icon: "play", label: "재생" },
  stop: { icon: "stop", label: "중지" },
};

// A play button hung just under the concert screen while this visitor's video waits, and a stop button while it plays.
export class StageHint {
  private readonly hint: Hint;
  private action: HintAction = "play";

  constructor(layer: HTMLElement, onAction: Record<HintAction, () => void>) {
    this.hint = new Hint(layer, LOOKS.play, () => onAction[this.action](), { below: true, tappable: true });
  }

  place(action: HintAction, x: number, y: number): void {
    if (action !== this.action) {
      this.action = action;
      this.hint.look(LOOKS[action]);
    }
    this.hint.place(x, y);
  }

  hide(): void {
    this.hint.hide();
  }
}
