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

// Unit direction from one floor point to another, or null once within `reach` of it.
export function directionToward(
  from: { x: number; z: number },
  to: { x: number; z: number },
  reach: number,
): { x: number; z: number } | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return length <= reach ? null : { x: dx / length, z: dz / length };
}

// Heading toward the first corner of a walk that is not yet reached, and the corners still ahead (the reached ones dropped).
export function headingAlong(
  path: readonly { x: number; z: number }[],
  from: { x: number; z: number },
  reach: number,
): { dir: { x: number; z: number } | null; rest: { x: number; z: number }[] } {
  for (let index = 0; index < path.length; index += 1) {
    const dir = directionToward(from, path[index] as { x: number; z: number }, reach);
    if (dir) return { dir, rest: path.slice(index) };
  }
  return { dir: null, rest: [] };
}

export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 400;

export interface TapStroke {
  button: number;
  travelPx: number;
  heldMs: number;
  otherPointer: boolean;
}

// A tap is a short, still, primary-button press that no second pointer joined.
export function isTap(stroke: TapStroke): boolean {
  return stroke.button === 0 && !stroke.otherPointer && stroke.travelPx <= TAP_SLOP_PX && stroke.heldMs <= TAP_MAX_MS;
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

interface Tracked {
  x: number;
  y: number;
}

interface TapCandidate {
  id: number;
  button: number;
  x: number;
  y: number;
  startedAt: number;
  travel: number;
  otherPointer: boolean;
}

export class PointerInput {
  private readonly pointers = new Map<number, Tracked>();
  private pinchDistance = 0;
  private stickId: number | null = null;
  private stickShown = false;
  private stickX = 0;
  private stickY = 0;
  private tap: TapCandidate | null = null;

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
  // A stick finger shows the joystick only once it moves past the tap slop, so a tap never flashes it.
  private readonly down = (event: PointerEvent): void => {
    this.capture(event.pointerId);
    if (this.pointers.size > 0 || this.stickId !== null) {
      if (this.tap) this.tap.otherPointer = true;
    } else {
      this.tap = {
        id: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        startedAt: event.timeStamp,
        travel: 0,
        otherPointer: false,
      };
    }
    if (this.stickId === null && event.pointerType === "touch" && this.inStickZone(event.clientX)) {
      this.stickId = event.pointerId;
      this.stickX = event.clientX;
      this.stickY = event.clientY;
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
  };

  private readonly move = (event: PointerEvent): void => {
    const tap = this.tap;
    if (tap && tap.id === event.pointerId) tap.travel = Math.max(tap.travel, Math.hypot(event.clientX - tap.x, event.clientY - tap.y));
    if (event.pointerId === this.stickId) {
      const dx = event.clientX - this.stickX;
      const dy = event.clientY - this.stickY;
      if (!this.stickShown && Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
      this.stickShown = true;
      this.handlers.onStick({ originX: this.stickX, originY: this.stickY, dx, dy });
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
    const tap = this.tap?.id === event.pointerId ? this.tap : null;
    if (tap) this.tap = null;
    if (event.pointerId === this.stickId) {
      this.release(event.pointerId);
      this.endStick();
    } else {
      if (!this.pointers.delete(event.pointerId)) return;
      this.release(event.pointerId);
      if (this.pointers.size > 0) this.pinchDistance = 0;
    }
    if (!tap) return;
    const travelPx = Math.max(tap.travel, Math.hypot(event.clientX - tap.x, event.clientY - tap.y));
    const heldMs = event.timeStamp - tap.startedAt;
    if (isTap({ button: tap.button, travelPx, heldMs, otherPointer: tap.otherPointer })) this.handlers.onTap(event.clientX, event.clientY);
  };

  private readonly cancel = (event: PointerEvent): void => {
    if (this.tap?.id === event.pointerId) this.tap = null;
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
    if (!this.stickShown) return;
    this.stickShown = false;
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
  // E, when there is something to play or use where the visitor stands. True when it took the key; otherwise E turns the camera.
  onInteract?(): boolean;
}

export class KeyboardInput {
  readonly held = new Set<string>();
  private paused = false;

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

  // While a panel is open the keys belong to it: nothing moves, and only Esc (which closes it) gets through.
  get blocked(): boolean {
    return this.paused;
  }

  set blocked(on: boolean) {
    this.paused = on;
    if (on) this.held.clear();
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
    if (this.paused) {
      if (code === "Escape") this.handlers.onStand();
      return;
    }
    if (code === "KeyE" && !event.repeat && this.handlers.onInteract?.()) {
      event.preventDefault();
      return;
    }
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
