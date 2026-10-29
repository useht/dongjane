import { describe, expect, it } from "vitest";
import { axesFromKeys, floorDirection, isEditable, isTap } from "../src/game/input.ts";

describe("isTap", () => {
  it("accepts small movement and rejects a drag", () => {
    expect(isTap(100, 100, 103, 104)).toBe(true);
    expect(isTap(100, 100, 100, 100)).toBe(true);
    expect(isTap(100, 100, 108, 100)).toBe(false);
    expect(isTap(100, 100, 107, 100)).toBe(true);
    expect(isTap(0, 0, 30, 40)).toBe(false);
  });
});

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
