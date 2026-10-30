import { TAP_SLOP_PX } from "../game/input.ts";
import { button, h } from "./dom.ts";

const STEPS = [
  "바닥을 누르면 그곳으로 걸어가요",
  "화면 왼쪽을 손가락으로 끌면 그 방향으로 걸어가요",
  "가까이 가면 생기는 방석 표시를 누르면 앉아요",
];

// Shown to touch visitors until their first touch, which is also what lets the browser play sound.
export class TouchIntro {
  private readonly root = h("div", "overlay touch-intro hidden");
  private touched = false;
  private shown = false;
  private downX = 0;
  private downY = 0;

  constructor(host: HTMLElement) {
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "움직이는 방법");
    const start = button("화면을 눌러 시작하기", "primary", () => this.hide());
    this.root.append(
      h(
        "div",
        "overlay-card",
        h("h2", "overlay-title", "화면을 눌러 시작해요"),
        h("p", "overlay-body", "소리는 화면을 한 번 누르면 들려요."),
        h("ol", "touch-intro-steps", ...STEPS.map((step) => h("li", "", step))),
        h("div", "overlay-actions", start),
      ),
    );
    host.append(this.root);

    window.addEventListener(
      "pointerdown",
      () => {
        this.touched = true;
      },
      { capture: true, once: true },
    );
    this.root.addEventListener("pointerdown", (event) => {
      this.downX = event.clientX;
      this.downY = event.clientY;
    });
    // A tap ends in a click, which this screen swallows; a drag never clicks, so it ends the screen itself.
    this.root.addEventListener("pointerup", (event) => {
      if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > TAP_SLOP_PX) this.hide();
    });
    this.root.addEventListener("click", () => this.hide());
  }

  show(): void {
    if (this.shown || this.touched || !matchMedia("(pointer: coarse)").matches) return;
    this.shown = true;
    this.root.classList.remove("hidden");
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.touched = true;
    this.root.classList.add("hidden");
  }
}
