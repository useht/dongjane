import { h } from "./dom.ts";
import type { ClockView } from "./format.ts";

// The top-right watch button opens the phone, whose home screen shows the time and weather.
export class ClockWidget {
  readonly button = h("button", "clock-button");

  constructor(onOpen: () => void) {
    const watch = h("img", "clock-watch");
    watch.src = "/icons/watch-clock.png";
    watch.alt = "";
    watch.draggable = false;

    this.button.type = "button";
    this.button.title = "시간과 날씨";
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.append(watch);
    this.button.addEventListener("click", onOpen);
  }

  setSky(view: ClockView): void {
    this.button.setAttribute("aria-label", `시간과 날씨, ${view.time}, ${view.weather}`);
  }
}
