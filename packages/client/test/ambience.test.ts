import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BED_SPECS } from "../src/audio/beds.ts";
import { DROP_AUDIBLE_LEVEL, DROP_TICK_MS, type DropProfile, FIRE_DROPS, RAIN_DROPS, WATER_DROPS } from "../src/audio/drops.ts";
import { AudioEngine } from "../src/audio/engine.ts";
import { type Ambience, BEDS, type Bed, SILENCE } from "../src/audio/soundscape.ts";
import { FakeAudioContext, type FakeNode, ambienceBus, bedGains, droplets, graph, resetGraph } from "./fake-audio.ts";

// Pinned so that retuning a bed is a deliberate edit.
const TUNING: Readonly<Record<Bed, { peak: number; follow: number }>> = {
  wind: { peak: 0.55, follow: 0.4 },
  sea: { peak: 0.6, follow: 0.35 },
  rain: { peak: 0.15, follow: 0.4 },
  fire: { peak: 0.2, follow: 0.4 },
  water: { peak: 0.25, follow: 0.4 },
};

const DROP_BEDS: Readonly<Partial<Record<Bed, DropProfile>>> = { rain: RAIN_DROPS, fire: FIRE_DROPS, water: WATER_DROPS };

const only = (bed: Bed, level: number): Ambience => ({ ...SILENCE, [bed]: level });

describe("the engine's ambient beds", () => {
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

  const unlocked = () => {
    const engine = new AudioEngine();
    engine.unlock();
    return { engine, gains: bedGains() };
  };

  const advance = (seconds: number) => {
    const ticks = Math.round((seconds * 1000) / DROP_TICK_MS);
    for (let i = 0; i < ticks; i += 1) {
      if (graph.context) graph.context.currentTime += DROP_TICK_MS / 1000;
      vi.advanceTimersByTime(DROP_TICK_MS);
    }
  };

  it("keeps the loudest and the pace of every bed where the mix was tuned", () => {
    for (const bed of BEDS) {
      expect(BED_SPECS[bed].peak, bed).toBe(TUNING[bed].peak);
      expect(BED_SPECS[bed].follow, bed).toBe(TUNING[bed].follow);
    }
  });

  it("puts one gain per bed on the ambience bus, each silent when the audio starts", () => {
    const { gains } = unlocked();
    const bus = ambienceBus();
    for (const bed of BEDS) {
      expect(gains[bed].outputs, bed).toHaveLength(1);
      expect(gains[bed].outputs[0], bed).toBe(bus);
      expect(gains[bed].gain.value, bed).toBe(0);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts every looping body once, and no drop yet", () => {
    unlocked();
    const loops = graph.nodes.filter((node) => node.kind === "bufferSource" && node.loop);
    expect(loops).toHaveLength(4);
    for (const loop of loops) expect(loop.started).toHaveLength(1);
    expect(droplets()).toHaveLength(0);
  });

  it("brings each bed to its own peak at its own pace, and back down", () => {
    for (const bed of BEDS) {
      resetGraph();
      const { engine, gains } = unlocked();
      engine.setAmbience(only(bed, 1));
      engine.setAmbience(only(bed, 0));
      expect(gains[bed].gain.targets, bed).toEqual([
        { value: TUNING[bed].peak, tau: TUNING[bed].follow },
        { value: 0, tau: TUNING[bed].follow },
      ]);
      for (const other of BEDS.filter((name) => name !== bed)) expect(gains[other].gain.targets, `${bed} moved ${other}`).toHaveLength(0);
      engine.dispose();
    }
  });

  it("moves each bed on its own, so the rain and the fire can be heard together", () => {
    const { engine, gains } = unlocked();
    engine.setAmbience({ ...SILENCE, rain: 1, fire: 1, wind: 0.4 });
    engine.setAmbience({ ...SILENCE, rain: 0, fire: 1, wind: 0.4 });
    expect(gains.rain.gain.targets.map((step) => step.value)).toEqual([TUNING.rain.peak, 0]);
    expect(gains.fire.gain.targets.map((step) => step.value)).toEqual([TUNING.fire.peak]);
    expect(gains.wind.gain.targets.map((step) => step.value)).toEqual([TUNING.wind.peak * 0.4]);
  });

  it("clamps every level to 0..1 and reads a broken one as silence", () => {
    for (const bed of BEDS) {
      resetGraph();
      const { engine, gains } = unlocked();
      engine.setAmbience(only(bed, 7));
      engine.setAmbience(only(bed, Number.NaN));
      engine.setAmbience(only(bed, -3));
      expect(gains[bed].gain.targets.map((step) => step.value), bed).toEqual([TUNING[bed].peak, 0]);
      engine.dispose();
    }
  });

  it("does not reschedule a gain for a change nobody could hear", () => {
    const { engine, gains } = unlocked();
    engine.setAmbience(SILENCE);
    engine.setAmbience(only("wind", 0.8));
    engine.setAmbience(only("wind", 0.8005));
    expect(gains.wind.gain.targets).toHaveLength(1);
    for (const bed of BEDS.filter((name) => name !== "wind")) expect(gains[bed].gain.cancelled, bed).toBe(0);
  });

  it("starts the beds at the levels asked for before audio was unlocked", () => {
    const engine = new AudioEngine();
    expect(() => engine.setAmbience({ ...SILENCE, wind: 0.5, fire: 1 })).not.toThrow();
    engine.unlock();
    const gains = bedGains();
    expect(gains.wind.gain.value).toBeCloseTo(TUNING.wind.peak * 0.5);
    expect(gains.fire.gain.value).toBeCloseTo(TUNING.fire.peak);
    for (const bed of ["sea", "rain", "water"] as const) expect(gains[bed].gain.value, bed).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("builds the beds once, however often the audio is unlocked", () => {
    const engine = new AudioEngine();
    engine.unlock();
    engine.unlock();
    expect(Object.keys(bedGains())).toHaveLength(BEDS.length);
    expect(graph.nodes.filter((node) => node.kind === "bufferSource" && node.loop)).toHaveLength(4);
  });

  it("runs a drop timer only for a drop bed that is loud enough to hear", () => {
    const { engine } = unlocked();
    engine.setAmbience({ ...SILENCE, wind: 1, sea: 1 });
    expect(vi.getTimerCount()).toBe(0);
    engine.setAmbience({ ...SILENCE, rain: DROP_AUDIBLE_LEVEL / 2 });
    expect(vi.getTimerCount()).toBe(0);
    engine.setAmbience({ ...SILENCE, rain: 1 });
    expect(vi.getTimerCount()).toBe(1);
    engine.setAmbience({ ...SILENCE, rain: 1, fire: 1 });
    expect(vi.getTimerCount()).toBe(2);
    engine.setAmbience({ ...SILENCE, rain: 1, fire: 1, water: 1, wind: 1 });
    expect(vi.getTimerCount()).toBe(3);
    engine.setAmbience({ ...SILENCE, fire: 1 });
    expect(vi.getTimerCount()).toBe(1);
    engine.setAmbience(SILENCE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets each drop bed's drops fall into its own gain, with its own pitch, ring and strength", () => {
    for (const [name, profile] of Object.entries(DROP_BEDS) as [Bed, DropProfile][]) {
      resetGraph();
      const { engine, gains } = unlocked();
      engine.setAmbience(only(name, 1));
      advance(60);
      const drops = droplets();
      expect(drops.length, name).toBeGreaterThan(5);
      for (const drop of drops) {
        const [band] = drop.outputs as FakeNode[];
        const [envelope] = (band as FakeNode).outputs as FakeNode[];
        expect(band?.type, name).toBe("bandpass");
        expect(band?.frequency.value, name).toBeGreaterThanOrEqual(profile.minHz - 1e-6);
        expect(band?.frequency.value, name).toBeLessThanOrEqual(profile.maxHz + 1e-6);
        expect(band?.Q.value, name).toBe(profile.q);
        expect(envelope?.outputs, name).toHaveLength(1);
        expect(envelope?.outputs[0], name).toBe(gains[name]);
        const [peak] = envelope?.gain.ramps ?? [];
        expect(peak, name).toBeGreaterThanOrEqual(profile.minPeak - 1e-6);
        expect(peak, name).toBeLessThanOrEqual(profile.maxPeak + 1e-6);
        const [at, offset, length] = drop.started[0] ?? [];
        expect(at, name).toBeGreaterThan(0);
        expect(offset, name).toBeGreaterThanOrEqual(0);
        expect((offset ?? 0) + (length ?? 0), name).toBeLessThanOrEqual(1 + 1e-9);
        expect(length, name).toBeCloseTo(profile.seconds + 0.01, 6);
      }
      engine.dispose();
    }
  });

  it("makes the fire crackle about ten times a second and the water drip about every other second", () => {
    const fire = unlocked();
    fire.engine.setAmbience(only("fire", 1));
    advance(200);
    const crackles = droplets().length / 200;
    expect(crackles).toBeGreaterThan(8);
    expect(crackles).toBeLessThan(12);
    fire.engine.dispose();

    resetGraph();
    const bath = unlocked();
    bath.engine.setAmbience(only("water", 1));
    advance(1200);
    const drips = droplets().length / 1200;
    expect(drips).toBeGreaterThan(0.45);
    expect(drips).toBeLessThan(0.65);
    bath.engine.dispose();
  });

  it("lets nothing drop from a bed with no drops", () => {
    const { engine } = unlocked();
    engine.setAmbience({ ...SILENCE, wind: 1, sea: 1 });
    advance(120);
    expect(droplets()).toHaveLength(0);
  });

  it("stops every timer and forgets every level when disposed, so the next start is silent", () => {
    const first = unlocked();
    first.engine.setAmbience({ ...SILENCE, rain: 1, fire: 1, water: 1, wind: 1 });
    expect(vi.getTimerCount()).toBe(3);
    first.engine.dispose();
    expect(vi.getTimerCount()).toBe(0);

    resetGraph();
    first.engine.unlock();
    for (const bed of BEDS) expect(bedGains()[bed].gain.value, bed).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets nothing fall after it is disposed, whatever the levels asked for", () => {
    const { engine } = unlocked();
    engine.dispose();
    expect(() => {
      engine.setAmbience({ ...SILENCE, rain: 1, fire: 1, water: 1 });
      advance(10);
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(droplets()).toHaveLength(0);
  });

  it("makes no sound and keeps no timer without an AudioContext", () => {
    vi.stubGlobal("AudioContext", undefined);
    const engine = new AudioEngine();
    expect(() => {
      engine.setAmbience({ ...SILENCE, rain: 1, fire: 1, water: 1, wind: 1, sea: 1 });
      engine.unlock();
      engine.setAmbience(SILENCE);
      engine.dispose();
    }).not.toThrow();
    expect(graph.nodes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
