import { afterEach, describe, expect, it, vi } from "vitest";
import { BOW_TITLES, earnedTitles, gainedBows, homeTitleName, nextTitle, titlesCrossed } from "../src/collection/titles.ts";
import { loadBows, saveBows } from "../src/storage.ts";

const ids = (titles: readonly { id: string }[]): string[] => titles.map((title) => title.id);

describe("BOW_TITLES", () => {
  it("is ordered by ascending bow count with unique ids", () => {
    const bows = BOW_TITLES.map((title) => title.bows);
    expect(bows).toEqual([...bows].sort((a, b) => a - b));
    expect(new Set(bows).size).toBe(bows.length);
    expect(new Set(ids(BOW_TITLES)).size).toBe(BOW_TITLES.length);
  });
});

describe("gainedBows", () => {
  it("treats the first observation of a session as a baseline", () => {
    expect(gainedBows(null, 0)).toBe(0);
    expect(gainedBows(null, 7)).toBe(0);
  });

  it("credits the increase since the last observation", () => {
    expect(gainedBows(3, 4)).toBe(1);
    expect(gainedBows(3, 3)).toBe(0);
    expect(gainedBows(0, 5)).toBe(5);
  });

  it("credits nothing when the monk was reset to a lower count", () => {
    expect(gainedBows(12, 0)).toBe(0);
    expect(gainedBows(12, 11)).toBe(0);
  });
});

describe("earnedTitles", () => {
  it("earns nothing before the first bow", () => {
    expect(earnedTitles(0)).toEqual([]);
  });

  it("counts a threshold as earned when reached exactly", () => {
    expect(ids(earnedTitles(1))).toEqual(["bow-1"]);
    expect(ids(earnedTitles(9))).toEqual(["bow-1"]);
    expect(ids(earnedTitles(10))).toEqual(["bow-1", "bow-10"]);
  });

  it("earns every title past the last threshold", () => {
    expect(earnedTitles(1_000_000)).toEqual([...BOW_TITLES]);
  });
});

describe("homeTitleName", () => {
  it("is null until the first title is earned", () => {
    expect(homeTitleName(0)).toBeNull();
  });

  it("names the highest title earned so far", () => {
    expect(homeTitleName(1)).toBe("초발심");
    expect(homeTitleName(9)).toBe("초발심");
    expect(homeTitleName(10)).toBe("정진하는 동자");
    expect(homeTitleName(107)).toBe("꾸준한 동자");
    expect(homeTitleName(1_000_000)).toBe("만배 법사");
  });
});

describe("nextTitle", () => {
  it("points at the first title still out of reach", () => {
    expect(nextTitle(0)?.id).toBe("bow-1");
    expect(nextTitle(1)?.id).toBe("bow-10");
    expect(nextTitle(107)?.id).toBe("bow-108");
    expect(nextTitle(108)?.id).toBe("bow-300");
  });

  it("is null once every title is earned", () => {
    const last = BOW_TITLES[BOW_TITLES.length - 1];
    expect(last).toBeDefined();
    expect(nextTitle((last?.bows ?? 0) - 1)).toBe(last);
    expect(nextTitle(last?.bows ?? 0)).toBeNull();
    expect(nextTitle(1_000_000)).toBeNull();
  });
});

describe("titlesCrossed", () => {
  it("reports a title when its threshold is reached exactly", () => {
    expect(ids(titlesCrossed(0, 1))).toEqual(["bow-1"]);
    expect(ids(titlesCrossed(9, 10))).toEqual(["bow-10"]);
  });

  it("reports nothing when no threshold lies in (before, after]", () => {
    expect(titlesCrossed(1, 9)).toEqual([]);
    expect(titlesCrossed(10, 10)).toEqual([]);
    expect(titlesCrossed(10, 11)).toEqual([]);
  });

  it("reports each title when one update jumps over several thresholds", () => {
    expect(ids(titlesCrossed(9, 110))).toEqual(["bow-10", "bow-30", "bow-108"]);
    expect(ids(titlesCrossed(0, 10_000))).toEqual(ids(BOW_TITLES));
  });
});

describe("loadBows", () => {
  const stubStorage = (stored: string | null): void => {
    const store = new Map<string, string>();
    if (stored !== null) store.set("dongjane:collection", stored);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is zero when nothing was saved", () => {
    stubStorage(null);
    expect(loadBows()).toBe(0);
  });

  it("round-trips a saved count", () => {
    stubStorage(null);
    saveBows(108);
    expect(loadBows()).toBe(108);
  });

  it("floors fractional counts and clamps negatives to zero", () => {
    stubStorage('{"bows":12.9}');
    expect(loadBows()).toBe(12);
    stubStorage('{"bows":-5}');
    expect(loadBows()).toBe(0);
  });

  it("falls back to zero for values that are not finite numbers", () => {
    for (const raw of ['{"bows":"12"}', '{"bows":null}', '{"bows":"NaN"}', "{}", "[]", "7", "not json"]) {
      stubStorage(raw);
      expect(loadBows()).toBe(0);
    }
  });
});
