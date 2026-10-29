import { describe, expect, it } from "vitest";
import { ZONE_COOLDOWN_MS, type Zone } from "@dongjane/shared";
import { ZoneTransition, zoneCooldownLeft, type TransitionSteps } from "../src/game/zone-transition.ts";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function steps(log: string[], overrides: Partial<TransitionSteps> = {}): TransitionSteps {
  return {
    cover: async () => void log.push("cover"),
    reveal: async () => void log.push("reveal"),
    prepare: async (zone: Zone) => {
      log.push(`prepare ${zone}`);
      return true;
    },
    apply: (zone: Zone) => void log.push(`apply ${zone}`),
    fail: (zone: Zone) => void log.push(`fail ${zone}`),
    ...overrides,
  };
}

describe("zoneCooldownLeft", () => {
  it("lets the first request through and holds the next for the server cooldown", () => {
    expect(zoneCooldownLeft(500, null)).toBe(0);
    expect(zoneCooldownLeft(1000, 1000)).toBe(ZONE_COOLDOWN_MS);
    expect(zoneCooldownLeft(1000 + ZONE_COOLDOWN_MS / 2, 1000)).toBe(ZONE_COOLDOWN_MS / 2);
    expect(zoneCooldownLeft(1000 + ZONE_COOLDOWN_MS, 1000)).toBe(0);
    expect(zoneCooldownLeft(1000 + 10 * ZONE_COOLDOWN_MS, 1000)).toBe(0);
  });
});

describe("ZoneTransition", () => {
  it("covers the screen, swaps the zone behind it and then reveals", async () => {
    const log: string[] = [];
    const transition = new ZoneTransition(steps(log));
    expect(await transition.run("dharma")).toBe(true);
    expect(log).toEqual(["cover", "prepare dharma", "apply dharma", "reveal"]);
    expect(transition.busy).toBe(false);
  });

  it("waits for the cover and the preparing to finish before it swaps", async () => {
    const log: string[] = [];
    const cover = deferred<void>();
    const prepare = deferred<boolean>();
    const transition = new ZoneTransition(steps(log, { cover: () => cover.promise, prepare: () => prepare.promise }));
    const done = transition.run("dharma");
    expect(transition.busy).toBe(true);
    prepare.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual([]);
    cover.resolve();
    await done;
    expect(log).toEqual(["apply dharma", "reveal"]);
  });

  it("takes one swap at a time", async () => {
    const log: string[] = [];
    const cover = deferred<void>();
    const transition = new ZoneTransition(steps(log, { cover: () => cover.promise }));
    const first = transition.run("dharma");
    expect(await transition.run("gatbawi")).toBe(false);
    cover.resolve();
    expect(await first).toBe(true);
    expect(log).not.toContain("apply gatbawi");
  });

  it("keeps the old zone, reports the failure and reveals when the new one cannot be had", async () => {
    const log: string[] = [];
    const transition = new ZoneTransition(steps(log, { prepare: async () => false }));
    expect(await transition.run("dharma")).toBe(false);
    expect(log).toEqual(["cover", "fail dharma", "reveal"]);
    expect(transition.busy).toBe(false);
  });

  it("treats a preparing that throws as a failure", async () => {
    const log: string[] = [];
    const transition = new ZoneTransition(
      steps(log, {
        prepare: async () => {
          throw new Error("offline");
        },
      }),
    );
    expect(await transition.run("dharma")).toBe(false);
    expect(log).toEqual(["cover", "fail dharma", "reveal"]);
  });

  it("drops out without touching anything further when it is cancelled, and lifts the veil at once", async () => {
    const log: string[] = [];
    const prepare = deferred<boolean>();
    const transition = new ZoneTransition(steps(log, { prepare: () => prepare.promise }));
    const done = transition.run("dharma");
    transition.cancel();
    expect(transition.busy).toBe(false);
    expect(log).toEqual(["cover", "reveal"]);
    prepare.resolve(true);
    expect(await done).toBe(false);
    expect(log).toEqual(["cover", "reveal"]);
  });

  it("can swap again after a swap has finished", async () => {
    const log: string[] = [];
    const transition = new ZoneTransition(steps(log));
    await transition.run("dharma");
    expect(await transition.run("gatbawi")).toBe(true);
    expect(log.filter((entry) => entry.startsWith("apply"))).toEqual(["apply dharma", "apply gatbawi"]);
  });
});
