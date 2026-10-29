import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChantBellScheduler } from "../src/audio/chant-bell.ts";
import { AudioEngine, BELL_FUNDAMENTAL_HZ, BELL_PARTIALS, MOKT_SAMPLE_GAIN, MOKT_SAMPLE_URL } from "../src/audio/engine.ts";

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
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  setTargetAtTime(): this {
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  type = "";
  loop = false;
  buffer: unknown = null;
  target: FakeNode | null = null;
  readonly frequency = new FakeParam();
  readonly gain = new FakeParam();
  readonly Q = new FakeParam();
  constructor(readonly kind: string) {}
  connect(next: FakeNode): FakeNode {
    this.target = next;
    return next;
  }
  start(): void {}
  stop(): void {}
}

const decoded = { duration: 0.6 };
let nodes: FakeNode[] = [];
let decode: () => Promise<unknown>;

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
  createOscillator = () => {
    const node = this.make("oscillator");
    node.type = "sine";
    return node;
  };
  createBufferSource = () => this.make("bufferSource");
  createBiquadFilter = () => this.make("filter");
  createBuffer = (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) });
  decodeAudioData = () => decode();
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
  addEventListener = () => undefined;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const wooden = () => nodes.filter((node) => node.kind === "bufferSource" && node.buffer === decoded);
const synthesized = () => nodes.filter((node) => node.kind === "oscillator" && node.type === "triangle");

function serve(response: { ok: boolean; status?: number }) {
  const fetched = vi.fn(async () => ({ ...response, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

describe("knock sound", () => {
  beforeEach(() => {
    nodes = [];
    decode = async () => decoded;
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays the recorded strike at the given gain once it has decoded", async () => {
    const fetched = serve({ ok: true });
    const engine = new AudioEngine();
    engine.unlock();
    await settle();
    engine.knock(0.5);
    engine.knock();
    const [quiet, full] = wooden();
    expect(wooden()).toHaveLength(2);
    expect(quiet?.target?.gain.value).toBeCloseTo(MOKT_SAMPLE_GAIN * 0.5);
    expect(full?.target?.gain.value).toBeCloseTo(MOKT_SAMPLE_GAIN);
    expect(quiet?.target?.target?.kind).toBe("gain");
    expect(synthesized()).toHaveLength(0);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched).toHaveBeenCalledWith(MOKT_SAMPLE_URL);
  });

  it("falls back to the synthesized knock when the file is missing, without fetching again", async () => {
    const fetched = serve({ ok: false, status: 404 });
    const engine = new AudioEngine();
    engine.unlock();
    await settle();
    engine.knock();
    engine.knock(0.5);
    expect(wooden()).toHaveLength(0);
    expect(synthesized()).toHaveLength(2);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("falls back to the synthesized knock when decoding fails", async () => {
    serve({ ok: true });
    decode = () => Promise.reject(new Error("bad data"));
    const engine = new AudioEngine();
    engine.unlock();
    await settle();
    expect(() => engine.knock()).not.toThrow();
    expect(wooden()).toHaveLength(0);
    expect(synthesized()).toHaveLength(1);
  });

  it("falls back to the synthesized knock when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const engine = new AudioEngine();
    engine.unlock();
    await settle();
    expect(() => engine.knock()).not.toThrow();
    expect(synthesized()).toHaveLength(1);
  });

  it("uses the synthesized knock until the first load finishes, then the recording", async () => {
    serve({ ok: true });
    const engine = new AudioEngine();
    engine.unlock();
    engine.knock();
    expect(synthesized()).toHaveLength(1);
    await settle();
    engine.knock();
    expect(wooden()).toHaveLength(1);
    expect(synthesized()).toHaveLength(1);
  });

  it("makes no sound and fetches nothing before audio is unlocked", async () => {
    const fetched = serve({ ok: true });
    const engine = new AudioEngine();
    engine.knock();
    await settle();
    expect(nodes).toHaveLength(0);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("stays silent below the audible gain", async () => {
    serve({ ok: true });
    const engine = new AudioEngine();
    engine.unlock();
    await settle();
    engine.knock(0);
    expect(wooden()).toHaveLength(0);
    expect(synthesized()).toHaveLength(0);
  });

  it("does nothing, and does not throw, without an AudioContext", async () => {
    const fetched = serve({ ok: true });
    vi.stubGlobal("AudioContext", undefined);
    const engine = new AudioEngine();
    expect(() => {
      engine.unlock();
      engine.knock();
    }).not.toThrow();
    await settle();
    expect(fetched).not.toHaveBeenCalled();
  });
});
