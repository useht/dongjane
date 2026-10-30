import { h } from "./dom.ts";

export interface HudInsets {
  top: number;
  bottom: number;
}

// Resolves the HUD bands declared in CSS (--hud-top / --hud-bottom, safe-area insets included) to pixels.
export class HudFrame {
  private readonly top = h("div", "hud-probe top");
  private readonly bottom = h("div", "hud-probe bottom");

  constructor(host: HTMLElement) {
    host.append(this.top, this.bottom);
  }

  measure(): HudInsets {
    return { top: this.top.getBoundingClientRect().height, bottom: this.bottom.getBoundingClientRect().height };
  }
}
