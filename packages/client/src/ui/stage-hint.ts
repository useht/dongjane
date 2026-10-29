import { h, iconButton } from "./dom.ts";

// A play button floated over the concert screen when the video has stalled; the DOM is only touched when it appears, vanishes or moves a pixel.
export class StageHint {
  private readonly root = h("div", "seat-hints");
  private readonly node: HTMLButtonElement;
  private x = Number.NaN;
  private y = Number.NaN;
  private shown = false;

  constructor(host: HTMLElement, onPlay: () => void) {
    this.node = iconButton("play", "다시 재생", onPlay, "seat-hint hidden");
    this.root.append(this.node);
    host.append(this.root);
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

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.node.classList.add("hidden");
  }
}
