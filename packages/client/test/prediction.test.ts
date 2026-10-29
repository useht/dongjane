import { describe, expect, it } from "vitest";
import { WALK_SPEED, resolveWalkable, yawFromDirection } from "@dongjane/shared";
import {
  KEY_MOVE_INTERVAL_MS,
  KEY_MOVE_REACH,
  PATH_TOLERANCE,
  SETTLE_TIMEOUT_MS,
  SelfPrediction,
  type Point,
  type SelfDisplay,
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

  it("ignores a server position that is on our recent path, however far behind it is", () => {
    const { prediction, at } = walking();
    const before = must(prediction.display());
    prediction.reconcile({ x: 0, z: 4.5, mode: "stand" }, at);
    expect(must(prediction.display())).toEqual(before);
    prediction.reconcile({ x: 0, z: 4.1, mode: "walk" }, at);
    expect(must(prediction.display())).toEqual(before);
  });

  it("tolerates a server that is slightly off the path and snaps once it is further than PATH_TOLERANCE", () => {
    const { prediction, at } = walking();
    const before = must(prediction.display());
    prediction.reconcile({ x: PATH_TOLERANCE - 0.01, z: 4.1, mode: "walk" }, at);
    expect(must(prediction.display())).toEqual(before);
    prediction.reconcile({ x: PATH_TOLERANCE + 0.01, z: 4.1, mode: "walk" }, at);
    const after = must(prediction.display());
    expect(after.x).toBe(PATH_TOLERANCE + 0.01);
    expect(after.z).toBe(4.1);
    expect(prediction.active).toBe(true);
  });

  it("snaps to a server position that is far from the whole path, such as one ahead of us or sideways", () => {
    const ahead = walking();
    const front = must(ahead.prediction.display());
    ahead.prediction.reconcile({ x: front.x, z: front.z - 2, mode: "walk" }, ahead.at);
    expect(must(ahead.prediction.display()).z).toBe(front.z - 2);

    const sideways = walking();
    const where = must(sideways.prediction.display());
    sideways.prediction.reconcile({ x: where.x + 4, z: where.z, mode: "walk" }, sideways.at);
    const after = must(sideways.prediction.display());
    expect(after.x).toBe(where.x + 4);
    expect(after.z).toBe(where.z);
  });

  it("measures the path again from the snapped point, so the old path no longer excuses the server", () => {
    const { prediction, at } = walking();
    const where = must(prediction.display());
    prediction.reconcile({ x: where.x + 4, z: where.z, mode: "walk" }, at);
    prediction.reconcile({ x: where.x, z: where.z, mode: "walk" }, at + 50);
    expect(must(prediction.display()).x).toBe(where.x);
  });

  it("forgets the path after four seconds, so only a recent server position is excused", () => {
    const { prediction, at } = walking();
    prediction.frame(FRAME, at, null, { x: 0, z: 4.5 });
    prediction.reconcile({ x: 0, z: 4.5, mode: "walk" }, at + 3500);
    expect(prediction.active).toBe(true);
    expect(must(prediction.display()).z).toBeLessThan(4.1);
    prediction.reconcile({ x: 0, z: 4.5, mode: "walk" }, at + 5000);
    expect(prediction.active).toBe(false);
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
    prediction.reconcile({ x: 0, z: 4.5, mode: "stand" }, at + 3000);
    expect(prediction.active).toBe(true);
  });

  it("hands display back to the server once it has stopped at the released point", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile({ x: 0, z: target.z + 0.3, mode: "stand" }, at + 200);
    expect(prediction.active).toBe(true);
    prediction.reconcile({ x: 0, z: target.z + 0.14, mode: "stand" }, at + 250);
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
  });

  it("drops straight to the server after release when it is far from the path", () => {
    const { prediction, at } = walking();
    prediction.frame(FRAME, at, null, { x: 0, z: 4.5 });
    prediction.reconcile({ x: 0, z: -2.9, mode: "stand" }, at + 100);
    expect(prediction.active).toBe(false);
  });

  it("falls back after the settle timeout by walking to the server's point instead of teleporting", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    const stuck = { x: 0, z: target.z + 0.4, mode: "stand" };
    prediction.reconcile(stuck, at + SETTLE_TIMEOUT_MS - 1);
    expect(must(prediction.display()).z).toBe(target.z);
    prediction.reconcile(stuck, at + SETTLE_TIMEOUT_MS);
    expect(prediction.active).toBe(true);

    let previous = must(prediction.display());
    let frames = 0;
    while (prediction.active && frames < 600) {
      prediction.frame(FRAME, at + SETTLE_TIMEOUT_MS + frames * FRAME_MS, null, { x: 0, z: 0 });
      const shown = prediction.display();
      if (shown) {
        expect(Math.hypot(shown.x - previous.x, shown.z - previous.z)).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-9);
        expect(shown.walking).toBe(true);
        previous = shown;
      }
      frames += 1;
    }
    expect(prediction.active).toBe(false);
    expect(previous.z).toBeCloseTo(stuck.z, 1);
    expect(frames).toBeGreaterThan(Math.floor(0.4 / (WALK_SPEED * FRAME)) - 2);
  });

  it("lets a new key press interrupt the fallback walk from the point it has reached", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile({ x: 0, z: target.z + 0.4, mode: "stand" }, at + SETTLE_TIMEOUT_MS);
    prediction.frame(FRAME, at + SETTLE_TIMEOUT_MS, null, { x: 0, z: 0 });
    const gliding = must(prediction.display());
    const press = must(prediction.frame(FRAME, at + SETTLE_TIMEOUT_MS + FRAME_MS, { x: 1, z: 0 }, { x: 0, z: 0 }));
    expect(press.x).toBeGreaterThan(gliding.x);
    expect(press.z).toBeCloseTo(gliding.z, 1);
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

function seededJitter(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

interface Frame {
  t: number;
  display: SelfDisplay | null;
  server: Point & { mode: string };
}

interface Link {
  oneWayMs: number;
  jitterMs: number;
  seed: number;
}

// A client, a walking server (20 Hz state, snaps onto each target) and an in-order link with a fixed delay plus jitter.
function runLink(
  link: Link,
  totalMs: number,
  start: Point,
  dirAt: (t: number) => Point | null,
): { frames: Frame[]; moves: Point[]; server: Point } {
  const random = seededJitter(link.seed);
  const prediction = new SelfPrediction();
  const server = { x: start.x, z: start.z, mode: "stand" };
  let target: Point | null = null;
  const upstream: Array<{ at: number; target: Point }> = [];
  const downstream: Array<{ at: number; x: number; z: number; mode: string }> = [];
  let lastUp = 0;
  let lastDown = 0;
  let nextTick = 0;
  let latest = { x: start.x, z: start.z, mode: "stand" };
  const frames: Frame[] = [];
  const moves: Point[] = [];
  const delay = (): number => link.oneWayMs + link.jitterMs * random();

  for (let now = 0; now <= totalMs; now += FRAME_MS) {
    for (let item = upstream[0]; item && item.at <= now; item = upstream[0]) {
      target = upstream.shift()?.target ?? null;
    }
    for (; nextTick <= now; nextTick += 50) {
      if (target) {
        const dx = target.x - server.x;
        const dz = target.z - server.z;
        const gap = Math.hypot(dx, dz);
        const step = WALK_SPEED * 0.05;
        if (gap <= step) {
          server.x = target.x;
          server.z = target.z;
          target = null;
          server.mode = "stand";
        } else {
          server.x += (dx / gap) * step;
          server.z += (dz / gap) * step;
          server.mode = "walk";
        }
      }
      lastDown = Math.max(lastDown, nextTick + delay());
      downstream.push({ at: lastDown, x: server.x, z: server.z, mode: server.mode });
    }
    for (let item = downstream[0]; item && item.at <= now; item = downstream[0]) {
      downstream.shift();
      latest = { x: item.x, z: item.z, mode: item.mode };
      prediction.reconcile(latest, now);
    }
    const sent = prediction.frame(FRAME, now, dirAt(now), latest);
    if (sent) {
      lastUp = Math.max(lastUp, now + delay());
      upstream.push({ at: lastUp, target: sent });
      moves.push(sent);
    }
    frames.push({ t: now, display: prediction.display(), server: latest });
  }
  return { frames, moves, server };
}

function shownSteps(frames: Frame[]): Array<{ dx: number; dz: number; dist: number }> {
  const steps: Array<{ dx: number; dz: number; dist: number }> = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = (frames[i - 1] as Frame).display;
    const b = (frames[i] as Frame).display;
    if (!a || !b) continue;
    steps.push({ dx: b.x - a.x, dz: b.z - a.z, dist: Math.hypot(b.x - a.x, b.z - a.z) });
  }
  return steps;
}

describe("SelfPrediction on a slow link", () => {
  const RTT = 1500;

  it("keeps walking forward with no snap while the server trails by a whole round trip", () => {
    const { frames } = runLink({ oneWayMs: RTT / 2, jitterMs: 0, seed: 1 }, 4000, { x: -4.9, z: 0 }, () => ({ x: 1, z: 0 }));
    const lagged = frames.filter((frame) => frame.t > RTT && frame.t < 4000);
    expect(lagged.length).toBeGreaterThan(100);
    const last = lagged[lagged.length - 1] as Frame;
    expect((last.display as SelfDisplay).x - last.server.x).toBeGreaterThan(WALK_SPEED * 1.2);
    const steps = shownSteps(frames);
    expect(steps.length).toBeGreaterThan(200);
    for (const step of steps) {
      expect(step.dx).toBeGreaterThanOrEqual(-1e-9);
      expect(step.dist).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
    }
    expect((last.display as SelfDisplay).x).toBeCloseTo(-4.9 + (WALK_SPEED * 4000) / 1000, 1);
  });

  it.each([0, 150, 300])("keeps following a turn with %i ms of jitter without a snap or a backward step", (jitterMs) => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { frames } = runLink({ oneWayMs: RTT / 2, jitterMs, seed }, 4400, { x: -4.9, z: 4.5 }, (t) =>
        t < 2000 ? { x: 1, z: 0 } : { x: 0, z: -1 },
      );
      const steps = shownSteps(frames);
      for (const step of steps) {
        expect(step.dx, `seed ${seed}`).toBeGreaterThanOrEqual(-1e-9);
        expect(step.dz, `seed ${seed}`).toBeLessThanOrEqual(1e-9);
        expect(step.dist, `seed ${seed}`).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
      }
    }
  });

  it.each([1500, 3000])("releases cleanly at RTT %i ms: no backward step and a handover within 0.15 m", (rtt) => {
    const holdMs = 2000;
    const { frames, moves, server } = runLink({ oneWayMs: rtt / 2, jitterMs: 0, seed: 3 }, holdMs + rtt + 4000, { x: -4.9, z: 0 }, (t) =>
      t < holdMs ? { x: 1, z: 0 } : null,
    );
    const steps = shownSteps(frames);
    expect(steps.length).toBeGreaterThan(100);
    for (const step of steps) {
      expect(step.dx).toBeGreaterThanOrEqual(-1e-9);
      expect(step.dist).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
    }

    const handover = frames.findIndex((frame, index) => index > 0 && frame.display === null && (frames[index - 1] as Frame).display !== null);
    expect(handover).toBeGreaterThan(0);
    const settled = (frames[handover - 1] as Frame).display as SelfDisplay;
    const release = moves[moves.length - 1] as Point;
    expect(settled.x).toBe(release.x);
    expect(settled.z).toBe(release.z);
    const now = frames[handover] as Frame;
    expect(Math.hypot(now.server.x - settled.x, now.server.z - settled.z)).toBeLessThanOrEqual(0.15);
    expect(now.server.mode).toBe("stand");
    expect(now.t).toBeLessThan(holdMs + SETTLE_TIMEOUT_MS);
    expect(Math.hypot(server.x - release.x, server.z - release.z)).toBeLessThanOrEqual(0.15);
  });
});
