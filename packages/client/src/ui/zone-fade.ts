import { ZONE_FADE_MS } from "../game/zone-transition.ts";
import { h } from "./dom.ts";

// The curtain drawn over the 3D view while the visitor passes through a door. Only the newest request counts:
// asking for the other state before the first one finishes settles the first at once.
export class ZoneFade {
  readonly veil = h("div", "zone-fade");
  private timer = 0;
  private waiting: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    private readonly instant: () => boolean,
  ) {
    this.veil.setAttribute("aria-hidden", "true");
    host.append(this.veil);
  }

  cover(): Promise<void> {
    return this.go(true);
  }

  reveal(): Promise<void> {
    return this.go(false);
  }

  private go(covered: boolean): Promise<void> {
    window.clearTimeout(this.timer);
    this.waiting?.();
    this.waiting = null;
    const quick = this.instant();
    this.veil.style.transitionDuration = quick ? "0ms" : `${ZONE_FADE_MS}ms`;
    this.veil.classList.toggle("covered", covered);
    if (quick) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.timer = window.setTimeout(() => {
        this.waiting = null;
        resolve();
      }, ZONE_FADE_MS);
    });
  }
}
