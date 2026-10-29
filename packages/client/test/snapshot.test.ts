import { describe, expect, it } from "vitest";
import { WALK_SPEED, yawFromDirection } from "@dongjane/shared";
import {
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  EXTRAPOLATION_MAX_MS,
  RemoteTrack,
  ServerClock,
  type Sample,
  SnapshotBuffer,
} from "../src/game/snapshot.ts";

const out = (): Sample => ({ x: 0, z: 0, yaw: 0 });

describe("SnapshotBuffer", () => {
  it("returns false until a snapshot exists", () => {
    expect(new SnapshotBuffer().sample(100, out())).toBe(false);
  });

  it("interpolates linearly between two snapshots", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0);
    buffer.push(1050, 1, -2, 0);
    const sample = out();
    buffer.sample(1025, sample);
    expect(sample.x).toBeCloseTo(0.5);
    expect(sample.z).toBeCloseTo(-1);
  });

  it("holds a monk that is not walking at its newest snapshot instead of extrapolating", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0);
    buffer.push(1050, 1, 1, 0.4);
    const sample = out();
    buffer.sample(5000, sample);
    expect(sample).toEqual({ x: 1, z: 1, yaw: 0.4 });
  });

  it("extrapolates a walking monk along its heading while the next snapshot is late", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0, true);
    buffer.push(1050, 0, -0.12, 0, true);
    const sample = out();
    buffer.sample(1150, sample);
    expect(sample.x).toBeCloseTo(0, 6);
    expect(sample.z).toBeCloseTo(-0.12 - (WALK_SPEED * 100) / 1000, 6);
  });

  it("follows the yaw convention when extrapolating", () => {
    const buffer = new SnapshotBuffer();
    const yaw = yawFromDirection(1, 1);
    buffer.push(0, -1, -1, yaw, true);
    buffer.push(50, -1, -1, yaw, true);
    const sample = out();
    buffer.sample(150, sample);
    const reach = (WALK_SPEED * 100) / 1000;
    expect(sample.x - -1).toBeCloseTo(reach * Math.SQRT1_2, 6);
    expect(sample.z - -1).toBeCloseTo(reach * Math.SQRT1_2, 6);
  });

  it("stops extrapolating after the cap and stays inside the walkable rect", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, 0, 0, 0, true);
    buffer.push(50, 0, 0, 0, true);
    const a = out();
    const b = out();
    buffer.sample(50 + EXTRAPOLATION_MAX_MS, a);
    buffer.sample(50 + 5000, b);
    expect(b.z).toBeCloseTo(a.z, 9);
    expect(a.z).toBeCloseTo(-(WALK_SPEED * EXTRAPOLATION_MAX_MS) / 1000, 6);

    const wall = new SnapshotBuffer();
    wall.push(0, 0, -3, 0, true);
    wall.push(50, 0, -3, 0, true);
    const against = out();
    wall.sample(200, against);
    expect(against.z).toBe(-3);
  });

  it("does not extrapolate once the newest snapshot says the monk stopped", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, 0, 0, 0, true);
    buffer.push(50, 0, -0.12, 0, false);
    const sample = out();
    buffer.sample(300, sample);
    expect(sample.z).toBeCloseTo(-0.12, 9);
  });

  it("clamps to the oldest snapshot when asked for the past", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 3, 4, 0);
    buffer.push(1050, 5, 6, 0);
    const sample = out();
    buffer.sample(10, sample);
    expect(sample.x).toBe(3);
    expect(sample.z).toBe(4);
  });

  it("interpolates yaw along the short arc across the wrap point", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, 0, 0, Math.PI - 0.1);
    buffer.push(100, 0, 0, -Math.PI + 0.1);
    const sample = out();
    buffer.sample(50, sample);
    expect(Math.abs(Math.abs(sample.yaw) - Math.PI)).toBeLessThan(1e-6);
  });

  it("overwrites a snapshot with the same timestamp and ignores a stale one", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(100, 0, 0, 0);
    buffer.push(100, 9, 9, 0);
    buffer.push(90, 7, 7, 0);
    expect(buffer.length).toBe(1);
    const sample = out();
    buffer.sample(100, sample);
    expect(sample.x).toBe(9);
  });

  it("starts a new timeline when the server clock steps far backwards", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(10_000, 1, 1, 0);
    buffer.push(10_050, 2, 2, 0);
    buffer.push(2_000, 8, 8, 0);
    expect(buffer.length).toBe(1);
    const sample = out();
    buffer.sample(2_000, sample);
    expect(sample.x).toBe(8);
  });

  it("caps its size and discards the past but always keeps two snapshots for velocity", () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 200; i += 1) buffer.push(i * 50, i, 0, 0);
    expect(buffer.length).toBeLessThanOrEqual(40);
    const sample = out();
    buffer.sample(199 * 50 - 25, sample);
    expect(sample.x).toBeCloseTo(198.5);
    expect(buffer.length).toBe(2);
    buffer.sample(199 * 50 + 10_000, sample);
    expect(buffer.length).toBe(2);
  });

  it("keeps every snapshot that is still ahead of the render time", () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 10; i += 1) buffer.push(i * 50, i, 0, 0);
    const sample = out();
    buffer.sample(120, sample);
    expect(sample.x).toBeCloseTo(2.4);
    expect(buffer.length).toBe(8);
    buffer.sample(430, sample);
    expect(sample.x).toBeCloseTo(8.6);
  });
});

describe("ServerClock", () => {
  const S0 = 1_800_000_000_000;

  it("maps server time to the local clock with the best arrival seen in the window", () => {
    const clock = new ServerClock();
    clock.observe(S0, 5000);
    clock.observe(S0 + 50, 5090);
    clock.observe(S0 + 100, 5150);
    expect(clock.advance(5150)).toBeCloseTo(S0 + 150 - clock.delay);
  });

  it("reports server time at a local time only once a sample has been observed", () => {
    const clock = new ServerClock();
    expect(clock.serverNowAt(5000)).toBeNull();
    clock.observe(S0, 5000);
    expect(clock.serverNowAt(5000)).not.toBeNull();
    clock.reset();
    expect(clock.serverNowAt(5000)).toBeNull();
  });

  it("estimates server time as the local time minus the smallest offset seen", () => {
    const clock = new ServerClock();
    clock.observe(S0, 5000);
    clock.observe(S0 + 100, 5080);
    expect(clock.serverNowAt(5300)).toBe(S0 + 320);
    clock.observe(S0 + 200, 5400);
    expect(clock.serverNowAt(5300)).toBe(S0 + 320);
  });

  it("starts at the minimum delay on a steady link and rises with jitter up to the cap", () => {
    const clock = new ServerClock();
    let i = 0;
    const feed = (count: number, extra: (n: number) => number): void => {
      for (const end = i + count; i < end; i += 1) clock.observe(S0 + i * 50, 5000 + i * 50 + extra(i));
    };
    feed(40, () => 0);
    expect(clock.delay).toBe(DELAY_MIN_MS);
    feed(60, (n) => (n % 2) * 100);
    expect(clock.delay).toBeGreaterThan(DELAY_MIN_MS + 50);
    expect(clock.delay).toBeLessThan(DELAY_MAX_MS - 50);
    feed(60, (n) => (n % 2) * 300);
    expect(clock.delay).toBe(DELAY_MAX_MS);
  });

  it("falls back slowly after the network calms down", () => {
    const clock = new ServerClock();
    let t = 5000;
    for (let i = 0; i < 60; i += 1) {
      clock.observe(S0 + i * 50, t + (i % 3 === 0 ? 300 : 0));
      t += 50;
    }
    const jittery = clock.delay;
    expect(jittery).toBeGreaterThan(300);
    for (let i = 60; i < 100; i += 1) {
      clock.observe(S0 + i * 50, t);
      t += 50;
    }
    expect(clock.delay).toBeGreaterThan(jittery * 0.8);
  });

  it("never runs the render clock backwards, even when the delay or offset shifts", () => {
    const clock = new ServerClock();
    const arrivals: Array<{ at: number; t: number }> = [];
    let previousAt = 0;
    for (let i = 0; i < 800; i += 1) {
      const latency = (i >= 200 && i < 400 ? 250 : 0) + (i % 7) * 20;
      previousAt = Math.max(previousAt, 5000 + i * 50 + latency);
      arrivals.push({ at: previousAt, t: S0 + i * 50 });
    }
    let next = 0;
    let previous = Number.NEGATIVE_INFINITY;
    for (let now = 5000; now < 46_000; now += 16.7) {
      while (next < arrivals.length && (arrivals[next] as { at: number }).at <= now) {
        const item = arrivals[next] as { at: number; t: number };
        clock.observe(item.t, item.at);
        next += 1;
      }
      const render = clock.advance(now);
      expect(render).toBeGreaterThan(previous);
      previous = render;
    }
  });

  it("changes pace by a bounded fraction instead of jumping to a new delay", () => {
    const clock = new ServerClock();
    for (let i = 0; i < 40; i += 1) clock.observe(S0 + i * 50, 5000 + i * 50);
    const start = 5000 + 40 * 50;
    let last = clock.advance(start);
    let local = start;
    for (let i = 0; i < 20; i += 1) clock.observe(S0 + (40 + i) * 50, start + i * 50 + (i % 2 === 0 ? 0 : 300));
    for (let i = 0; i < 120; i += 1) {
      local += 16.7;
      const render = clock.advance(local);
      expect(render - last).toBeGreaterThanOrEqual(16.7 * 0.74);
      expect(render - last).toBeLessThanOrEqual(16.7 * 1.11);
      last = render;
    }
  });

  it("resynchronises at once after a long outage or a server clock step", () => {
    const clock = new ServerClock();
    for (let i = 0; i < 40; i += 1) clock.observe(S0 + i * 50, 5000 + i * 50);
    clock.advance(7000);
    clock.observe(S0 - 3_600_000, 7050);
    expect(clock.advance(7060)).toBeCloseTo(S0 - 3_600_000 + 10 - clock.delay, 3);
  });

  it("restarts cleanly after reset", () => {
    const clock = new ServerClock();
    clock.observe(S0, 100);
    clock.advance(100);
    clock.reset();
    clock.observe(500, 9000);
    expect(clock.advance(9000)).toBeCloseTo(500 - DELAY_MIN_MS);
  });
});

describe("RemoteTrack", () => {
  const frame = 1 / 60;

  it("passes interpolated motion through untouched", () => {
    const track = new RemoteTrack();
    for (let i = 0; i < 10; i += 1) track.push(i * 50, i * 0.12, 0, 0, true);
    const sample = out();
    let previous = 0;
    for (let t = 0; t < 400; t += 1000 / 60) {
      track.sample(t, frame, sample);
      expect(sample.x).toBeCloseTo((t / 50) * 0.12, 6);
      expect(sample.x).toBeGreaterThanOrEqual(previous);
      previous = sample.x;
    }
  });

  it("hides a late burst behind a decaying offset instead of jumping", () => {
    const track = new RemoteTrack();
    track.push(0, 0, 0, 0, false);
    track.push(50, 1, 0, 0, false);
    const sample = out();
    track.sample(50, frame, sample);
    track.push(100, 2.2, 0, 0, false);
    track.sample(100, frame, sample);
    const before = 1;
    expect(sample.x - before).toBeLessThan(0.1);
    let last = sample.x;
    let frames = 0;
    while (sample.x < 2.19 && frames < 600) {
      track.sample(100, frame, sample);
      expect(sample.x).toBeGreaterThanOrEqual(last);
      expect(sample.x - last).toBeLessThanOrEqual(3 * WALK_SPEED * frame + 1e-9);
      last = sample.x;
      frames += 1;
    }
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(120);
  });

  it("eases back after a wrong extrapolation rather than snapping", () => {
    const track = new RemoteTrack();
    track.push(0, 0, 0, 0, true);
    track.push(50, 0, -0.12, 0, true);
    const sample = out();
    track.sample(50 + EXTRAPOLATION_MAX_MS, frame, sample);
    const ahead = sample.z;
    expect(ahead).toBeLessThan(-0.4);
    track.push(100, 0, -0.14, 0, false);
    track.sample(50 + EXTRAPOLATION_MAX_MS, frame, sample);
    expect(Math.abs(sample.z - ahead)).toBeLessThan(0.05);
    for (let i = 0; i < 240; i += 1) track.sample(50 + EXTRAPOLATION_MAX_MS, frame, sample);
    expect(sample.z).toBeCloseTo(-0.14, 2);
  });

  it("places a monk exactly on its first sample", () => {
    const track = new RemoteTrack();
    track.push(0, 3, -2, 0, false);
    track.push(50, 3, -2, 0, false);
    const sample = out();
    track.sample(0, frame, sample);
    expect(sample.x).toBe(3);
    expect(sample.z).toBe(-2);
  });

  it("glides over a mid-life jump of any size instead of teleporting", () => {
    for (const jump of [4, 7, 9]) {
      const track = new RemoteTrack();
      track.push(0, 0, 0, 0, false);
      track.push(50, 0, 0, 0, false);
      const sample = out();
      track.sample(0, frame, sample);
      track.sample(50, frame, sample);
      track.push(100, jump, 0, 0, false);
      let last = sample.x;
      let frames = 0;
      let reached = -1;
      while (frames < 600 && reached < 0) {
        track.sample(100, frame, sample);
        const step = sample.x - last;
        expect(step, `jump ${jump} frame ${frames}`).toBeGreaterThanOrEqual(0);
        expect(step, `jump ${jump} frame ${frames}`).toBeLessThanOrEqual(3 * WALK_SPEED * frame + 1e-9);
        if (jump - sample.x < 0.1) reached = frames;
        last = sample.x;
        frames += 1;
      }
      expect(reached, `jump ${jump}`).toBeGreaterThan(0);
      expect(reached / 60, `jump ${jump}`).toBeLessThan(2.5);
    }
  });

  it("keeps the offset on one side of zero while it closes", () => {
    const track = new RemoteTrack();
    track.push(0, 0, 0, 0, false);
    track.push(50, 0, 0, 0, false);
    const sample = out();
    track.sample(50, frame, sample);
    track.push(100, 6, 0, 0, false);
    for (let i = 0; i < 400; i += 1) {
      track.sample(100, frame, sample);
      expect(sample.x).toBeLessThanOrEqual(6 + 1e-9);
    }
    expect(sample.x).toBeCloseTo(6, 3);
  });
});

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

interface Run {
  xs: number[];
  steps: number[];
}

// Server state every 50 ms, delivered in order through a link with up to 300 ms of jitter and occasional stalls;
// an optional long stall holds back everything sent during it and delivers it as one burst.
function simulateWalk(seed: number, stall?: { atMs: number; ms: number }): Run {
  const random = seededRandom(seed);
  const S0 = 1_800_000_000_000;
  const L0 = 20_000;
  const WARM_MS = 8000;
  const WALK_MS = 4000;
  const END_MS = WARM_MS + WALK_MS + 2000;
  const START_X = -4.9;
  const yaw = yawFromDirection(1, 0);

  const arrivals: Array<{ at: number; t: number; x: number; walking: boolean }> = [];
  let lastArrival = 0;
  for (let ms = 0; ms <= END_MS; ms += 50) {
    const walked = Math.min(Math.max(ms - WARM_MS, 0), WALK_MS);
    const walking = ms >= WARM_MS && ms < WARM_MS + WALK_MS;
    let delay = 40 + 300 * random() ** 3;
    if (random() < 1 / 100) delay = 250 + 50 * random();
    if (stall && ms >= stall.atMs && ms < stall.atMs + stall.ms) delay += stall.atMs + stall.ms - ms;
    lastArrival = Math.max(lastArrival, L0 + ms + delay);
    arrivals.push({ at: lastArrival, t: S0 + ms, x: START_X + (WALK_SPEED * walked) / 1000, walking });
  }

  const clock = new ServerClock();
  const track = new RemoteTrack();
  const sample = out();
  const xs: number[] = [];
  const steps: number[] = [];
  let next = 0;
  const frameMs = 1000 / 60;
  for (let now = L0; now <= L0 + END_MS + 600; now += frameMs) {
    while (next < arrivals.length && (arrivals[next] as (typeof arrivals)[number]).at <= now) {
      const item = arrivals[next] as (typeof arrivals)[number];
      clock.observe(item.t, item.at);
      track.push(item.t, item.x, 0, yaw, item.walking);
      next += 1;
    }
    if (!track.sample(clock.advance(now), 1 / 60, sample)) continue;
    xs.push(sample.x);
  }
  for (let i = 1; i < xs.length; i += 1) steps.push((xs[i] as number) - (xs[i - 1] as number));
  return { xs, steps };
}

describe("remote motion under a jittery link", () => {
  it("never steps backwards, never leaps, and never freezes for long mid-walk", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { xs, steps } = simulateWalk(seed);
      let longestFreeze = 0;
      let freeze = 0;
      let moving = 0;
      steps.forEach((step, index) => {
        const x = xs[index + 1] as number;
        const midWalk = x > -4.85 && x < 4.6;
        if (!midWalk) {
          freeze = 0;
          return;
        }
        moving += 1;
        expect(step, `seed ${seed} frame ${index}`).toBeGreaterThanOrEqual(-1e-9);
        expect(step, `seed ${seed} frame ${index}`).toBeLessThanOrEqual(0.07);
        freeze = step < 1e-4 ? freeze + 1 : 0;
        longestFreeze = Math.max(longestFreeze, freeze);
      });
      expect(moving, `seed ${seed}`).toBeGreaterThan(150);
      expect(longestFreeze, `seed ${seed} freeze`).toBeLessThanOrEqual(2);
      expect(xs[xs.length - 1], `seed ${seed} end`).toBeCloseTo(4.7, 1);
    }
  });
});

describe("remote motion after a long stall", () => {
  const WARM_MS = 8000;
  const STEP_BOUND = (3 * WALK_SPEED) / 60 + 1e-9;

  for (const stallMs of [2500, 3500]) {
    it(`absorbs a ${stallMs} ms freeze without a teleport, a backward step or a lost destination`, () => {
      for (let seed = 1; seed <= 12; seed += 1) {
        const { xs, steps } = simulateWalk(seed, { atMs: WARM_MS + 300, ms: stallMs });
        let largest = 0;
        steps.forEach((step, index) => {
          const x = xs[index + 1] as number;
          largest = Math.max(largest, Math.abs(step));
          expect(Math.abs(step), `seed ${seed} stall ${stallMs} frame ${index}`).toBeLessThanOrEqual(STEP_BOUND);
          if (x > -4.85 && x < 4.6) expect(step, `seed ${seed} stall ${stallMs} frame ${index}`).toBeGreaterThanOrEqual(-1e-9);
        });
        expect(largest, `seed ${seed}`).toBeGreaterThan((WALK_SPEED * 1.25) / 60);
        expect(xs[xs.length - 1], `seed ${seed} end`).toBeCloseTo(4.7, 1);
      }
    });
  }
});
