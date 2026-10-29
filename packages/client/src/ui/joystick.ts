import { type MoveAxes, STICK_RADIUS_PX, type StickState, axesFromJoystick } from "../game/input.ts";
import { h } from "./dom.ts";

export class Joystick {
  private readonly knob = h("div", "joystick-knob");
  private readonly base = h("div", "joystick hidden", this.knob);
  private stick: StickState | null = null;

  constructor(host: HTMLElement) {
    host.append(this.base);
  }

  set(stick: StickState | null): void {
    this.stick = stick;
    this.base.classList.toggle("hidden", stick === null);
    if (!stick) return;
    const length = Math.hypot(stick.dx, stick.dy);
    const reach = length > STICK_RADIUS_PX ? STICK_RADIUS_PX / length : 1;
    this.base.style.transform = `translate3d(${stick.originX}px, ${stick.originY}px, 0)`;
    this.knob.style.transform = `translate3d(${stick.dx * reach}px, ${stick.dy * reach}px, 0)`;
  }

  axes(): MoveAxes {
    return this.stick ? axesFromJoystick(this.stick.dx, this.stick.dy) : { forward: 0, right: 0 };
  }
}
