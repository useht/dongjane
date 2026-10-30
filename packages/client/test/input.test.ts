import { describe, expect, it } from "vitest";
import {
  STICK_DEADZONE,
  STICK_RADIUS_PX,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  axesFromJoystick,
  axesFromKeys,
  combineAxes,
  directionToward,
  floorDirection,
  headingAlong,
  isEditable,
  isTap,
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

describe("isTap", () => {
  const clean = { button: 0, travelPx: 2, heldMs: 120, otherPointer: false };

  it("accepts a short, still, primary press", () => {
    expect(isTap(clean)).toBe(true);
    expect(isTap({ ...clean, travelPx: TAP_SLOP_PX, heldMs: TAP_MAX_MS })).toBe(true);
  });

  it("rejects a press that moved too far", () => {
    expect(isTap({ ...clean, travelPx: TAP_SLOP_PX + 1 })).toBe(false);
  });

  it("rejects a press held too long", () => {
    expect(isTap({ ...clean, heldMs: TAP_MAX_MS + 1 })).toBe(false);
  });

  it("rejects a press that a second pointer joined", () => {
    expect(isTap({ ...clean, otherPointer: true })).toBe(false);
  });

  it("rejects the middle and right buttons", () => {
    expect(isTap({ ...clean, button: 1 })).toBe(false);
    expect(isTap({ ...clean, button: 2 })).toBe(false);
  });
});

describe("directionToward", () => {
  it("points at the destination as a unit vector", () => {
    const dir = directionToward({ x: 1, z: 1 }, { x: 4, z: 5 }, 0.1);
    expect(dir?.x).toBeCloseTo(0.6, 6);
    expect(dir?.z).toBeCloseTo(0.8, 6);
  });

  it("returns null once within reach, including exactly at it", () => {
    expect(directionToward({ x: 0, z: 0 }, { x: 0, z: 0 }, 0.1)).toBeNull();
    expect(directionToward({ x: 0, z: 0 }, { x: 3, z: 4 }, 5)).toBeNull();
    expect(directionToward({ x: 0, z: 0 }, { x: 3, z: 4 }, 4.9)).not.toBeNull();
  });
});

describe("headingAlong", () => {
  const path = [
    { x: 0, z: 5 },
    { x: 4, z: 5 },
  ];

  it("heads for the first corner while it is still ahead", () => {
    const { dir, rest } = headingAlong(path, { x: 0, z: 0 }, 0.1);
    expect(dir?.x).toBeCloseTo(0, 6);
    expect(dir?.z).toBeCloseTo(1, 6);
    expect(rest).toEqual(path);
  });

  it("drops the corners already reached and turns for the next", () => {
    const { dir, rest } = headingAlong(path, { x: 0, z: 4.95 }, 0.1);
    expect(dir?.x).toBeCloseTo(1, 3);
    expect(dir?.z).toBeCloseTo(0, 1);
    expect(rest).toEqual([{ x: 4, z: 5 }]);
  });

  it("finishes once the last corner is within reach, and for an empty path", () => {
    expect(headingAlong(path.slice(1), { x: 3.95, z: 5 }, 0.1)).toEqual({ dir: null, rest: [] });
    expect(headingAlong(path, { x: 3.95, z: 5 }, 5)).toEqual({ dir: null, rest: [] });
    expect(headingAlong([], { x: 0, z: 0 }, 0.1)).toEqual({ dir: null, rest: [] });
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
