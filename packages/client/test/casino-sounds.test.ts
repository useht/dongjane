import { describe, expect, it } from "vitest";
import { CasinoSounds, TICK_GAP_SECONDS } from "../src/audio/casino.ts";

interface Param {
  value: number;
  setValueAtTime: () => void;
  linearRampToValueAtTime: () => void;
  exponentialRampToValueAtTime: () => void;
}

function param(): Param {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
}

function chain<T extends object>(node: T): T & { connect: (next: unknown) => unknown } {
  return Object.assign(node, { connect: (next: unknown) => next });
}

function fakeContext(state = "running") {
  const started: string[] = [];
  const decoded: ArrayBuffer[] = [];
  const ctx = {
    state,
    currentTime: 1,
    started,
    decoded,
    createGain: () => chain({ gain: param() }),
    createOscillator: () =>
      chain({ type: "sine", frequency: param(), start: () => started.push("oscillator"), stop() {} }),
    createBufferSource: () => chain({ buffer: null as unknown, start: () => started.push("buffer") }),
    decodeAudioData: async (bytes: ArrayBuffer) => {
      decoded.push(bytes);
      return { duration: 1 } as AudioBuffer;
    },
  };
  return ctx;
}

const URLS = { coin: "/coin.mp3", click: "/click.mp3", jackpot: "/jackpot.mp3" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CasinoSounds", () => {
  it("does nothing, and does not throw, before the audio engine has a context", () => {
    const sounds = new CasinoSounds({ context: null, effectsOutput: null }, URLS, async () => new ArrayBuffer(1));
    expect(() => {
      sounds.prepare();
      sounds.click();
      sounds.coin();
      sounds.jackpot();
      sounds.tick();
      sounds.stop();
    }).not.toThrow();
  });

  it("does nothing while the context is suspended", () => {
    const ctx = fakeContext("suspended");
    const sounds = new CasinoSounds({ context: ctx as unknown as AudioContext, effectsOutput: {} as AudioNode }, URLS, async () => new ArrayBuffer(1));
    sounds.tick();
    sounds.stop();
    expect(ctx.started).toEqual([]);
  });

  it("fetches and decodes each recording once per context", async () => {
    const ctx = fakeContext();
    const fetched: string[] = [];
    const sounds = new CasinoSounds({ context: ctx as unknown as AudioContext, effectsOutput: {} as AudioNode }, URLS, async (url) => {
      fetched.push(url);
      return new ArrayBuffer(8);
    });
    sounds.prepare();
    sounds.prepare();
    await settle();
    expect(fetched.sort()).toEqual(["/click.mp3", "/coin.mp3", "/jackpot.mp3"]);
    expect(ctx.decoded).toHaveLength(3);
  });

  it("plays a recording once it has loaded, and not before", async () => {
    const ctx = fakeContext();
    const sounds = new CasinoSounds({ context: ctx as unknown as AudioContext, effectsOutput: {} as AudioNode }, URLS, async () => new ArrayBuffer(8));
    sounds.click();
    expect(ctx.started).toEqual([]);
    sounds.prepare();
    await settle();
    sounds.click();
    sounds.coin();
    sounds.jackpot();
    expect(ctx.started).toEqual(["buffer", "buffer", "buffer"]);
  });

  it("stays silent, without breaking the game, when a recording cannot be loaded", async () => {
    const ctx = fakeContext();
    const sounds = new CasinoSounds({ context: ctx as unknown as AudioContext, effectsOutput: {} as AudioNode }, URLS, async () => {
      throw new Error("offline");
    });
    sounds.prepare();
    await settle();
    sounds.coin();
    sounds.stop();
    expect(ctx.started).toEqual(["oscillator"]);
  });

  it("thins the reels' ticks out and plays a stop whenever asked", () => {
    const ctx = fakeContext();
    const sounds = new CasinoSounds({ context: ctx as unknown as AudioContext, effectsOutput: {} as AudioNode }, URLS, async () => new ArrayBuffer(1));
    sounds.tick();
    sounds.tick();
    ctx.currentTime += TICK_GAP_SECONDS / 2;
    sounds.tick();
    expect(ctx.started).toEqual(["oscillator"]);
    ctx.currentTime += TICK_GAP_SECONDS;
    sounds.tick();
    expect(ctx.started).toEqual(["oscillator", "oscillator"]);
    sounds.stop();
    sounds.stop();
    expect(ctx.started).toHaveLength(4);
  });

  it("starts over when the engine gets a new context", async () => {
    const first = fakeContext();
    const host = { context: first as unknown as AudioContext, effectsOutput: {} as AudioNode };
    const sounds = new CasinoSounds(host, URLS, async () => new ArrayBuffer(8));
    sounds.prepare();
    await settle();
    sounds.coin();
    expect(first.started).toEqual(["buffer"]);
    const second = fakeContext();
    host.context = second as unknown as AudioContext;
    sounds.coin();
    expect(second.started).toEqual([]);
    sounds.prepare();
    await settle();
    sounds.coin();
    expect(second.started).toEqual(["buffer"]);
  });
});
