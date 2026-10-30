import { describe, expect, it } from "vitest";
import { BackGuard } from "../src/ui/back-guard.ts";

// A history with one entry below the guard's: `back` pops it and fires popstate, as the browser does (after the call returns).
function setup() {
  const listeners: (() => void)[] = [];
  const pushed: unknown[] = [];
  const pending: (() => void)[] = [];
  const history = {
    pushState: (state: unknown) => {
      pushed.push(state);
    },
    back: () => {
      pending.push(() => {
        pushed.pop();
        for (const listener of listeners) listener();
      });
    },
  };
  const source = { addEventListener: (_type: "popstate", listener: () => void) => void listeners.push(listener) };
  const backs: number[] = [];
  const guard = new BackGuard(source, history, () => backs.push(1));
  const flush = () => {
    while (pending.length > 0) pending.shift()?.();
  };
  const visitorBack = () => {
    pushed.pop();
    for (const listener of listeners) listener();
  };
  return { guard, pushed, backs, flush, visitorBack };
}

describe("BackGuard", () => {
  it("adds one history entry when engaged, however often it is asked", () => {
    const { guard, pushed } = setup();
    guard.engage();
    guard.engage();
    expect(pushed).toHaveLength(1);
    expect(guard.active).toBe(true);
  });

  it("calls back when the visitor goes back, once", () => {
    const { guard, backs, visitorBack, pushed } = setup();
    guard.engage();
    visitorBack();
    expect(backs).toHaveLength(1);
    expect(guard.active).toBe(false);
    expect(pushed).toHaveLength(0);
    visitorBack();
    expect(backs).toHaveLength(1);
  });

  it("takes its own entry off when released, without reporting a back", () => {
    const { guard, backs, flush, pushed } = setup();
    guard.engage();
    guard.release();
    flush();
    expect(backs).toHaveLength(0);
    expect(pushed).toHaveLength(0);
    expect(guard.active).toBe(false);
  });

  it("reports a later back after a release it swallowed", () => {
    const { guard, backs, flush, visitorBack } = setup();
    guard.engage();
    guard.release();
    flush();
    guard.engage();
    visitorBack();
    expect(backs).toHaveLength(1);
  });

  it("does nothing when released while not engaged", () => {
    const { guard, flush, backs } = setup();
    guard.release();
    flush();
    expect(backs).toHaveLength(0);
  });
});
