import { describe, expect, it } from "vitest";
import {
  STICK_DEADZONE,
  STICK_RADIUS_PX,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
  TapDetector,
  axesFromJoystick,
  axesFromKeys,
  combineAxes,
  floorDirection,
  isEditable,
} from "../src/game/input.ts";

describe("axesFromKeys", () => {
  it("combines arrows and WASD", () => {
    expect(axesFromKeys(new Set(["KeyW"]))).toEqual({ forward: 1, right: 0 });
    expect(axesFromKeys(new Set(["ArrowDown"]))).toEqual({ forward: -1, right: 0 });
    expect(axesFromKeys(new Set(["KeyA", "ArrowLeft"]))).toEqual({ forward: 0, right: -1 });
  });

  it("cancels opposite keys and normalizes diagonals", () => {
    expect(axesFromKeys(new Set(["KeyW", "KeyS"]))).toEqual({ forward: 0, right: 0 });
    const diagonal = axesFromKeys(new Set(["KeyW", "KeyD"]));
    expect(Math.hypot(diagonal.forward, diagonal.right)).toBeCloseTo(1, 6);
    expect(axesFromKeys(new Set())).toEqual({ forward: 0, right: 0 });
  });
});

describe("axesFromJoystick", () => {
  it("stays still inside the deadzone", () => {
    const edge = STICK_RADIUS_PX * STICK_DEADZONE;
    expect(axesFromJoystick(0, 0)).toEqual({ forward: 0, right: 0 });
    expect(axesFromJoystick(edge, 0)).toEqual({ forward: 0, right: 0 });
    expect(axesFromJoystick(-edge * 0.6, edge * 0.6)).toEqual({ forward: 0, right: 0 });
    expect(axesFromJoystick(edge + 1, 0).right).toBeGreaterThan(0);
  });

  it("pushes up for forward and right for right, as seen on screen", () => {
    const up = axesFromJoystick(0, -STICK_RADIUS_PX);
    expect(up.forward).toBeCloseTo(1, 6);
    expect(up.right).toBeCloseTo(0, 6);
    const down = axesFromJoystick(0, STICK_RADIUS_PX);
    expect(down.forward).toBeCloseTo(-1, 6);
    const right = axesFromJoystick(STICK_RADIUS_PX, 0);
    expect(right.right).toBeCloseTo(1, 6);
    expect(right.forward).toBeCloseTo(0, 6);
    expect(axesFromJoystick(-STICK_RADIUS_PX, 0).right).toBeCloseTo(-1, 6);
  });

  it("scales with the drag and clamps the magnitude to 1", () => {
    const half = axesFromJoystick(0, -STICK_RADIUS_PX / 2);
    expect(half.forward).toBeCloseTo(0.5, 6);
    const far = axesFromJoystick(300, -400);
    expect(Math.hypot(far.forward, far.right)).toBeCloseTo(1, 6);
    expect(far.forward).toBeCloseTo(0.8, 6);
    expect(far.right).toBeCloseTo(0.6, 6);
  });

  it("honors a custom radius and deadzone", () => {
    expect(axesFromJoystick(10, 0, 100, 0.2)).toEqual({ forward: 0, right: 0 });
    expect(axesFromJoystick(50, 0, 100, 0.2).right).toBeCloseTo(0.5, 6);
  });
});

describe("combineAxes", () => {
  it("adds keys and stick, then clamps the length to 1", () => {
    const sum = combineAxes({ forward: 0.2, right: 0 }, { forward: 0.3, right: 0.1 });
    expect(sum.forward).toBeCloseTo(0.5, 6);
    expect(sum.right).toBeCloseTo(0.1, 6);
    const clamped = combineAxes({ forward: 1, right: 0 }, { forward: 1, right: 1 });
    expect(Math.hypot(clamped.forward, clamped.right)).toBeCloseTo(1, 6);
    expect(clamped.forward).toBeGreaterThan(clamped.right);
  });

  it("lets opposite inputs cancel", () => {
    expect(combineAxes({ forward: 1, right: 0 }, { forward: -1, right: 0 })).toEqual({ forward: 0, right: 0 });
  });
});

describe("floorDirection", () => {
  it("moves along the camera heading", () => {
    const toward = floorDirection({ forward: 1, right: 0 }, { x: 0, z: -1 });
    expect(toward.x).toBeCloseTo(0, 6);
    expect(toward.z).toBeCloseTo(-1, 6);
  });

  it("maps right to the viewer's right on screen", () => {
    const right = floorDirection({ forward: 0, right: 1 }, { x: 0, z: -1 });
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.z).toBeCloseTo(0, 6);
    const turned = floorDirection({ forward: 0, right: 1 }, { x: -1, z: 0 });
    expect(turned.x).toBeCloseTo(0, 6);
    expect(turned.z).toBeCloseTo(-1, 6);
  });
});

describe("isEditable", () => {
  it("recognizes form fields only", () => {
    expect(isEditable({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe("TapDetector", () => {
  it("calls a short, still press a tap and reports where it ended", () => {
    const taps = new TapDetector();
    taps.begin(1, 100, 200, 1000);
    expect(taps.end(1, 103, 204, 1000 + TAP_MAX_MS)).toEqual({ x: 103, y: 204 });
  });

  it("does not call a long press or a drag a tap", () => {
    const taps = new TapDetector();
    taps.begin(1, 100, 200, 1000);
    expect(taps.end(1, 100, 200, 1001 + TAP_MAX_MS)).toBeNull();
    taps.begin(2, 100, 200, 5000);
    expect(taps.end(2, 100 + TAP_MAX_MOVE_PX + 1, 200, 5050)).toBeNull();
  });

  it("ignores a release it never saw pressed", () => {
    expect(new TapDetector().end(7, 0, 0, 10)).toBeNull();
  });

  it("never ends a pinch in a tap, and is ready for the next press once every finger is up", () => {
    const taps = new TapDetector();
    taps.begin(1, 10, 10, 0);
    taps.begin(2, 40, 10, 20);
    expect(taps.end(2, 40, 10, 60)).toBeNull();
    expect(taps.end(1, 10, 10, 80)).toBeNull();
    taps.begin(3, 10, 10, 1000);
    expect(taps.end(3, 10, 10, 1050)).toEqual({ x: 10, y: 10 });
  });

  it("forgets a press that was cancelled", () => {
    const taps = new TapDetector();
    taps.begin(1, 10, 10, 0);
    taps.cancel(1);
    expect(taps.end(1, 10, 10, 10)).toBeNull();
    taps.begin(2, 10, 10, 20);
    expect(taps.end(2, 10, 10, 30)).toEqual({ x: 10, y: 10 });
  });
});
