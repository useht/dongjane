import { describe, expect, it } from "vitest";
import { BackGuard } from "../src/ui/back-guard.ts";

// A history that starts on the page the guard sits on. Like a browser, `back` picks its target when it is called and moves there
// later, firing popstate; `pushState` drops the entries ahead and moves onto the new one at once.
function setup() {
  const listeners: (() => void)[] = [];
  const entries: unknown[] = [null];
  let at = 0;
  const pending: (() => void)[] = [];
  const fire = () => {
    for (const listener of listeners) listener();
  };
  const history = {
    pushState: (state: unknown) => {
      entries.length = at + 1;
      entries.push(state);
      at += 1;
    },
    back: () => {
      const target = at - 1;
      pending.push(() => {
        at = target;
        fire();
      });
    },
  };
  const source = { addEventListener: (_type: "popstate", listener: () => void) => void listeners.push(listener) };
  const backs: number[] = [];
  const guard = new BackGuard(source, history, () => backs.push(1));
  const flush = async () => {
    await Promise.resolve();
    while (pending.length > 0) pending.shift()?.();
  };
  const visitorBack = () => {
    at -= 1;
    fire();
  };
  return { guard, depth: () => at, backs, flush, visitorBack };
}

describe("BackGuard", () => {
  it("adds one history entry when engaged, however often it is asked", () => {
    const { guard, depth } = setup();
    guard.engage();
    guard.engage();
    expect(depth()).toBe(1);
    expect(guard.active).toBe(true);
  });

  it("calls back when the visitor goes back, once", () => {
    const { guard, backs, visitorBack, depth } = setup();
    guard.engage();
    visitorBack();
    expect(backs).toHaveLength(1);
    expect(guard.active).toBe(false);
    expect(depth()).toBe(0);
    visitorBack();
    expect(backs).toHaveLength(1);
  });

  it("takes its own entry off when released, without reporting a back", async () => {
    const { guard, backs, flush, depth } = setup();
    guard.engage();
    guard.release();
    await flush();
    expect(backs).toHaveLength(0);
    expect(depth()).toBe(0);
    expect(guard.active).toBe(false);
  });

  it("reports a later back after a release it swallowed", async () => {
    const { guard, backs, flush, visitorBack, depth } = setup();
    guard.engage();
    guard.release();
    await flush();
    guard.engage();
    expect(depth()).toBe(1);
    visitorBack();
    expect(backs).toHaveLength(1);
    expect(depth()).toBe(0);
  });

  it("does nothing when released while not engaged", async () => {
    const { guard, flush, backs, depth } = setup();
    guard.release();
    await flush();
    expect(backs).toHaveLength(0);
    expect(depth()).toBe(0);
  });

  it("keeps its one entry when engaged again in the turn it was released", async () => {
    const { guard, backs, flush, visitorBack, depth } = setup();
    guard.engage();
    guard.release();
    guard.engage();
    await flush();
    expect(depth()).toBe(1);
    expect(guard.active).toBe(true);
    visitorBack();
    expect(backs).toHaveLength(1);
    expect(depth()).toBe(0);
  });

  it("leaves the history balanced after a release, a re-engage and a second release in one turn", async () => {
    const { guard, backs, flush, depth } = setup();
    guard.engage();
    guard.release();
    guard.engage();
    guard.release();
    await flush();
    expect(depth()).toBe(0);
    expect(backs).toHaveLength(0);
    expect(guard.active).toBe(false);
  });
});
