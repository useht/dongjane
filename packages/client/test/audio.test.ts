import { afterEach, describe, expect, it } from "vitest";
import { ChantBellScheduler } from "../src/audio/chant-bell.ts";
import { AudioEngine, BELL_FUNDAMENTAL_HZ, BELL_PARTIALS, CHANT_DRONE_HZ, CHANT_LEVEL } from "../src/audio/engine.ts";

const chant = { startsAt: 1_000_000, durationMs: 180_000 };

describe("ChantBellScheduler", () => {
  it("rings once when the start was seen coming", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt - 60_000);
    expect(bell.shouldRing(chant, chant.startsAt - 1)).toBe(false);
    expect(bell.shouldRing(chant, chant.startsAt + 200)).toBe(true);
    expect(bell.shouldRing(chant, chant.startsAt + 400)).toBe(false);
  });

  it("stays quiet for someone who arrives mid-chant", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt + 60_000);
    expect(bell.shouldRing(chant, chant.startsAt + 60_000)).toBe(false);
  });

  it("rings for someone who joins in the first seconds", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt + 1_500);
    expect(bell.shouldRing(chant, chant.startsAt + 1_500)).toBe(true);
  });

  it("does not ring late after a long stall", () => {
    const bell = new ChantBellScheduler();
    bell.observe(chant, chant.startsAt - 5_000);
    expect(bell.shouldRing(chant, chant.startsAt + 30_000)).toBe(false);
  });

  it("rings again for the next chant", () => {
    const bell = new ChantBellScheduler();
    const next = { startsAt: chant.startsAt + 1_800_000, durationMs: 180_000 };
    bell.observe(chant, chant.startsAt - 1000);
    expect(bell.shouldRing(chant, chant.startsAt + 100)).toBe(true);
    bell.observe(next, chant.startsAt + 200_000);
    expect(bell.shouldRing(next, next.startsAt + 100)).toBe(true);
  });

  it("ignores an empty chant", () => {
    const bell = new ChantBellScheduler();
    bell.observe({ startsAt: 0, durationMs: 0 }, 5);
    expect(bell.shouldRing({ startsAt: 0, durationMs: 0 }, 5)).toBe(false);
  });
});

describe("bell recipe", () => {
  it("has a low fundamental with shorter-lived higher partials", () => {
    expect(BELL_FUNDAMENTAL_HZ).toBeLessThan(300);
    for (let i = 1; i < BELL_PARTIALS.length; i += 1) {
      const previous = BELL_PARTIALS[i - 1];
      const current = BELL_PARTIALS[i];
      expect(current?.decay).toBeLessThan(previous?.decay ?? 0);
      expect(current?.ratio).toBeGreaterThan(previous?.ratio ?? 0);
      expect(current?.gain).toBeLessThan(previous?.gain ?? 0);
    }
  });
});

class FakeParam {
  value = 0;
  targets: number[] = [];
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
  setTargetAtTime(target: number): this {
    this.targets.push(target);
    return this;
  }
}

class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  started = 0;
  stopped = 0;
  disconnected = false;
  onended: (() => void) | null = null;
  Q = new FakeParam();
  constructor(readonly kind: string) {}
  connect<T>(node: T): T {
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(): void {
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
}

class FakeContext {
  static made: FakeContext[] = [];
  readonly nodes: FakeNode[] = [];
  readonly destination = {};
  readonly sampleRate = 44100;
  currentTime = 0;
  state = "running";
  closed = false;
  constructor() {
    FakeContext.made.push(this);
  }
  private node(kind: string): FakeNode {
    const node = new FakeNode(kind);
    this.nodes.push(node);
    return node;
  }
  createGain = () => this.node("gain");
  createOscillator = () => this.node("osc");
  createBiquadFilter = () => this.node("filter");
  createBufferSource = () => this.node("buffer");
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  resume = async () => undefined;
  close = async () => {
    this.closed = true;
  };
  oscillators(): FakeNode[] {
    return this.nodes.filter((node) => node.kind === "osc");
  }
}

describe("chant drone", () => {
  const scope = globalThis as unknown as { AudioContext?: unknown };
  const original = scope.AudioContext;
  afterEach(() => {
    scope.AudioContext = original;
    FakeContext.made = [];
  });

  function engine(): { audio: AudioEngine; ctx: () => FakeContext } {
    scope.AudioContext = FakeContext;
    const audio = new AudioEngine();
    audio.unlock();
    return { audio, ctx: () => FakeContext.made[0] as FakeContext };
  }

  it("is a quiet low fifth", () => {
    expect(CHANT_LEVEL).toBeLessThan(0.2);
    expect(CHANT_DRONE_HZ[0]).toBeLessThan(300);
    expect(CHANT_DRONE_HZ[1]).toBeGreaterThan(CHANT_DRONE_HZ[0] * 1.4);
  });

  it("starts once and stops idempotently", () => {
    const { audio, ctx } = engine();
    const base = ctx().oscillators().length;
    audio.startChant();
    audio.startChant();
    expect(audio.chanting).toBe(true);
    const voices = ctx().oscillators().slice(base);
    expect(voices).toHaveLength(1 + CHANT_DRONE_HZ.length);
    audio.stopChant();
    audio.stopChant();
    expect(audio.chanting).toBe(false);
    expect(voices.every((node) => node.stopped === 1)).toBe(true);
  });

  it("can start again after stopping", () => {
    const { audio, ctx } = engine();
    const base = ctx().oscillators().length;
    audio.startChant();
    audio.stopChant();
    audio.startChant();
    expect(ctx().oscillators().length - base).toBe(2 * (1 + CHANT_DRONE_HZ.length));
  });

  it("waits for the first unlock when asked early", () => {
    scope.AudioContext = FakeContext;
    const audio = new AudioEngine();
    audio.startChant();
    expect(audio.chanting).toBe(true);
    expect(FakeContext.made).toHaveLength(0);
    audio.unlock();
    const ctx = FakeContext.made[0] as FakeContext;
    const drone = ctx.oscillators().filter((node) => CHANT_DRONE_HZ.includes(node.frequency.value));
    expect(drone).toHaveLength(CHANT_DRONE_HZ.length);
  });

  it("does not build a voice when a stop arrives before the unlock", () => {
    scope.AudioContext = FakeContext;
    const audio = new AudioEngine();
    audio.startChant();
    audio.stopChant();
    audio.unlock();
    const ctx = FakeContext.made[0] as FakeContext;
    expect(ctx.oscillators().some((node) => CHANT_DRONE_HZ.includes(node.frequency.value))).toBe(false);
  });

  it("is cleaned up by dispose", () => {
    const { audio, ctx } = engine();
    audio.startChant();
    audio.dispose();
    expect(audio.chanting).toBe(false);
    expect(ctx().closed).toBe(true);
    expect(() => audio.stopChant()).not.toThrow();
  });
});
