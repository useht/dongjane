export const TAP_SLOP_PX = 8;
const ORBIT_RADIANS_PER_PX = 0.0058;

export function isTap(downX: number, downY: number, upX: number, upY: number, slop = TAP_SLOP_PX): boolean {
  return Math.hypot(upX - downX, upY - downY) < slop;
}

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

export interface PointerHandlers {
  onTap(clientX: number, clientY: number): void;
  onOrbit(dxRadians: number, dyRadians: number): void;
  onZoom(factor: number): void;
}

interface Tracked {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export class PointerInput {
  private readonly pointers = new Map<number, Tracked>();
  private dragged = false;
  private pinched = false;
  private pinchDistance = 0;

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

  private readonly down = (event: PointerEvent): void => {
    if (this.pointers.size === 0) {
      this.dragged = false;
      this.pinched = false;
    }
    this.pointers.set(event.pointerId, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY });
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // capture can fail for synthetic pointers; dragging still works while over the canvas
    }
    if (this.pointers.size === 2) {
      this.pinched = true;
      this.pinchDistance = this.currentPinch();
    }
  };

  private readonly move = (event: PointerEvent): void => {
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
    if (!this.dragged && !isTap(tracked.startX, tracked.startY, tracked.x, tracked.y)) this.dragged = true;
    if (this.dragged) this.handlers.onOrbit(dx * ORBIT_RADIANS_PER_PX, dy * ORBIT_RADIANS_PER_PX);
  };

  private readonly up = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked) return;
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (this.pointers.size > 0) {
      this.pinchDistance = 0;
      return;
    }
    if (!this.dragged && !this.pinched && isTap(tracked.startX, tracked.startY, event.clientX, event.clientY)) {
      this.handlers.onTap(event.clientX, event.clientY);
    }
  };

  private readonly cancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.dragged = true;
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.handlers.onZoom(Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.0012));
  };

  private readonly contextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

export interface KeyHandlers {
  onBow(times: 1 | 2 | 3): void;
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
      if (!event.repeat) this.handlers.onBow(1);
      return;
    }
    if (code === "Digit3" || code === "Numpad3") {
      if (!event.repeat) this.handlers.onBow(3);
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
