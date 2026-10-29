import { type IconName, h, swapIcon } from "./dom.ts";
import type { ClockView } from "./format.ts";

// The top-right time and weather pill; pressing it opens the phone.
export class ClockWidget {
  readonly button = h("button", "clock-button");
  private readonly weatherIcon = h("span", "clock-icon");
  private readonly time = h("span", "clock-time");
  private readonly label = h("span", "clock-label");
  private lastIcon: IconName | null = null;

  constructor(onOpen: () => void) {
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.append(this.weatherIcon, h("span", "clock-text", this.time, this.label));
    this.button.addEventListener("click", onOpen);
  }

  setSky(view: ClockView): void {
    this.time.textContent = view.time;
    this.label.textContent = view.weather;
    this.button.setAttribute("aria-label", `시간과 날씨, ${view.time}, ${view.weather}`);
    if (view.icon !== this.lastIcon) {
      this.lastIcon = view.icon;
      swapIcon(this.weatherIcon, view.icon);
    }
  }
}
