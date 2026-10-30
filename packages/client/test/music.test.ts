import { afterEach, describe, expect, it, vi } from "vitest";
import { DHARMA_BOUNDS, DHARMA_ORIGIN } from "@dongjane/shared";
import { DHARMA, DHARMA_DOOR } from "../src/game/dharma-layout.ts";
import {
  DEEP_METRES,
  DRIFT_GLIDE_SECONDS,
  DRIFT_STILL_SECONDS,
  GLIDE_RATE,
  OUTSIDE_METRES,
  QUIET_PAUSE_MS,
  SEEK_LOOKAHEAD_SECONDS,
  SUTRA_LEVEL,
  SUTRA_SECONDS,
  SyncedLoop,
  aimAhead,
  areaMix,
  driftAction,
  loopPosition,
} from "../src/audio/music.ts";

describe("loopPosition", () => {
  it("is the same place of the loop for everyone who reads the same server time", () => {
    expect(loopPosition(1_700_000_000_000, SUTRA_SECONDS)).toBe(loopPosition(1_700_000_000_000, SUTRA_SECONDS));
  });

  it("wraps around the length of the loop", () => {
    expect(loopPosition(0, 100)).toBe(0);
    expect(loopPosition(30_000, 100)).toBeCloseTo(30, 9);
    expect(loopPosition(130_000, 100)).toBeCloseTo(30, 9);
    expect(loopPosition(100_000, 100)).toBeCloseTo(0, 9);
  });

  it("moves one second per second and stays inside the loop", () => {
    for (let ms = 0; ms < 1_000_000; ms += 137_321) {
      const here = loopPosition(ms, SUTRA_SECONDS);
      expect(here).toBeGreaterThanOrEqual(0);
      expect(here).toBeLessThan(SUTRA_SECONDS);
      const later = loopPosition(ms + 2_500, SUTRA_SECONDS);
      expect((later - here + SUTRA_SECONDS) % SUTRA_SECONDS).toBeCloseTo(2.5, 6);
    }
  });

  it("answers 0 when there is nothing sensible to answer", () => {
    expect(loopPosition(5_000, 0)).toBe(0);
    expect(loopPosition(5_000, Number.NaN)).toBe(0);
    expect(loopPosition(Number.NaN, 100)).toBe(0);
    expect(loopPosition(5_000, -3)).toBe(0);
  });

  it("copes with a clock before the epoch", () => {
    expect(loopPosition(-30_000, 100)).toBeCloseTo(70, 9);
  });
});

describe("aimAhead", () => {
  it("aims a little past the loop's place and wraps at its end", () => {
    expect(aimAhead(10, 100)).toBeCloseTo(10 + SEEK_LOOKAHEAD_SECONDS, 9);
    expect(aimAhead(99.9, 100)).toBeCloseTo(SEEK_LOOKAHEAD_SECONDS - 0.1, 9);
  });
});

describe("driftAction", () => {
  const target = 50;

  it("leaves a recording within 0.08 s alone, on either side", () => {
    expect(driftAction(target, target, SUTRA_SECONDS)).toEqual({ kind: "hold" });
    expect(driftAction(target + DRIFT_STILL_SECONDS, target, SUTRA_SECONDS)).toEqual({ kind: "hold" });
    expect(driftAction(target - DRIFT_STILL_SECONDS, target, SUTRA_SECONDS)).toEqual({ kind: "hold" });
  });

  it("plays slower when ahead and faster when behind, up to one second off", () => {
    expect(driftAction(target + 0.09, target, SUTRA_SECONDS)).toEqual({ kind: "glide", rate: 1 - GLIDE_RATE });
    expect(driftAction(target + DRIFT_GLIDE_SECONDS, target, SUTRA_SECONDS)).toEqual({ kind: "glide", rate: 1 - GLIDE_RATE });
    expect(driftAction(target - 0.09, target, SUTRA_SECONDS)).toEqual({ kind: "glide", rate: 1 + GLIDE_RATE });
    expect(driftAction(target - DRIFT_GLIDE_SECONDS, target, SUTRA_SECONDS)).toEqual({ kind: "glide", rate: 1 + GLIDE_RATE });
  });

  it("jumps to the loop's place when more than a second off", () => {
    expect(driftAction(target + 1.01, target, SUTRA_SECONDS)).toEqual({ kind: "seek", to: target });
    expect(driftAction(target - 30, target, SUTRA_SECONDS)).toEqual({ kind: "seek", to: target });
  });

  it("measures drift across the seam of the loop, not through it", () => {
    expect(driftAction(SUTRA_SECONDS - 0.02, 0.03, SUTRA_SECONDS)).toEqual({ kind: "hold" });
    expect(driftAction(SUTRA_SECONDS - 0.5, 0.2, SUTRA_SECONDS)).toEqual({ kind: "glide", rate: 1 + GLIDE_RATE });
    expect(driftAction(0.5, SUTRA_SECONDS - 0.2, SUTRA_SECONDS)).toEqual({ kind: "glide", rate: 1 - GLIDE_RATE });
  });

  it("holds when there is nothing sensible to compare", () => {
    expect(driftAction(Number.NaN, 10, SUTRA_SECONDS)).toEqual({ kind: "hold" });
    expect(driftAction(10, 20, 0)).toEqual({ kind: "hold" });
  });
});

describe("areaMix", () => {
  const doorX = DHARMA_ORIGIN.x;
  const doorZ = DHARMA_ORIGIN.z + DHARMA.frontZ;

  it("is half and half in the doorway", () => {
    expect(areaMix(doorX, doorZ)).toBeCloseTo(0.5, 9);
  });

  it("is the chant alone from three metres inside, wherever across the room", () => {
    expect(areaMix(doorX, doorZ - DEEP_METRES)).toBe(1);
    expect(areaMix(doorX, DHARMA_ORIGIN.z)).toBe(1);
    expect(areaMix(DHARMA_BOUNDS.minX + 1, DHARMA_ORIGIN.z)).toBe(1);
  });

  it("is the concert alone from six metres outside the door", () => {
    expect(areaMix(doorX, doorZ + OUTSIDE_METRES)).toBe(0);
    expect(areaMix(doorX, doorZ + OUTSIDE_METRES + 4)).toBe(0);
    expect(areaMix(0, 14)).toBe(0);
  });

  it("falls steadily from the doorway to six metres out, and rises steadily to three metres in", () => {
    let last = areaMix(doorX, doorZ);
    for (let step = 1; step <= 12; step += 1) {
      const next = areaMix(doorX, doorZ + step * 0.5);
      expect(next).toBeLessThanOrEqual(last);
      last = next;
    }
    last = areaMix(doorX, doorZ);
    for (let step = 1; step <= 12; step += 1) {
      const next = areaMix(doorX, doorZ - step * 0.25);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });

  it("does not jump where the room meets the court", () => {
    expect(Math.abs(areaMix(doorX, doorZ - 0.001) - areaMix(doorX, doorZ + 0.001))).toBeLessThan(0.01);
  });

  it("counts the court beside the door and the plaza as outdoors", () => {
    expect(areaMix(doorX - DHARMA_DOOR.halfWidth - 5, doorZ + 1)).toBeLessThan(0.1);
    expect(areaMix(-6, 0)).toBe(0);
  });

  it("stays between 0 and 1 and answers 0 for nonsense", () => {
    for (let x = -32; x <= 14; x += 2.3) {
      for (let z = -12; z <= 18; z += 1.7) {
        const mix = areaMix(x, z);
        expect(mix).toBeGreaterThanOrEqual(0);
        expect(mix).toBeLessThanOrEqual(1);
      }
    }
    expect(areaMix(Number.NaN, 3)).toBe(0);
  });
});

interface FakeAudio {
  loop: boolean;
  preload: string;
  paused: boolean;
  currentTime: number;
  playbackRate: number;
  preservesPitch: boolean;
  seeking: boolean;
  readyState: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  addEventListener: (name: string, fn: () => void) => void;
  fire: (name: string) => void;
}

function fakeAudio(refuse: boolean): FakeAudio {
  const listeners = new Map<string, () => void>();
  const audio: FakeAudio = {
    loop: false,
    preload: "",
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    seeking: false,
    readyState: 4,
    play: vi.fn(async () => {
      if (refuse) throw new Error("NotAllowedError");
      audio.paused = false;
    }),
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    addEventListener: (name, fn) => void listeners.set(name, fn),
    fire: (name) => listeners.get(name)?.(),
  };
  return audio;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

function rig(refuse = false) {
  let clock = 0;
  let server = 1_000_000;
  const targets: number[] = [];
  const param = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn((value: number) => void targets.push(value)),
  };
  const node = { gain: param, connect: (next: unknown) => next };
  const ctx = { currentTime: 0, createGain: () => node, createMediaElementSource: () => ({ connect: () => node }) };
  const listeners: Array<() => void> = [];
  const engine = { context: ctx, output: {}, unlocked: true, onUnlock: (fn: () => void) => void listeners.push(fn) };
  const audio = fakeAudio(refuse);
  const loop = new SyncedLoop(engine as never, () => server, "sutra.mp3", { now: () => clock, createAudio: () => audio as never });
  return {
    loop,
    audio,
    engine,
    gesture: () => listeners.forEach((fn) => fn()),
    advance(ms: number) {
      clock += ms;
      server += ms;
    },
    place: () => loopPosition(server, SUTRA_SECONDS),
    lastTarget: () => targets[targets.length - 1],
  };
}

describe("SyncedLoop", () => {
  let current: ReturnType<typeof rig> | null = null;
  const start = (refuse = false) => {
    current = rig(refuse);
    return current;
  };
  afterEach(() => {
    current?.loop.dispose();
    current = null;
  });

  it("does nothing before the first gesture", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    await flush();
    expect(t.audio.play).not.toHaveBeenCalled();
    expect(t.loop.playing).toBe(false);
  });

  it("starts at the server's place in the loop, a little ahead, on the first gesture", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    expect(t.audio.loop).toBe(true);
    expect(t.audio.play).toHaveBeenCalledTimes(1);
    expect(t.audio.currentTime).toBeCloseTo(aimAhead(t.place(), SUTRA_SECONDS), 6);
    expect(t.loop.playing).toBe(true);
    expect(t.lastTarget()).toBeCloseTo(SUTRA_LEVEL, 6);
  });

  it("is started by the gesture even when nobody is in the world yet, then stops", async () => {
    const t = start();
    t.gesture();
    await flush();
    expect(t.audio.play).toHaveBeenCalledTimes(1);
    expect(t.loop.playing).toBe(false);
  });

  it("follows the mix with its loudness", async () => {
    const t = start();
    t.loop.setActive(true);
    t.gesture();
    await flush();
    t.loop.setMix(0.5);
    expect(t.lastTarget()).toBeCloseTo(0.5 * SUTRA_LEVEL, 6);
    t.loop.setMix(0);
    expect(t.lastTarget()).toBe(0);
  });

  it("keeps running quietly for twenty seconds, then stops, and is put back in place when wanted again", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    t.loop.setMix(0);
    t.advance(QUIET_PAUSE_MS - 1000);
    t.loop.tick();
    expect(t.loop.playing).toBe(true);
    t.advance(1000);
    t.loop.tick();
    expect(t.loop.playing).toBe(false);
    t.advance(90_000);
    t.loop.setMix(0.3);
    await flush();
    expect(t.loop.playing).toBe(true);
    expect(t.audio.currentTime).toBeCloseTo(aimAhead(t.place(), SUTRA_SECONDS), 6);
  });

  it("keeps playing for as long as someone is in earshot, held to the server's place in the loop", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    for (let second = 0; second < 30; second += 2) {
      t.advance(2000);
      t.audio.currentTime = t.place();
      t.loop.tick();
    }
    expect(t.loop.playing).toBe(true);
    expect(t.lastTarget()).toBeCloseTo(SUTRA_LEVEL, 6);
    expect(t.audio.pause).not.toHaveBeenCalled();
    expect(t.audio.play).toHaveBeenCalledTimes(1);
    expect(t.audio.currentTime).toBeCloseTo(t.place(), 6);
    expect(t.audio.playbackRate).toBe(1);
    t.audio.currentTime = (t.place() + 40) % SUTRA_SECONDS;
    t.loop.tick();
    expect(t.audio.currentTime).toBeCloseTo(aimAhead(t.place(), SUTRA_SECONDS), 6);
    expect(t.loop.playing).toBe(true);
  });

  it("stops when the visitor leaves the world", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    t.loop.setActive(false);
    expect(t.loop.playing).toBe(false);
  });

  it("walks off a small drift by changing speed, and a big one by jumping", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    t.audio.currentTime = t.place() + 0.4;
    t.loop.tick();
    expect(t.audio.playbackRate).toBeCloseTo(1 - GLIDE_RATE, 9);
    expect(t.audio.preservesPitch).toBe(true);
    t.audio.currentTime = t.place() - 0.4;
    t.loop.tick();
    expect(t.audio.playbackRate).toBeCloseTo(1 + GLIDE_RATE, 9);
    t.audio.currentTime = t.place() + 0.02;
    t.loop.tick();
    expect(t.audio.playbackRate).toBe(1);
    t.audio.currentTime = (t.place() + 40) % SUTRA_SECONDS;
    t.loop.tick();
    expect(t.audio.currentTime).toBeCloseTo(aimAhead(t.place(), SUTRA_SECONDS), 6);
    expect(t.audio.playbackRate).toBe(1);
  });

  it("does not judge drift while the element is seeking or short of data", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    t.audio.currentTime = (t.place() + 40) % SUTRA_SECONDS;
    const before = t.audio.currentTime;
    t.audio.readyState = 1;
    t.loop.tick();
    t.audio.readyState = 4;
    t.audio.seeking = true;
    t.loop.tick();
    expect(t.audio.currentTime).toBe(before);
  });

  it("aligns again when the file's length becomes known", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    t.advance(7000);
    t.audio.fire("loadedmetadata");
    expect(t.audio.currentTime).toBeCloseTo(aimAhead(t.place(), SUTRA_SECONDS), 6);
  });

  it("starts once the context runs, when the first play came before it was running", async () => {
    const t = start();
    t.engine.unlocked = false;
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    expect(t.loop.playing).toBe(false);
    t.engine.unlocked = true;
    t.gesture();
    await flush();
    expect(t.loop.playing).toBe(true);
  });

  it("starts again after an interruption has halted it, once the context runs again", async () => {
    const t = start();
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    t.engine.unlocked = false;
    t.loop.tick();
    expect(t.loop.playing).toBe(false);
    t.engine.unlocked = true;
    t.gesture();
    await flush();
    expect(t.loop.playing).toBe(true);
    expect(t.audio.play).toHaveBeenCalledTimes(2);
  });

  it("does not keep knocking when the browser refuses to play", async () => {
    const t = start(true);
    t.loop.setActive(true);
    t.loop.setMix(1);
    t.gesture();
    await flush();
    await flush();
    expect(t.audio.play).toHaveBeenCalledTimes(1);
    expect(t.loop.playing).toBe(false);
  });
});
