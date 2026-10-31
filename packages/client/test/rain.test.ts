import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BED_SPECS } from "../src/audio/beds.ts";
import {
  DROP_AHEAD_SECONDS,
  DROP_AUDIBLE_LEVEL,
  DROP_TICK_MS,
  DropPlanner,
  RAIN_DROPS,
  RAIN_DROP_MAX_HZ,
  RAIN_DROP_MAX_PEAK,
  RAIN_DROP_MEAN_GAP_SECONDS,
  RAIN_DROP_MIN_GAP_SECONDS,
  RAIN_DROP_MIN_HZ,
  RAIN_DROP_MIN_PEAK,
  RAIN_DROP_SECONDS,
  dropGap,
  makeDrop,
} from "../src/audio/drops.ts";
import { AudioEngine } from "../src/audio/engine.ts";
import { SILENCE } from "../src/audio/soundscape.ts";
import { FakeAudioContext, FakeNode, droplets, graph, reachableFrom, resetGraph } from "./fake-audio.ts";

// A small deterministic generator (mulberry32), so the statistics below are the same on every run.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("dropGap", () => {
  it("averages the mean gap and never runs closer than the minimum", () => {
    const random = seeded(7);
    let total = 0;
    let shortest = Number.POSITIVE_INFINITY;
    const count = 40_000;
    for (let i = 0; i < count; i += 1) {
      const gap = dropGap(random, RAIN_DROPS);
      total += gap;
      shortest = Math.min(shortest, gap);
    }
    expect(total / count).toBeGreaterThan(RAIN_DROP_MEAN_GAP_SECONDS * 0.97);
    expect(total / count).toBeLessThan(RAIN_DROP_MEAN_GAP_SECONDS * 1.03);
    expect(shortest).toBeGreaterThanOrEqual(RAIN_DROP_MIN_GAP_SECONDS);
  });

  it("is random, not a metronome: short and long gaps both come up", () => {
    const random = seeded(11);
    const gaps = Array.from({ length: 2000 }, () => dropGap(random, RAIN_DROPS));
    expect(Math.min(...gaps)).toBeLessThan(RAIN_DROP_MEAN_GAP_SECONDS / 4);
    expect(Math.max(...gaps)).toBeGreaterThan(RAIN_DROP_MEAN_GAP_SECONDS * 2.5);
  });

  it("stays finite at both ends of the random source", () => {
    expect(dropGap(() => 0, RAIN_DROPS)).toBeCloseTo(RAIN_DROP_MIN_GAP_SECONDS);
    expect(Number.isFinite(dropGap(() => 1, RAIN_DROPS))).toBe(true);
  });
});

describe("makeDrop", () => {
  it("falls at the given time with a pitch, a strength and a place in the noise inside their ranges", () => {
    const random = seeded(3);
    for (let i = 0; i < 500; i += 1) {
      const drop = makeDrop(12.5, random, RAIN_DROPS);
      expect(drop.at).toBe(12.5);
      expect(drop.hz).toBeGreaterThanOrEqual(RAIN_DROP_MIN_HZ);
      expect(drop.hz).toBeLessThanOrEqual(RAIN_DROP_MAX_HZ);
      expect(drop.peak).toBeGreaterThanOrEqual(RAIN_DROP_MIN_PEAK);
      expect(drop.peak).toBeLessThanOrEqual(RAIN_DROP_MAX_PEAK);
      expect(drop.from).toBeGreaterThanOrEqual(0);
      expect(drop.from).toBeLessThan(1);
    }
  });

  it("reaches both ends of the pitch and strength ranges", () => {
    const low = makeDrop(0, () => 0, RAIN_DROPS);
    const high = makeDrop(0, () => 1, RAIN_DROPS);
    expect(low.hz).toBeCloseTo(RAIN_DROP_MIN_HZ);
    expect(high.hz).toBeCloseTo(RAIN_DROP_MAX_HZ);
    expect(low.peak).toBeCloseTo(RAIN_DROP_MIN_PEAK);
    expect(high.peak).toBeCloseTo(RAIN_DROP_MAX_PEAK);
  });
});

describe("DropPlanner", () => {
  const tick = DROP_TICK_MS / 1000;

  it("hands out each drop once, in order, and never one that is already past", () => {
    const planner = new DropPlanner(RAIN_DROPS);
    const random = seeded(5);
    const seen: number[] = [];
    for (let now = 0; now < 600; now += tick) {
      for (const drop of planner.plan(now, random)) {
        expect(drop.at).toBeGreaterThanOrEqual(now);
        expect(drop.at).toBeLessThan(now + DROP_AHEAD_SECONDS);
        seen.push(drop.at);
      }
    }
    expect(seen.length).toBeGreaterThan(100);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual((seen[i - 1] ?? 0) + RAIN_DROP_MIN_GAP_SECONDS - 1e-9);
    }
  });

  it("falls at about three-quarters of a drop a second", () => {
    const planner = new DropPlanner(RAIN_DROPS);
    const random = seeded(9);
    let count = 0;
    const seconds = 2000;
    for (let now = 0; now < seconds; now += tick) count += planner.plan(now, random).length;
    const perSecond = count / seconds;
    expect(perSecond).toBeGreaterThan(0.65);
    expect(perSecond).toBeLessThan(0.85);
  });

  it("starts afresh after a stall instead of dropping the backlog at once", () => {
    const planner = new DropPlanner(RAIN_DROPS);
    const random = seeded(2);
    planner.plan(0, random);
    const late = planner.plan(300, random);
    expect(late.length).toBeLessThanOrEqual(3);
    for (const drop of late) expect(drop.at).toBeGreaterThanOrEqual(300);
  });

  it("starts afresh when the clock is rewound", () => {
    const planner = new DropPlanner(RAIN_DROPS);
    const random = seeded(4);
    planner.plan(500, random);
    const early = planner.plan(10, random);
    for (const drop of early) expect(drop.at).toBeGreaterThanOrEqual(10);
    expect(early.length).toBeLessThanOrEqual(3);
  });
});

describe("the rain's sound", () => {
  beforeEach(() => {
    resetGraph();
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The rain bed is the looping noise whose hiss branch is a bandpass; the sea's is a lowpass and a highpass, the wind's a lowpass.
  const rain = (engine: AudioEngine) => {
    engine.unlock();
    const source = graph.nodes.find(
      (node) => node.kind === "bufferSource" && node.loop && (node.outputs as FakeNode[]).some((out) => out.type === "bandpass"),
    );
    if (!source) throw new Error("no rain in the audio graph");
    const ambience = graph.nodes.filter((node) => node.kind === "gain")[1] as FakeNode;
    const rainGain = reachableFrom(source).find((node) => node.kind === "gain" && node.outputs.includes(ambience));
    if (!rainGain) throw new Error("no rain gain");
    const [hiss, body] = source.outputs as FakeNode[];
    return { source, hiss: hiss as FakeNode, body: body as FakeNode, ambience, rainGain };
  };

  const raining = (level: number) => ({ ...SILENCE, rain: level });
  const peak = BED_SPECS.rain.peak;

  const advance = (seconds: number) => {
    const ticks = Math.round((seconds * 1000) / DROP_TICK_MS);
    for (let i = 0; i < ticks; i += 1) {
      if (graph.context) graph.context.currentTime += DROP_TICK_MS / 1000;
      vi.advanceTimersByTime(DROP_TICK_MS);
    }
  };

  it("builds a looping noise bed: a bandpass hiss and a lowpass body into one gain on the ambience bus", () => {
    const { source, hiss, body, ambience, rainGain } = rain(new AudioEngine());
    expect(source.loop).toBe(true);
    expect(source.started).toHaveLength(1);
    expect(source.buffer?.length).toBe(8 * 44100);
    expect(hiss.type).toBe("bandpass");
    expect(hiss.frequency.value).toBe(3000);
    expect(hiss.Q.value).toBe(0.6);
    expect(body.type).toBe("lowpass");
    expect(body.frequency.value).toBe(600);
    expect(reachableFrom(hiss)).toContain(rainGain);
    expect(reachableFrom(body)).toContain(rainGain);
    expect(rainGain.outputs).toEqual([ambience]);
  });

  it("is silent until it rains outdoors", () => {
    const { rainGain } = rain(new AudioEngine());
    expect(rainGain.gain.value).toBe(0);
  });

  it("follows the level up to its peak and back down smoothly, not in a jump", () => {
    const engine = new AudioEngine();
    const { rainGain } = rain(engine);
    engine.setAmbience(raining(1));
    engine.setAmbience(raining(0.5));
    engine.setAmbience(raining(0));
    expect(rainGain.gain.targets.map((step) => step.value)).toEqual([peak, peak * 0.5, 0]);
    for (const step of rainGain.gain.targets) expect(step.tau).toBeCloseTo(BED_SPECS.rain.follow);
  });

  it("clamps the level to 0..1 and reads a broken one as silence", () => {
    const engine = new AudioEngine();
    const { rainGain } = rain(engine);
    engine.setAmbience(raining(7));
    engine.setAmbience(raining(Number.NaN));
    engine.setAmbience(raining(-3));
    expect(rainGain.gain.targets.map((step) => step.value)).toEqual([peak, 0]);
  });

  it("does not reschedule the gain for a change nobody could hear", () => {
    const engine = new AudioEngine();
    const { rainGain } = rain(engine);
    engine.setAmbience(raining(0.8));
    engine.setAmbience(raining(0.8));
    engine.setAmbience(raining(0.8005));
    expect(rainGain.gain.targets).toHaveLength(1);
  });

  it("starts at the level asked for before audio was unlocked", () => {
    const engine = new AudioEngine();
    expect(() => engine.setAmbience(raining(1))).not.toThrow();
    const { rainGain } = rain(engine);
    expect(rainGain.gain.value).toBeCloseTo(peak);
  });

  it("follows only its own level, not the other beds'", () => {
    const engine = new AudioEngine();
    const { rainGain } = rain(engine);
    engine.setAmbience({ ...SILENCE, wind: 1, sea: 1, fire: 1, water: 1 });
    expect(rainGain.gain.targets).toHaveLength(0);
    engine.setAmbience({ ...SILENCE, wind: 0, rain: 1 });
    expect(rainGain.gain.targets.map((step) => step.value)).toEqual([peak]);
  });

  it("lets single drops fall over the bed at about three-quarters of a drop a second", () => {
    const engine = new AudioEngine();
    const { rainGain } = rain(engine);
    engine.setAmbience(raining(1));
    const seconds = 600;
    advance(seconds);
    const drops = droplets();
    expect(drops.length / seconds).toBeGreaterThan(0.6);
    expect(drops.length / seconds).toBeLessThan(0.9);
    for (const drop of drops) {
      const [band] = drop.outputs as FakeNode[];
      const [envelope] = (band as FakeNode).outputs as FakeNode[];
      expect(band?.type).toBe("bandpass");
      expect(band?.frequency.value).toBeGreaterThanOrEqual(RAIN_DROP_MIN_HZ);
      expect(band?.frequency.value).toBeLessThanOrEqual(RAIN_DROP_MAX_HZ);
      expect(envelope?.outputs).toEqual([rainGain]);
      const [dropPeak] = envelope?.gain.ramps ?? [];
      expect(dropPeak).toBeGreaterThanOrEqual(RAIN_DROP_MIN_PEAK);
      expect(dropPeak).toBeLessThanOrEqual(RAIN_DROP_MAX_PEAK);
      const [at, offset, length] = drop.started[0] ?? [];
      expect(at).toBeGreaterThan(0);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect((offset ?? 0) + (length ?? 0)).toBeLessThanOrEqual(1 + 1e-9);
      expect(length).toBeGreaterThan(RAIN_DROP_SECONDS);
    }
  });

  it("lets no drop fall while the rain is too faint to hear, and resumes when it returns", () => {
    const engine = new AudioEngine();
    rain(engine);
    advance(60);
    expect(droplets()).toHaveLength(0);
    engine.setAmbience(raining(DROP_AUDIBLE_LEVEL / 2));
    advance(60);
    expect(droplets()).toHaveLength(0);
    engine.setAmbience(raining(0.3));
    advance(60);
    const falling = droplets().length;
    expect(falling).toBeGreaterThan(20);
    engine.setAmbience(raining(0));
    advance(60);
    expect(droplets()).toHaveLength(falling);
  });

  it("does not drop the backlog of a quiet spell on the monk walking out into the rain", () => {
    const engine = new AudioEngine();
    rain(engine);
    advance(300);
    engine.setAmbience(raining(1));
    advance(DROP_TICK_MS / 1000);
    expect(droplets().length).toBeLessThanOrEqual(3);
  });

  it("keeps no timer while it is silent, runs one while it rains, and stops it when disposed", () => {
    const engine = new AudioEngine();
    rain(engine);
    expect(vi.getTimerCount()).toBe(0);
    engine.setAmbience(raining(1));
    expect(vi.getTimerCount()).toBe(1);
    engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => {
      engine.setAmbience(raining(1));
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
    expect(droplets()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes no sound and does not throw without an AudioContext", () => {
    vi.stubGlobal("AudioContext", undefined);
    const engine = new AudioEngine();
    expect(() => {
      engine.setAmbience(raining(1));
      engine.unlock();
      engine.setAmbience(raining(0));
      engine.dispose();
    }).not.toThrow();
    expect(graph.nodes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
