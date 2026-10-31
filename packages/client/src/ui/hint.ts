import { h, iconButton, swapIcon } from "./dom.ts";
import type { IconName } from "./icons.ts";

export interface HintLook {
  icon: IconName;
  label: string;
}

export interface HintOptions {
  // Hangs the button below its point instead of above it.
  below?: boolean;
  // Takes the pointer itself; otherwise a tap is resolved by `contains`, so the 3D scene under the button still gets it.
  tappable?: boolean;
}

// The one container every hint floats in, so a seat, a machine and the concert screen share one layer.
export function hintLayer(host: HTMLElement): HTMLElement {
  const layer = h("div", "hints");
  host.append(layer);
  return layer;
}

// The one round button floated over something in the scene; the DOM is only touched when it appears, vanishes, changes or moves a pixel.
export class Hint {
  private readonly node: HTMLButtonElement;
  private readonly anchor: string;
  private x = Number.NaN;
  private y = Number.NaN;
  private shown = false;

  constructor(layer: HTMLElement, look: HintLook, onClick: () => void, options: HintOptions = {}) {
    this.node = iconButton(look.icon, look.label, onClick, options.tappable ? "hint tappable hidden" : "hint hidden");
    this.anchor = options.below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    layer.append(this.node);
  }

  get visible(): boolean {
    return this.shown;
  }

  look(look: HintLook): void {
    swapIcon(this.node, look.icon);
    this.node.setAttribute("aria-label", look.label);
    this.node.title = look.label;
  }

  place(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!this.shown) {
      this.shown = true;
      this.node.classList.remove("hidden");
    }
    if (px === this.x && py === this.y) return;
    this.x = px;
    this.y = py;
    this.node.style.transform = `translate3d(${px}px, ${py}px, 0) ${this.anchor}`;
  }

  contains(clientX: number, clientY: number): boolean {
    if (!this.shown) return false;
    const rect = this.node.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.node.classList.add("hidden");
  }
}
