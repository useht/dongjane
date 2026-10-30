import { describe, expect, it } from "vitest";
import { KeyboardInput } from "../src/game/input.ts";

function setup(interact?: () => boolean) {
  const target = new EventTarget();
  const calls = { space: 0, stand: 0 };
  const input = new KeyboardInput(target as unknown as Window, {
    onSpace: () => void (calls.space += 1),
    onStand: () => void (calls.stand += 1),
    onInteract: interact,
  });
  const press = (type: "keydown" | "keyup", code: string, repeat = false): boolean => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat, metaKey: false, ctrlKey: false, altKey: false });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { input, calls, press };
}

describe("KeyboardInput while a panel has the keys", () => {
  it("drops the held keys and ignores movement and Space, but still hears Esc", () => {
    const { input, calls, press } = setup();
    press("keydown", "KeyW");
    expect(input.axes().forward).toBe(1);
    input.blocked = true;
    expect(input.axes()).toEqual({ forward: 0, right: 0 });
    expect(press("keydown", "ArrowLeft")).toBe(false);
    expect(press("keydown", "Space")).toBe(false);
    expect(calls.space).toBe(0);
    expect(input.axes()).toEqual({ forward: 0, right: 0 });
    press("keydown", "Escape");
    expect(calls.stand).toBe(1);
  });

  it("walks and jumps again once released", () => {
    const { input, calls, press } = setup();
    input.blocked = true;
    input.blocked = false;
    press("keydown", "KeyD");
    expect(input.axes().right).toBe(1);
    press("keydown", "Space");
    expect(calls.space).toBe(1);
  });
});

describe("KeyboardInput interact key", () => {
  it("lets E turn the camera when there is nothing to play", () => {
    const { input, press } = setup(() => false);
    expect(press("keydown", "KeyE")).toBe(true);
    expect(input.rotation()).toBe(1);
  });

  it("gives E to the interaction when it takes the key, and does not turn the camera", () => {
    let taken = 0;
    const { input, press } = setup(() => {
      taken += 1;
      return true;
    });
    press("keydown", "KeyE");
    expect(taken).toBe(1);
    expect(input.rotation()).toBe(0);
  });

  it("asks only on a fresh press, not on key repeat", () => {
    let asked = 0;
    const { press } = setup(() => {
      asked += 1;
      return false;
    });
    press("keydown", "KeyE");
    press("keydown", "KeyE", true);
    expect(asked).toBe(1);
  });
});
