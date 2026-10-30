import { type ActiveEmote, EMOTE_SHOW_MS } from "../game/emote-tracker.ts";
import { h } from "./dom.ts";
import { emoteImage } from "./emote-art.ts";

interface Bubble {
  pin: HTMLDivElement;
  source: ActiveEmote;
  x: number;
  y: number;
  shown: boolean;
  generation: number;
}

export interface EmoteSource {
  active(nowMs: number): Iterable<ActiveEmote>;
}

export type EmoteProjector = (monkId: string, out: { x: number; y: number }) => boolean;

// One medallion per monk floated above its head; the DOM is only touched when a bubble appears, vanishes or moves a pixel.
export class EmoteBubbles {
  private readonly root = h("div", "emote-layer");
  private readonly bubbles = new Map<string, Bubble>();
  private readonly point = { x: 0, y: 0 };
  private generation = 0;

  constructor(
    host: HTMLElement,
    private readonly source: EmoteSource,
    private readonly project: EmoteProjector,
  ) {
    this.root.setAttribute("aria-hidden", "true");
    this.root.style.setProperty("--hud-emote-show", `${EMOTE_SHOW_MS}ms`);
    host.append(this.root);
  }

  update(nowMs: number): void {
    this.generation += 1;
    for (const active of this.source.active(nowMs)) {
      const bubble = this.bubbleFor(active);
      bubble.generation = this.generation;
      if (this.project(active.monkId, this.point)) this.place(bubble, this.point.x, this.point.y);
      else this.hide(bubble);
    }
    for (const [id, bubble] of this.bubbles) {
      if (bubble.generation === this.generation) continue;
      bubble.pin.remove();
      this.bubbles.delete(id);
    }
  }

  private bubbleFor(active: ActiveEmote): Bubble {
    const existing = this.bubbles.get(active.monkId);
    if (existing && existing.source === active) return existing;
    existing?.pin.remove();
    const pin = h("div", "emote-pin off", h("div", "emote-bubble", emoteImage(active.emote)));
    this.root.append(pin);
    const bubble: Bubble = { pin, source: active, x: Number.NaN, y: Number.NaN, shown: false, generation: this.generation };
    this.bubbles.set(active.monkId, bubble);
    return bubble;
  }

  private place(bubble: Bubble, x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!bubble.shown) {
      bubble.shown = true;
      bubble.pin.classList.remove("off");
    }
    if (px === bubble.x && py === bubble.y) return;
    bubble.x = px;
    bubble.y = py;
    bubble.pin.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
  }

  private hide(bubble: Bubble): void {
    if (!bubble.shown) return;
    bubble.shown = false;
    bubble.pin.classList.add("off");
  }
}
