import { h, iconButton, swapIcon } from "./dom.ts";
import type { IconName } from "./icons.ts";
import type { HintAction } from "./stage-video.ts";

const LOOKS: Record<HintAction, { icon: IconName; label: string }> = {
  play: { icon: "play", label: "재생" },
  stop: { icon: "stop", label: "중지" },
};

// A play button floated over the concert screen while this visitor's video waits, and a stop button while it plays; the DOM is only touched when it appears, vanishes, changes or moves a pixel.
export class StageHint {
  private readonly root = h("div", "seat-hints");
  private readonly node: HTMLButtonElement;
  private action: HintAction = "play";
  private x = Number.NaN;
  private y = Number.NaN;
  private shown = false;

  constructor(host: HTMLElement, onAction: Record<HintAction, () => void>) {
    this.node = iconButton(LOOKS.play.icon, LOOKS.play.label, () => onAction[this.action](), "seat-hint stage-hint hidden");
    this.root.append(this.node);
    host.append(this.root);
  }

  place(action: HintAction, x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (action !== this.action) this.look(action);
    if (!this.shown) {
      this.shown = true;
      this.node.classList.remove("hidden");
    }
    if (px === this.x && py === this.y) return;
    this.x = px;
    this.y = py;
    this.node.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.node.classList.add("hidden");
  }

  private look(action: HintAction): void {
    this.action = action;
    const { icon, label } = LOOKS[action];
    swapIcon(this.node, icon);
    this.node.setAttribute("aria-label", label);
    this.node.title = label;
  }
}
