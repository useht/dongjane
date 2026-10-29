import { describe, expect, it } from "vitest";
import { ARRIVE_DISTANCE, WALK_SPEED, WORLD_BOUNDS, resolveWalkable, yawFromDirection } from "@dongjane/shared";
import {
  KEY_MOVE_INTERVAL_MS,
  KEY_MOVE_REACH,
  MAX_FRAME_DT_S,
  SelfPrediction,
  type MoveTarget,
  type Point,
  type SelfDisplay,
  type ServerSelf,
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
): { sends: Array<{ at: number; target: MoveTarget }>; endMs: number } {
  const sends: Array<{ at: number; target: MoveTarget }> = [];
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

  it("never advances more than MAX_FRAME_DT_S of walking in one frame, however long the frame took", () => {
    const prediction = new SelfPrediction();
    prediction.frame(0.25, 0, { x: 1, z: 0 }, { x: 0, z: 0 });
    expect(must(prediction.display()).x).toBeLessThanOrEqual(WALK_SPEED * 0.1 + 1e-9);
    expect(must(prediction.display()).x).toBeCloseTo(WALK_SPEED * MAX_FRAME_DT_S, 10);
    const before = must(prediction.display()).x;
    prediction.frame(5, 16, { x: 1, z: 0 }, { x: 0, z: 0 });
    expect(must(prediction.display()).x - before).toBeLessThanOrEqual(WALK_SPEED * 0.1 + 1e-9);
  });

  it("slides along a wall while the other axis is free", () => {
    const prediction = new SelfPrediction();
    hold(prediction, 30, { x: Math.SQRT1_2, z: Math.SQRT1_2 }, { x: WORLD_BOUNDS.maxX - 0.1, z: 2 });
    const shown = must(prediction.display());
    expect(shown.x).toBe(WORLD_BOUNDS.maxX);
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
    prediction.reconcile({ x: 0, z: 4.9 - 0.4, mode: "walk", ackSeq: 0 });
    const before = must(prediction.display());
    const release = must(prediction.frame(FRAME, endMs, null, { x: 0, z: 4.9 - 0.4 }));
    expect(release).toEqual({ x: before.x, z: before.z, seq: expect.any(Number) });
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

  it("numbers every target it sends with a strictly increasing seq that survives cancel", () => {
    const prediction = new SelfPrediction();
    const { sends, endMs } = hold(prediction, 40, { x: 0, z: -1 }, { x: 0, z: 4.9 });
    const release = must(prediction.frame(FRAME, endMs, null, { x: 0, z: 4.9 }));
    const seqs = [...sends.map((send) => send.target.seq), release.seq];
    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    prediction.cancel();
    const again = must(prediction.frame(FRAME, endMs + 1000, { x: 0, z: -1 }, { x: 0, z: 4.9 }));
    expect(again.seq).toBeGreaterThan(release.seq);
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
  const state = (x: number, z: number, mode: string, ackSeq: number): ServerSelf => ({ x, z, mode, ackSeq });

  function walking(): { prediction: SelfPrediction; at: number } {
    const prediction = new SelfPrediction();
    const { endMs } = hold(prediction, 30, { x: 0, z: -1 }, { x: 0, z: 4.5 });
    return { prediction, at: endMs };
  }

  it("never moves the display while a key is held, wherever the server says it is", () => {
    const { prediction } = walking();
    const before = must(prediction.display());
    for (const server of [
      state(0, 4.5, "stand", 99),
      state(before.x + 4, before.z, "walk", 99),
      state(before.x, before.z - 6, "stand", 99),
      state(-5, 5, "walk", 0),
    ]) {
      prediction.reconcile(server);
      expect(must(prediction.display())).toEqual(before);
      expect(prediction.active).toBe(true);
    }
  });

  it("ignores the server entirely while idle", () => {
    const prediction = new SelfPrediction();
    prediction.reconcile(state(3, 3, "stand", 99));
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
  });

  it("stays at the released point while the server is still walking, even right next to it", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile(state(0, target.z + 0.5, "walk", target.seq));
    expect(prediction.active).toBe(true);
    expect(must(prediction.display()).z).toBe(target.z);
    prediction.reconcile(state(0, target.z, "walk", target.seq));
    expect(prediction.active).toBe(true);
    expect(must(prediction.display()).walking).toBe(false);
  });

  it("a stale stand state at the pre-press position, sent with the old ackSeq, does not settle", () => {
    const prediction = new SelfPrediction();
    const press = must(prediction.frame(FRAME, 0, { x: 0, z: -1 }, { x: 0, z: 4 }));
    const stop = must(prediction.frame(FRAME, FRAME_MS, null, { x: 0, z: 4 }));
    expect(Math.abs(stop.z - 4)).toBeLessThan(0.15);

    prediction.reconcile(state(0, 4, "stand", 0));
    expect(prediction.active).toBe(true);
    prediction.reconcile(state(0, 4, "stand", press.seq));
    expect(prediction.active).toBe(true);
    expect(must(prediction.display()).z).toBe(stop.z);
  });

  it("settles once ackSeq reaches the release, the server is not walking and it stands at the released point", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile(state(0, target.z, "stand", target.seq - 1));
    expect(prediction.active).toBe(true);
    prediction.reconcile(state(0, target.z, "walk", target.seq));
    expect(prediction.active).toBe(true);
    prediction.reconcile(state(0, target.z + 0.16, "stand", target.seq));
    expect(prediction.active).toBe(true);
    prediction.reconcile(state(0, target.z + 0.14, "stand", target.seq));
    expect(prediction.active).toBe(false);
    expect(prediction.display()).toBeNull();
  });

  it("accepts an ack that is ahead of the release", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile(state(0, target.z, "stand", target.seq + 7));
    expect(prediction.active).toBe(false);
  });

  it("has no time limit: it keeps waiting for the ack however stale the server looks", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    for (let i = 0; i < 400; i += 1) {
      prediction.frame(FRAME, at + 100 + i * 100, null, { x: 0, z: 4.5 });
      prediction.reconcile(state(0, target.z, "stand", target.seq - 1));
    }
    expect(prediction.active).toBe(true);
    expect(must(prediction.display()).z).toBe(target.z);
  });

  it("lets the next key press resume from the released point, not from the server", () => {
    const { prediction, at } = walking();
    const target = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.reconcile(state(3, 0, "stand", 0));
    const press = must(prediction.frame(FRAME, at + 20_000, { x: 0, z: -1 }, { x: 3, z: 0 }));
    expect(press.z).toBeCloseTo(target.z - WALK_SPEED * FRAME - KEY_MOVE_REACH, 10);
    expect(press.seq).toBeGreaterThan(target.seq);
    expect(must(prediction.display()).x).toBe(0);
  });

  it("a later press moves the settle point to the new release", () => {
    const { prediction, at } = walking();
    const first = must(prediction.frame(FRAME, at, null, { x: 0, z: 4.5 }));
    prediction.frame(FRAME, at + 20, { x: 0, z: -1 }, { x: 0, z: 4.5 });
    const second = must(prediction.frame(FRAME, at + 40, null, { x: 0, z: 4.5 }));
    expect(second.seq).toBeGreaterThan(first.seq);
    prediction.reconcile(state(0, second.z, "stand", first.seq));
    expect(prediction.active).toBe(true);
    prediction.reconcile(state(0, second.z, "stand", second.seq));
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
  server: ServerSelf;
  sent: MoveTarget | null;
}

interface Link {
  oneWayMs: number;
  jitterMs: number;
  seed: number;
  stall?: { atMs: number; ms: number };
}

// A client, a server that applies each move on arrival like the sim and acks it in a 20 Hz state, and an in-order link with a fixed delay plus jitter.
function runLink(
  link: Link,
  totalMs: number,
  start: Point,
  dirAt: (t: number) => Point | null,
): { frames: Frame[]; moves: MoveTarget[]; server: Point } {
  const random = seededJitter(link.seed);
  const prediction = new SelfPrediction();
  const server = { x: start.x, z: start.z, mode: "stand", ackSeq: 0 };
  let target: Point | null = null;
  const upstream: Array<{ at: number; move: MoveTarget }> = [];
  const downstream: Array<{ at: number; state: ServerSelf }> = [];
  let lastUp = 0;
  let lastDown = 0;
  let nextTick = 0;
  let latest: ServerSelf = { ...server };
  const frames: Frame[] = [];
  const moves: MoveTarget[] = [];
  const delay = (): number => link.oneWayMs + link.jitterMs * random();

  let stalled = false;
  let previous = 0;
  for (let now = 0; now <= totalMs; ) {
    for (let item = upstream[0]; item && item.at <= now; item = upstream[0]) {
      upstream.shift();
      server.ackSeq = Math.max(server.ackSeq, item.move.seq);
      if (Math.hypot(item.move.x - server.x, item.move.z - server.z) <= ARRIVE_DISTANCE) {
        server.x = item.move.x;
        server.z = item.move.z;
        target = null;
        server.mode = "stand";
      } else {
        target = item.move;
        server.mode = "walk";
      }
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
      downstream.push({ at: lastDown, state: { x: server.x, z: server.z, mode: server.mode, ackSeq: server.ackSeq } });
    }
    for (let item = downstream[0]; item && item.at <= now; item = downstream[0]) {
      downstream.shift();
      latest = item.state;
      prediction.reconcile(latest);
    }
    const dt = now === 0 ? FRAME : (now - previous) / 1000;
    const sent = prediction.frame(dt, now, dirAt(now), latest);
    if (sent) {
      lastUp = Math.max(lastUp, now + delay());
      upstream.push({ at: lastUp, move: sent });
      moves.push(sent);
    }
    frames.push({ t: now, display: prediction.display(), server: latest, sent });
    previous = now;
    if (link.stall && !stalled && now >= link.stall.atMs) {
      stalled = true;
      now += link.stall.ms;
    } else {
      now += FRAME_MS;
    }
  }
  return { frames, moves, server };
}

function stepsOf(positions: Array<Point | null>): Array<{ dx: number; dz: number; dist: number }> {
  const steps: Array<{ dx: number; dz: number; dist: number }> = [];
  for (let i = 1; i < positions.length; i += 1) {
    const a = positions[i - 1];
    const b = positions[i];
    if (!a || !b) continue;
    steps.push({ dx: b.x - a.x, dz: b.z - a.z, dist: Math.hypot(b.x - a.x, b.z - a.z) });
  }
  return steps;
}

function shownSteps(frames: Frame[]): Array<{ dx: number; dz: number; dist: number }> {
  return stepsOf(frames.map((frame) => frame.display));
}

// What is on screen: the prediction while it is active, the server's position once it has handed over.
function visibleSteps(frames: Frame[]): Array<{ dx: number; dz: number; dist: number }> {
  return stepsOf(frames.map((frame) => frame.display ?? frame.server));
}

describe("SelfPrediction on a bad link", () => {
  it("keeps walking forward with no snap while the server trails by a whole round trip", () => {
    const RTT = 1500;
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

  it.each([1000, 2000])("follows a 90 degree turn at RTT %i ms with 600 ms of jitter, never snapping or stepping backward", (rtt) => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const { frames } = runLink({ oneWayMs: rtt / 2, jitterMs: 600, seed }, 4400, { x: -4.9, z: 4.5 }, (t) =>
        t < 2000 ? { x: 1, z: 0 } : { x: 0, z: -1 },
      );
      const steps = shownSteps(frames);
      expect(steps.length, `seed ${seed}`).toBeGreaterThan(200);
      for (const step of steps) {
        expect(step.dx, `seed ${seed}`).toBeGreaterThanOrEqual(-1e-9);
        expect(step.dz, `seed ${seed}`).toBeLessThanOrEqual(1e-9);
        expect(step.dist, `seed ${seed}`).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
      }
    }
  });

  it.each([1500, 3000, 4500])("releases cleanly at RTT %i ms: no backward step, handover only after the server acks the stop", (rtt) => {
    const holdMs = 3000;
    const { frames, moves, server } = runLink({ oneWayMs: rtt / 2, jitterMs: 0, seed: 3 }, holdMs + rtt + 3000, { x: -4.9, z: 0 }, (t) =>
      t < holdMs ? { x: 1, z: 0 } : null,
    );
    const steps = shownSteps(frames);
    expect(steps.length).toBeGreaterThan(150);
    for (const step of steps) {
      expect(step.dx).toBeGreaterThanOrEqual(-1e-9);
      expect(step.dist).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
    }

    const handover = frames.findIndex((frame, index) => index > 0 && frame.display === null && (frames[index - 1] as Frame).display !== null);
    expect(handover).toBeGreaterThan(0);
    const settled = (frames[handover - 1] as Frame).display as SelfDisplay;
    const release = moves[moves.length - 1] as MoveTarget;
    expect(settled.x).toBe(release.x);
    expect(settled.z).toBe(release.z);
    const now = frames[handover] as Frame;
    expect(now.server.mode).toBe("stand");
    expect(now.server.ackSeq).toBeGreaterThanOrEqual(release.seq);
    expect(Math.hypot(now.server.x - settled.x, now.server.z - settled.z)).toBeLessThanOrEqual(0.15);
    expect(now.t).toBeGreaterThan(holdMs + rtt * 0.9);
    expect(Math.hypot(server.x - release.x, server.z - release.z)).toBeLessThanOrEqual(0.15);
  });

  it.each([600, 800])("rides out a %i ms frame hitch at RTT 200 ms without a forward jump", (stallMs) => {
    const { frames } = runLink(
      { oneWayMs: 100, jitterMs: 0, seed: 5, stall: { atMs: 1000, ms: stallMs } },
      3200,
      { x: -4.9, z: 0 },
      () => ({ x: 1, z: 0 }),
    );
    let ahead = 0;
    for (const frame of frames) if (frame.display) ahead = Math.max(ahead, frame.server.x - frame.display.x);
    expect(ahead).toBeGreaterThan(0.3);

    const steps = shownSteps(frames);
    let biggest = 0;
    for (const step of steps) {
      expect(step.dx).toBeGreaterThanOrEqual(-1e-9);
      biggest = Math.max(biggest, step.dist);
    }
    expect(biggest).toBeLessThanOrEqual(WALK_SPEED * MAX_FRAME_DT_S + 1e-6);
    expect(biggest).toBeGreaterThan(WALK_SPEED * MAX_FRAME_DT_S * 0.9);
    const last = frames[frames.length - 1] as Frame;
    expect((last.display as SelfDisplay).x).toBeCloseTo(-4.9 + WALK_SPEED * (3.2 - stallMs / 1000 + MAX_FRAME_DT_S), 0);
  });
});

describe("SelfPrediction taps", () => {
  const TAP_FROM_MS = 505;
  const TAPS: Array<[number, number]> = [
    [100, 17],
    [100, 40],
    [100, 60],
    [4500, 17],
    [4500, 40],
    [4500, 60],
  ];

  function backwardAfter(frames: Frame[], from: number, forward: Point): number {
    let backward = 0;
    const steps = visibleSteps(frames);
    for (let i = Math.max(0, from - 1); i < steps.length; i += 1) {
      const step = steps[i] as { dx: number; dz: number };
      backward += Math.max(0, -(step.dx * forward.x + step.dz * forward.z));
    }
    return backward;
  }

  it.each(TAPS)("a tap at RTT %i ms held for %i ms never steps backward after the release and hands over exactly", (rtt, tapMs) => {
    const { frames, moves } = runLink(
      { oneWayMs: rtt / 2, jitterMs: 0, seed: 1 },
      TAP_FROM_MS + tapMs + rtt + 2500,
      { x: 0, z: 3 },
      (t) => (t >= TAP_FROM_MS && t < TAP_FROM_MS + tapMs ? { x: 0, z: -1 } : null),
    );
    const release = moves[moves.length - 1] as MoveTarget;
    const releaseAt = frames.findIndex((frame) => frame.sent === release);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(releaseAt).toBeGreaterThan(0);

    expect(backwardAfter(frames, releaseAt, { x: 0, z: -1 })).toBeLessThanOrEqual(1e-9);
    for (const step of visibleSteps(frames)) {
      expect(Math.abs(step.dx)).toBeLessThanOrEqual(1e-9);
      expect(step.dist).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
    }

    const handover = frames.findIndex((frame, index) => index > releaseAt && frame.display === null);
    expect(handover).toBeGreaterThan(releaseAt);
    const at = frames[handover] as Frame;
    expect(at.t - (frames[releaseAt] as Frame).t).toBeGreaterThan(rtt * 0.9);
    expect(at.server.mode).toBe("stand");
    expect(at.server.ackSeq).toBeGreaterThanOrEqual(release.seq);
    const end = frames[frames.length - 1] as Frame;
    expect(end.display).toBeNull();
    expect(end.server.x).toBeCloseTo(release.x, 6);
    expect(end.server.z).toBeCloseTo(release.z, 6);
  });

  it("a corner tap at the wall at RTT 4500 ms does not step back while the server still stands at the wall", () => {
    const rtt = 4500;
    const { frames, moves } = runLink(
      { oneWayMs: rtt / 2, jitterMs: 0, seed: 1 },
      1550 + rtt + 3000,
      { x: 3, z: 3 },
      (t) => (t < 1500 ? { x: 1, z: 0 } : t < 1550 ? { x: 0, z: -1 } : null),
    );
    const release = moves[moves.length - 1] as MoveTarget;
    expect(release.x).toBe(WORLD_BOUNDS.maxX);
    expect(release.z).toBeLessThan(3);
    expect(release.z).toBeGreaterThan(3 - 0.15);

    const steps = visibleSteps(frames);
    expect(steps.length).toBeGreaterThan(300);
    for (const step of steps) {
      expect(step.dx).toBeGreaterThanOrEqual(-1e-9);
      expect(step.dz).toBeLessThanOrEqual(1e-9);
      expect(step.dist).toBeLessThanOrEqual(WALK_SPEED * FRAME + 1e-6);
    }
    const end = frames[frames.length - 1] as Frame;
    expect(end.display).toBeNull();
    expect(end.server.x).toBeCloseTo(release.x, 6);
    expect(end.server.z).toBeCloseTo(release.z, 6);
  });
});
