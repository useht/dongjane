import { CUSHION_COUNT } from "@dongjane/shared";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";

interface Hint {
  node: HTMLButtonElement;
  x: number;
  y: number;
  shown: boolean;
}

// One sit button per cushion, floated above it; the DOM is only touched when a hint appears, vanishes or moves a pixel.
export class SeatHints {
  private readonly root = h("div", "seat-hints");
  private readonly hints: Hint[];

  constructor(host: HTMLElement, onSit: (cushionId: number) => void) {
    this.hints = Array.from({ length: CUSHION_COUNT }, (_, id) => {
      const node = h("button", "seat-hint hidden", icon("sit"));
      node.type = "button";
      node.setAttribute("aria-label", "여기 앉기");
      node.title = "여기 앉기";
      node.addEventListener("click", () => onSit(id));
      this.root.append(node);
      return { node, x: Number.NaN, y: Number.NaN, shown: false };
    });
    host.append(this.root);
  }

  place(id: number, x: number, y: number): void {
    const hint = this.hints[id];
    if (!hint) return;
    const px = Math.round(x);
    const py = Math.round(y);
    if (!hint.shown) {
      hint.shown = true;
      hint.node.classList.remove("hidden");
    }
    if (px === hint.x && py === hint.y) return;
    hint.x = px;
    hint.y = py;
    hint.node.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
  }

  hide(id: number): void {
    const hint = this.hints[id];
    if (!hint?.shown) return;
    hint.shown = false;
    hint.node.classList.add("hidden");
  }

  hideAll(): void {
    for (let id = 0; id < this.hints.length; id += 1) this.hide(id);
  }
}
