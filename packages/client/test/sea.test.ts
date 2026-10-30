import { ARRIVAL, DHARMA_SEATS, SEA_LINE_X, SHORE, WORLD_BOUNDS, zoneAt } from "@dongjane/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, SEA_FOLLOW_SECONDS, SEA_PEAK_GAIN } from "../src/audio/engine.ts";
import { SEA_FADE_METRES, SEA_FULL_METRES, seaLevel } from "../src/audio/sea-level.ts";

describe("seaLevel", () => {
  it("is full at the waterline and anywhere within a few metres of it", () => {
    expect(seaLevel(SEA_LINE_X, 6)).toBe(1);
    expect(seaLevel(SEA_LINE_X - SEA_FULL_METRES, 6)).toBe(1);
    expect(seaLevel(SEA_LINE_X - SEA_FULL_METRES + 0.5, 6)).toBe(1);
  });

  it("fades with distance and is gone by the far edge of the fade", () => {
    expect(seaLevel(SEA_LINE_X - SEA_FADE_METRES, 6)).toBe(0);
    expect(seaLevel(SEA_LINE_X - SEA_FADE_METRES - 10, 6)).toBe(0);
    const middle = seaLevel(SEA_LINE_X - (SEA_FULL_METRES + SEA_FADE_METRES) / 2, 6);
    expect(middle).toBeGreaterThan(0.3);
    expect(middle).toBeLessThan(0.7);
  });

  it("never gets louder as the monk walks away from the water", () => {
    let last = 2;
    for (let away = 0; away <= SEA_FADE_METRES + 5; away += 0.25) {
      const level = seaLevel(SEA_LINE_X - away, 6);
      expect(level).toBeLessThanOrEqual(last);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
      last = level;
    }
  });

  it("is clear from the plaza's east edge, faint at its middle, and gone at its west edge", () => {
    expect(seaLevel(WORLD_BOUNDS.maxX, 6)).toBeGreaterThan(0.5);
    expect(seaLevel(SHORE.minX, 6)).toBeGreaterThan(0.5);
    expect(seaLevel(0, 6)).toBeGreaterThan(0);
    expect(seaLevel(0, 6)).toBeLessThan(0.5);
    expect(seaLevel(WORLD_BOUNDS.minX, 6)).toBe(0);
  });

  it("is zero inside the 법당, wherever the walker is in it", () => {
    expect(zoneAt(ARRIVAL.x, ARRIVAL.z)).toBe("dharma");
    expect(seaLevel(ARRIVAL.x, ARRIVAL.z)).toBe(0);
    for (const seat of DHARMA_SEATS) expect(seaLevel(seat.x, seat.z)).toBe(0);
  });

  it("depends on where the monk stands along the shore only through the distance to the water", () => {
    expect(seaLevel(SEA_LINE_X - 10, 0)).toBe(seaLevel(SEA_LINE_X - 10, 14));
  });

  it("treats a point in the water as full, and a broken position as silence", () => {
    expect(seaLevel(SEA_LINE_X + 3, 6)).toBe(1);
    expect(seaLevel(Number.NaN, 6)).toBe(0);
    expect(seaLevel(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

class FakeParam {
  value = 0;
  readonly targets: { value: number; tau: number }[] = [];
  cancelled = 0;
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  setTargetAtTime(value: number, _at: number, tau: number): this {
    this.targets.push({ value, tau });
    return this;
  }
  cancelScheduledValues(): this {
    this.cancelled += 1;
    return this;
  }
}

class FakeNode {
  type = "";
  loop = false;
  buffer: unknown = null;
  started = false;
  readonly outputs: unknown[] = [];
  readonly frequency = new FakeParam();
  readonly gain = new FakeParam();
  readonly Q = new FakeParam();
  constructor(readonly kind: string) {}
  connect<T>(next: T): T {
    this.outputs.push(next);
    return next;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {}
}

let nodes: FakeNode[] = [];

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode("destination");
  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    nodes.push(node);
    return node;
  }
  createGain = () => this.make("gain");
  createOscillator = () => this.make("oscillator");
  createBufferSource = () => this.make("bufferSource");
  createBiquadFilter = () => this.make("filter");
  createBuffer = (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) });
  decodeAudioData = () => Promise.reject(new Error("no samples in tests"));
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
  addEventListener = () => undefined;
}

// The surf is the looping noise that feeds both a lowpass (the rumble) and a highpass (the foam); the wind has only a lowpass.
function surfSource(): FakeNode | undefined {
  return nodes.find((node) => node.kind === "bufferSource" && node.loop && node.outputs.length === 2);
}

function reachableFrom(from: FakeNode): FakeNode[] {
  const seen = new Set<FakeNode>();
  const queue = [from];
  for (let node = queue.pop(); node; node = queue.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    for (const out of node.outputs) if (out instanceof FakeNode) queue.push(out);
  }
  return [...seen];
}

describe("the sea's sound", () => {
  beforeEach(() => {
    nodes = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const surf = (engine: AudioEngine) => {
    engine.unlock();
    const source = surfSource();
    if (!source) throw new Error("no sea in the audio graph");
    const ambience = nodes.filter((node) => node.kind === "gain")[1] as FakeNode;
    const seaGain = reachableFrom(source).find((node) => node.kind === "gain" && node.outputs.includes(ambience));
    if (!seaGain) throw new Error("no sea gain");
    const [low, high] = source.outputs as FakeNode[];
    return { source, low: low as FakeNode, high: high as FakeNode, ambience, seaGain };
  };

  it("builds a looping surf of noise: a lowpass rumble and a highpass hiss into one gain on the ambience bus", () => {
    const { source, low, high, ambience, seaGain } = surf(new AudioEngine());
    expect(source.loop).toBe(true);
    expect(source.started).toBe(true);
    expect(low.type).toBe("lowpass");
    expect(high.type).toBe("highpass");
    expect(high.frequency.value).toBeGreaterThan(low.frequency.value);
    expect(reachableFrom(low)).toContain(seaGain);
    expect(reachableFrom(high)).toContain(seaGain);
    expect(seaGain.outputs).toEqual([ambience]);
  });

  it("is silent until the monk is near the water", () => {
    const { seaGain } = surf(new AudioEngine());
    expect(seaGain.gain.value).toBe(0);
  });

  it("follows the level up to its peak and back down smoothly, not in a jump", () => {
    const engine = new AudioEngine();
    const { seaGain } = surf(engine);
    engine.setSeaLevel(1);
    engine.setSeaLevel(0.5);
    engine.setSeaLevel(0);
    expect(seaGain.gain.targets.map((step) => step.value)).toEqual([SEA_PEAK_GAIN, SEA_PEAK_GAIN * 0.5, 0]);
    for (const step of seaGain.gain.targets) expect(step.tau).toBeCloseTo(SEA_FOLLOW_SECONDS);
  });

  it("clamps the level to 0..1 and reads a broken one as silence", () => {
    const engine = new AudioEngine();
    const { seaGain } = surf(engine);
    engine.setSeaLevel(7);
    engine.setSeaLevel(Number.NaN);
    engine.setSeaLevel(-3);
    expect(seaGain.gain.targets.map((step) => step.value)).toEqual([SEA_PEAK_GAIN, 0]);
  });

  it("does not reschedule the gain for a change nobody could hear", () => {
    const engine = new AudioEngine();
    const { seaGain } = surf(engine);
    engine.setSeaLevel(0.8);
    engine.setSeaLevel(0.8);
    engine.setSeaLevel(0.8005);
    expect(seaGain.gain.targets).toHaveLength(1);
  });

  it("starts at the level asked for before audio was unlocked", () => {
    const engine = new AudioEngine();
    expect(() => engine.setSeaLevel(1)).not.toThrow();
    const { seaGain } = surf(engine);
    expect(seaGain.gain.value).toBeCloseTo(SEA_PEAK_GAIN);
  });

  it("makes no sound and does not throw without an AudioContext", () => {
    vi.stubGlobal("AudioContext", undefined);
    const engine = new AudioEngine();
    expect(() => {
      engine.setSeaLevel(1);
      engine.unlock();
      engine.setSeaLevel(0);
    }).not.toThrow();
    expect(nodes).toHaveLength(0);
  });
});
