export const STICK_RADIUS_PX = 56;
export const STICK_DEADZONE = 0.15;
const ORBIT_RADIANS_PER_PX = 0.0058;

export interface MoveAxes {
  forward: number;
  right: number;
}

const FORWARD_KEYS = new Set(["ArrowUp", "KeyW"]);
const BACK_KEYS = new Set(["ArrowDown", "KeyS"]);
const LEFT_KEYS = new Set(["ArrowLeft", "KeyA"]);
const RIGHT_KEYS = new Set(["ArrowRight", "KeyD"]);

export function axesFromKeys(held: ReadonlySet<string>): MoveAxes {
  let forward = 0;
  let right = 0;
  for (const code of held) {
    if (FORWARD_KEYS.has(code)) forward += 1;
    else if (BACK_KEYS.has(code)) forward -= 1;
    else if (LEFT_KEYS.has(code)) right -= 1;
    else if (RIGHT_KEYS.has(code)) right += 1;
  }
  forward = Math.max(-1, Math.min(1, forward));
  right = Math.max(-1, Math.min(1, right));
  const length = Math.hypot(forward, right);
  return length > 1 ? { forward: forward / length, right: right / length } : { forward, right };
}

// Screen-up is forward and screen-right is right; the magnitude is clamped to 1 and the deadzone stays still.
export function axesFromJoystick(dxPx: number, dyPx: number, radiusPx = STICK_RADIUS_PX, deadzone = STICK_DEADZONE): MoveAxes {
  const length = Math.hypot(dxPx, dyPx);
  if (length <= radiusPx * deadzone) return { forward: 0, right: 0 };
  const scale = Math.min(1, length / radiusPx) / length;
  return { forward: -dyPx * scale, right: dxPx * scale };
}

export function combineAxes(a: MoveAxes, b: MoveAxes): MoveAxes {
  const forward = a.forward + b.forward;
  const right = a.right + b.right;
  const length = Math.hypot(forward, right);
  return length > 1 ? { forward: forward / length, right: right / length } : { forward, right };
}

// Turns key axes into a floor direction, relative to where the camera looks (cameraForward on x/z).
export function floorDirection(axes: MoveAxes, cameraForward: { x: number; z: number }): { x: number; z: number } {
  const rightX = -cameraForward.z;
  const rightZ = cameraForward.x;
  return {
    x: cameraForward.x * axes.forward + rightX * axes.right,
    z: cameraForward.z * axes.forward + rightZ * axes.right,
  };
}

export function isEditable(target: EventTarget | null): boolean {
  if (!target || !(target as HTMLElement).tagName) return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface StickState {
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

export interface PointerHandlers {
  onOrbit(dxRadians: number, dyRadians: number): void;
  onZoom(factor: number): void;
  onStick(stick: StickState | null): void;
  onTap(clientX: number, clientY: number): void;
}

export const TAP_MAX_MS = 400;
export const TAP_MAX_MOVE_PX = 12;

export interface TapPoint {
  x: number;
  y: number;
}

// Tells a tap from a drag: a press that is let go soon and has hardly moved. A second finger down spoils every
// press until all fingers are up, so a pinch never ends in a tap.
export class TapDetector {
  private readonly presses = new Map<number, { x: number; y: number; at: number }>();
  private spoiled = false;

  begin(id: number, x: number, y: number, at: number): void {
    if (this.presses.size > 0) this.spoiled = true;
    this.presses.set(id, { x, y, at });
  }

  end(id: number, x: number, y: number, at: number): TapPoint | null {
    const press = this.presses.get(id);
    if (!press) return null;
    this.presses.delete(id);
    if (this.spoiled) {
      if (this.presses.size === 0) this.spoiled = false;
      return null;
    }
    const quick = at - press.at <= TAP_MAX_MS;
    const still = Math.hypot(x - press.x, y - press.y) <= TAP_MAX_MOVE_PX;
    return quick && still ? { x, y } : null;
  }

  cancel(id: number): void {
    this.presses.delete(id);
    if (this.presses.size === 0) this.spoiled = false;
  }
}

interface Tracked {
  x: number;
  y: number;
}

export class PointerInput {
  private readonly pointers = new Map<number, Tracked>();
  private readonly taps = new TapDetector();
  private pinchDistance = 0;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly handlers: PointerHandlers,
  ) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.cancel);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("contextmenu", this.contextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancel);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("contextmenu", this.contextMenu);
  }

  // The stick finger stays out of `pointers`, so it never counts toward a pinch.
  private readonly down = (event: PointerEvent): void => {
    this.capture(event.pointerId);
    if (event.pointerType !== "mouse" || event.button === 0) this.taps.begin(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    if (this.stickId === null && event.pointerType === "touch" && this.inStickZone(event.clientX)) {
      this.stickId = event.pointerId;
      this.stickX = event.clientX;
      this.stickY = event.clientY;
      this.handlers.onStick({ originX: this.stickX, originY: this.stickY, dx: 0, dy: 0 });
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
  };

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId === this.stickId) {
      this.handlers.onStick({
        originX: this.stickX,
        originY: this.stickY,
        dx: event.clientX - this.stickX,
        dy: event.clientY - this.stickY,
      });
      return;
    }
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked) return;
    const dx = event.clientX - tracked.x;
    const dy = event.clientY - tracked.y;
    tracked.x = event.clientX;
    tracked.y = event.clientY;

    if (this.pointers.size >= 2) {
      const distance = this.currentPinch();
      if (this.pinchDistance > 0 && distance > 0) this.handlers.onZoom(this.pinchDistance / distance);
      this.pinchDistance = distance;
      return;
    }
    this.handlers.onOrbit(dx * ORBIT_RADIANS_PER_PX, dy * ORBIT_RADIANS_PER_PX);
  };

  private readonly up = (event: PointerEvent): void => {
    const tap = this.taps.end(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    if (tap) this.handlers.onTap(tap.x, tap.y);
    if (event.pointerId === this.stickId) {
      this.release(event.pointerId);
      this.endStick();
      return;
    }
    if (!this.pointers.delete(event.pointerId)) return;
    this.release(event.pointerId);
    if (this.pointers.size > 0) this.pinchDistance = 0;
  };

  private readonly cancel = (event: PointerEvent): void => {
    this.taps.cancel(event.pointerId);
    if (event.pointerId === this.stickId) this.endStick();
    else this.pointers.delete(event.pointerId);
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.handlers.onZoom(Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.0012));
  };

  private readonly contextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private inStickZone(clientX: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  }

  private endStick(): void {
    this.stickId = null;
    this.handlers.onStick(null);
  }

  private capture(pointerId: number): void {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      // capture can fail for synthetic pointers; dragging still works while over the canvas
    }
  }

  private release(pointerId: number): void {
    if (this.canvas.hasPointerCapture?.(pointerId)) this.canvas.releasePointerCapture(pointerId);
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

export interface KeyHandlers {
  onSpace(): void;
  onStand(): void;
}

export class KeyboardInput {
  readonly held = new Set<string>();

  constructor(
    private readonly target: Window,
    private readonly handlers: KeyHandlers,
  ) {
    target.addEventListener("keydown", this.down);
    target.addEventListener("keyup", this.up);
    target.addEventListener("blur", this.clear);
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.down);
    this.target.removeEventListener("keyup", this.up);
    this.target.removeEventListener("blur", this.clear);
  }

  axes(): MoveAxes {
    return axesFromKeys(this.held);
  }

  rotation(): number {
    return (this.held.has("KeyE") ? 1 : 0) - (this.held.has("KeyQ") ? 1 : 0);
  }

  private readonly down = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    const code = event.code;
    if (code === "Space") {
      event.preventDefault();
      if (!event.repeat) this.handlers.onSpace();
      return;
    }
    if (code === "Escape") {
      this.handlers.onStand();
      return;
    }
    if (isMovementKey(code)) {
      event.preventDefault();
      this.held.add(code);
    }
  };

  private readonly up = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly clear = (): void => {
    this.held.clear();
  };
}

function isMovementKey(code: string): boolean {
  return (
    FORWARD_KEYS.has(code) ||
    BACK_KEYS.has(code) ||
    LEFT_KEYS.has(code) ||
    RIGHT_KEYS.has(code) ||
    code === "KeyQ" ||
    code === "KeyE"
  );
}
