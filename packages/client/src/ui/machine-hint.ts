import { h } from "./dom.ts";
import { icon } from "./icons.ts";

const LABEL = "플레이";

// The round play button floated above the machine a visitor stands at. Like the seat hints it ignores the pointer (a tap is resolved
// by `contains`, so the 3D scene under it still gets the tap otherwise) and the DOM is only touched when it appears, vanishes or moves.
export class MachineHint {
  private readonly node: HTMLButtonElement;
  private x = Number.NaN;
  private y = Number.NaN;
  private shown = false;

  constructor(host: HTMLElement, onPlay: () => void) {
    this.node = h("button", "machine-hint hidden", icon("play"), h("kbd", "machine-hint-key", "E"));
    this.node.type = "button";
    this.node.setAttribute("aria-label", LABEL);
    this.node.title = LABEL;
    this.node.addEventListener("click", onPlay);
    host.append(h("div", "machine-hints", this.node));
  }

  get visible(): boolean {
    return this.shown;
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
    this.node.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
  }

  contains(clientX: number, clientY: number): boolean {
    if (!this.shown) return false;
    const rect = this.node.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.x = Number.NaN;
    this.y = Number.NaN;
    this.node.classList.add("hidden");
  }
}
