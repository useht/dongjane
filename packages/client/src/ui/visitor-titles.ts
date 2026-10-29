import { h } from "./dom.ts";

interface Tag {
  node: HTMLDivElement;
  text: string;
  x: number;
  y: number;
  shown: boolean;
}

// One pooled title label per visitor id; the DOM is only touched when a title appears, vanishes, changes or moves a pixel.
export class VisitorTitles {
  private readonly root = h("div", "visitor-titles");
  private readonly tags = new Map<string, Tag>();

  constructor(host: HTMLElement) {
    host.append(this.root);
  }

  place(id: string, title: string, x: number, y: number): void {
    let tag = this.tags.get(id);
    if (!tag) {
      const node = h("div", "visitor-title hidden");
      this.root.append(node);
      tag = { node, text: "", x: Number.NaN, y: Number.NaN, shown: false };
      this.tags.set(id, tag);
    }
    const px = Math.round(x);
    const py = Math.round(y);
    if (tag.text !== title) {
      tag.text = title;
      tag.node.textContent = title;
    }
    if (!tag.shown) {
      tag.shown = true;
      tag.node.classList.remove("hidden");
    }
    if (px === tag.x && py === tag.y) return;
    tag.x = px;
    tag.y = py;
    tag.node.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
  }

  hide(id: string): void {
    const tag = this.tags.get(id);
    if (!tag?.shown) return;
    tag.shown = false;
    tag.node.classList.add("hidden");
  }

  hideAll(): void {
    for (const id of this.tags.keys()) this.hide(id);
  }

  retain(ids: ReadonlySet<string>): void {
    for (const [id, tag] of this.tags) {
      if (ids.has(id)) continue;
      tag.node.remove();
      this.tags.delete(id);
    }
  }
}
