import { describe, expect, it } from "vitest";
import { WALK_SPEED, resolveWalkable, yawFromDirection } from "@dongjane/shared";
import {
  KEY_MOVE_INTERVAL_MS,
  KEY_MOVE_REACH,
  RECONCILE_SNAP_DISTANCE,
  SETTLE_TIMEOUT_MS,
  SelfPrediction,
} from "../src/game/prediction.ts";

const FRAME = 1 / 60;
const FRAME_MS = 1000 / 60;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

function hold(
  prediction: SelfPrediction,
  frames: number,
  dir: { x: number; z: number },
  displayed: { x: number; z: number },
  startMs = 0,
): { sends: Array<{ at: number; target: { x: number; z: number } }>; endMs: number } {
  const sends: Array<{ at: number; target: { x: number; z: number } }> = [];
  let now = startMs;
  for (let i = 0; i < frames; i += 1) {
    const target = prediction.frame(FRAME, now, dir, displayed);
    if (target) sends.push({ at: now, target });
    now += FRAME_MS;
  }
  return { sends, endMs: now };
}

describe("SelfPrediction movement", () => {
  it("is inactive and shows nothing until a key is held", () => {
    const prediction = new SelfPrediction();
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
    expect(prediction.frame(FRAME, 0, null, { x: 0, z: 0 })).toBeNull();
    expect(prediction.display()).toBeNull();
  });

  it("advances at walking speed from the displayed point on the very first frame", () => {
    const prediction = new SelfPrediction();
    prediction.frame(FRAME, 0, { x: 0, z: -1 }, { x: 1, z: 4 });
    const shown = must(prediction.display());
    expect(shown.x).toBeCloseTo(1, 10);
    expect(shown.z).toBeCloseTo(4 - WALK_SPEED * FRAME, 10);
    expect(shown.walking).toBe(true);
    expect(shown.yaw).toBeCloseTo(yawFromDirection(0, -1), 10);
    expect(prediction.active).toBe(true);
  });

  it("covers WALK_SPEED metres per second, ignoring the displayed point after the first frame", () => {
    const prediction = new SelfPrediction();
    hold(prediction, 60, { x: 1, z: 0 }, { x: -3, z: 0 });
    const shown = must(prediction.display());
    expect(shown.x).toBeCloseTo(-3 + WALK_SPEED, 6);
    expect(shown.z).toBeCloseTo(0, 10);
  });

  it("moves diagonally at the same speed and normalises an oversized direction", () => {
    const prediction = new SelfPrediction();
    prediction.frame(FRAME, 0, { x: 3, z: 3 }, { x: 0, z: 0 });
    const shown = must(prediction.display());
    expect(Math.hypot(shown.x, shown.z)).toBeCloseTo(WALK_SPEED * FRAME, 10);
    expect(shown.yaw).toBeCloseTo(yawFromDirection(Math.SQRT1_2, Math.SQRT1_2), 10);
  });

  it("clamps to the walkable area exactly like resolveWalkable and stops reporting walking at the wall", () => {
    const prediction = new SelfPrediction();
    const first = prediction.frame(FRAME, 0, { x: 1, z: 0 }, { x: 4.99, z: 0 });
    expect(must(first).x).toBe(resolveWalkable(4.99 + WALK_SPEED * FRAME + KEY_MOVE_REACH, 0).x);
    hold(prediction, 30, { x: 1, z: 0 }, { x: 4.99, z: 0 }, FRAME_MS);
    const shown = must(prediction.display());
    expect(shown.x).toBe(resolveWalkable(99, 0).x);
    expect(shown.walking).toBe(false);

    const back = new SelfPrediction();
    hold(back, 600, { x: 0, z: -1 }, { x: 0, z: 0 });
    expect(must(back.display()).z).toBe(resolveWalkable(0, -99).z);
  });

  it("slides along a wall while the other axis is free", () => {
    const prediction = new SelfPrediction();
    hold(prediction, 30, { x: Math.SQRT1_2, z: Math.SQRT1_2 }, { x: 4.9, z: 2 });
    const shown = must(prediction.display());
    expect(shown.x).toBe(5);
    expect(shown.z).toBeGreaterThan(2.5);
    expect(shown.walking).toBe(true);
  });
});

describe("SelfPrediction sending", () => {
  it("sends immediately on the first frame, aimed ahead of the predicted point", () => {
    const prediction = new SelfPrediction();
    const target = must(prediction.frame(FRAME, 0, { x: 0, z: -1 }, { x: 0, z: 4 }));
    const shown = must(prediction.display());
    expect(target.x).toBeCloseTo(shown.x, 10);
    expect(target.z).toBeCloseTo(shown.z - KEY_MOVE_REACH, 10);
  });

  it("then sends about every KEY_MOVE_INTERVAL_MS from the current predicted point", () => {
    const prediction = new SelfPrediction();
    const { sends } = hold(prediction, 60, { x: 0, z: -1 }, { x: 0, z: 4.9 });
    expect(sends.length).toBeGreaterThanOrEqual(9);
    expect(sends.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < sends.length; i += 1) {
      const gap = (sends[i] as (typeof sends)[number]).at - (sends[i - 1] as (typeof sends)[number]).at;
      expect(gap).toBeGreaterThanOrEqual(KEY_MOVE_INTERVAL_MS);
      expect(gap).toBeLessThan(KEY_MOVE_INTERVAL_MS + FRAME_MS + 1e-6);
    }
    const second = sends[1] as (typeof sends)[number];
    const firstTarget = (sends[0] as (typeof sends)[number]).target;
    expect(second.target.z).toBeLessThan(firstTarget.z);
  });

  it("sends at once when the heading turns, but not for a small wobble", () => {
    const prediction = new SelfPrediction();
    prediction.frame(FRAME, 0, { x: 0, z: -1 }, { x: 0, z: 4 });
    expect(prediction.frame(FRAME, FRAME_MS, { x: 0.1, z: -1 }, { x: 0, z: 4 })).toBeNull();
    const turned = must(prediction.frame(FRAME, 2 * FRAME_MS, { x: 1, z: 0 }, { x: 0, z: 4 }));
    const shown = must(prediction.display());
    expect(turned.x).toBeCloseTo(shown.x + KEY_MOVE_REACH, 10);
    expect(turned.z).toBeCloseTo(shown.z, 10);
  });

  it("sends the predicted point on release, never the server's position", () => {
    const prediction = new SelfPrediction();
    const { endMs } = hold(prediction, 30, { x: 0, z: -1 }, { x: 0, z: 4.9 });
    prediction.reconcile({ x: 0, z: 4.9 - 0.4, mode: "walk" }, endMs);
    const before = must(prediction.display());
    const release = must(prediction.frame(FRAME, endMs, null, { x: 0, z: 4.9 - 0.4 }));
    expect(release).toEqual({ x: before.x, z: before.z });
    expect(release.z).toBeLessThan(4.9 - 1);
    expect(must(prediction.display())).toEqual({ x: before.x, z: before.z, yaw: before.yaw, walking: false });
  });

  it("releases once, treats a zero direction as a release, and does nothing when idle", () => {
    const prediction = new SelfPrediction();
    expect(prediction.frame(FRAME, 0, null, { x: 0, z: 0 })).toBeNull();
    prediction.frame(FRAME, 0, { x: 1, z: 0 }, { x: 0, z: 0 });
    expect(prediction.frame(FRAME, 16, { x: 0, z: 0 }, { x: 0, z: 0 })).not.toBeNull();
    expect(prediction.frame(FRAME, 32, null, { x: 0, z: 0 })).toBeNull();
    expect(prediction.frame(FRAME, 48, { x: 0, z: 0 }, { x: 0, z: 0 })).toBeNull();
  });

  it("sends a start and a stop even for a one-frame tap", () => {
    const prediction = new SelfPrediction();
    const start = must(prediction.frame(FRAME, 0, { x: 0, z: -1 }, { x: 0, z: 4 }));
    const stop = must(prediction.frame(FRAME, FRAME_MS, null, { x: 0, z: 4 }));
    expect(stop.z).toBeCloseTo(4 - WALK_SPEED * FRAME, 10);
    expect(start.z).toBeLessThan(stop.z);
  });

  it("resumes from the predicted point, not the lagging displayed one, when a key goes down again", () => {
    const prediction = new SelfPrediction();
    const { endMs } = hold(prediction, 30, { x: 0, z: -1 }, { x: 0, z: 4.9 });
    const release = must(prediction.frame(FRAME, endMs, null, { x: 0, z: 4.9 }));
    const target = must(prediction.frame(FRAME, endMs + FRAME_MS, { x: 0, z: -1 }, { x: 0, z: 4.9 }));
    expect(target.z).toBeCloseTo(release.z - WALK_SPEED * FRAME - KEY_MOVE_REACH, 10);
    expect(must(prediction.display()).z).toBeCloseTo(release.z - WALK_SPEED * FRAME, 10);
  });
});

describe("SelfPrediction reconcile", () => {
  function walking(): { prediction: SelfPrediction; at: number } {
    const prediction = new SelfPrediction();
    const { endMs } = hold(prediction, 30, { x: 0, z: -1 }, { x: 0, z: 4.5 });
    return { prediction, at: endMs };
  }

  it("keeps the prediction when the server is within the snap distance", () => {
    const { prediction, at } = walking();
    const before = must(prediction.display());
    prediction.reconcile({ x: before.x, z: before.z + RECONCILE_SNAP_DISTANCE - 0.01, mode: "walk" }, at);
    expect(must(prediction.display())).toEqual(before);
    prediction.reconcile({ x: before.x - (RECONCILE_SNAP_DISTANCE - 0.01), z: before.z, mode: "walk" }, at);
    expect(must(prediction.display())).toEqual(before);
  });

  it("snaps to the server once it is further away than the snap distance", () => {
    const { prediction, at } = walking();
    const before = must(prediction.display());
    prediction.reconcile({ x: before.x + 1, z: before.z + RECONCILE_SNAP_DISTANCE + 0.01, mode: "walk" }, at);
    const after = must(prediction.display());
    expect(after.x).toBe(before.x + 1);
    expect(after.z).toBe(before.z + RECONCILE_SNAP_DISTANCE + 0.01);
    expect(prediction.active).toBe(true);
  });

  it("ignores the server entirely while idle", () => {
    const prediction = new SelfPrediction();
    prediction.reconcile({ x: 3, z: 3, mode: "walk" }, 0);
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
  });

  it("stays in control while the server is still catching up after release", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile({ x: 0, z: target.z + 0.5, mode: "walk" }, at + 100);
    expect(prediction.active).toBe(true);
    expect(must(prediction.display()).z).toBe(target.z);
    prediction.reconcile({ x: 0, z: target.z, mode: "walk" }, at + 200);
    expect(prediction.active).toBe(true);
  });

  it("hands display back to the server once it has stopped at the released point", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile({ x: 0, z: target.z + 0.3, mode: "stand" }, at + 200);
    expect(prediction.active).toBe(true);
    prediction.reconcile({ x: 0, z: target.z, mode: "stand" }, at + 250);
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
  });

  it("gives up waiting after the settle timeout so a lost message cannot freeze the monk", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile({ x: 0, z: target.z + 1, mode: "stand" }, at + SETTLE_TIMEOUT_MS - 1);
    expect(prediction.active).toBe(true);
    prediction.reconcile({ x: 0, z: target.z + 1, mode: "stand" }, at + SETTLE_TIMEOUT_MS);
    expect(prediction.active).toBe(false);
  });

  it("drops straight to the server after release when it is far away", () => {
    const { prediction, at } = walking();
    prediction.frame(FRAME, at, null, { x: 0, z: 4.5 });
    prediction.reconcile({ x: 0, z: -2.9, mode: "stand" }, at + 100);
    expect(prediction.active).toBe(false);
  });

  it("cancel drops the prediction at any phase", () => {
    const { prediction, at } = walking();
    prediction.cancel();
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
    prediction.frame(FRAME, at, { x: 0, z: -1 }, { x: 0, z: 0 });
    prediction.frame(FRAME, at + 16, null, { x: 0, z: 0 });
    prediction.cancel();
    expect(prediction.active).toBe(false);
    expect(prediction.frame(FRAME, at + 32, null, { x: 0, z: 0 })).toBeNull();
  });
});
