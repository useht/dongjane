import { FISH, NO_FISH } from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { CatchWatcher } from "../src/game/catch-watch.ts";
import { catchMessage, modeLabel } from "../src/ui/format.ts";

describe("CatchWatcher", () => {
  it("reports nothing on the first look, whatever the counter says", () => {
    const watcher = new CatchWatcher();
    expect(watcher.observe({ catchSeq: 7, lastCatch: 2, bite: true })).toEqual({ caught: null, bitten: false });
    expect(watcher.observe({ catchSeq: 7, lastCatch: 2, bite: true })).toEqual({ caught: null, bitten: false });
  });

  it("reports a fish once when the counter moves", () => {
    const watcher = new CatchWatcher();
    watcher.observe({ catchSeq: 0, lastCatch: NO_FISH, bite: false });
    expect(watcher.observe({ catchSeq: 1, lastCatch: 3, bite: false })).toEqual({ caught: 3, bitten: false });
    expect(watcher.observe({ catchSeq: 1, lastCatch: 3, bite: false })).toEqual({ caught: null, bitten: false });
  });

  it("reports the empty hook as a catch of no fish, so a missed bite is told too", () => {
    const watcher = new CatchWatcher();
    watcher.observe({ catchSeq: 4, lastCatch: 1, bite: false });
    expect(watcher.observe({ catchSeq: 5, lastCatch: NO_FISH, bite: false }).caught).toBe(NO_FISH);
  });

  it("reports a bite when it starts and not again while it lasts", () => {
    const watcher = new CatchWatcher();
    watcher.observe({ catchSeq: 0, lastCatch: NO_FISH, bite: false });
    expect(watcher.observe({ catchSeq: 0, lastCatch: NO_FISH, bite: true }).bitten).toBe(true);
    expect(watcher.observe({ catchSeq: 0, lastCatch: NO_FISH, bite: true }).bitten).toBe(false);
    expect(watcher.observe({ catchSeq: 1, lastCatch: 2, bite: false })).toEqual({ caught: 2, bitten: false });
    expect(watcher.observe({ catchSeq: 1, lastCatch: 2, bite: true }).bitten).toBe(true);
  });

  it("starts over after a reset, as when the visitor enters another world", () => {
    const watcher = new CatchWatcher();
    watcher.observe({ catchSeq: 3, lastCatch: 1, bite: false });
    watcher.reset();
    expect(watcher.observe({ catchSeq: 0, lastCatch: NO_FISH, bite: false })).toEqual({ caught: null, bitten: false });
  });
});

describe("the fishing words", () => {
  it("names every fish with the object particle its last sound asks for", () => {
    expect(catchMessage(1)).toBe("고등어를 낚았어요!");
    expect(catchMessage(2)).toBe("농어를 낚았어요!");
    expect(catchMessage(3)).toBe("우럭을 낚았어요!");
    expect(catchMessage(4)).toBe("숭어를 낚았어요!");
    for (const fish of FISH) expect(catchMessage(fish.id)).toContain(fish.name);
  });

  it("tells an empty hook, and an unknown fish, as nothing caught", () => {
    expect(catchMessage(NO_FISH)).toBe("아무것도 잡지 못했어요");
    expect(catchMessage(99)).toBe("아무것도 잡지 못했어요");
  });

  it("calls a visitor who has a line out fishing", () => {
    expect(modeLabel("fish", -1, "gatbawi")).toBe("낚시하는 중");
  });
});
