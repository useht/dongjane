import { describe, expect, it } from "vitest";
import { CUSHION_COUNT, KST_OFFSET_MS, cushionLabel, dailyQuests, questDay, questMatches, type Quest } from "../src/index.ts";

const DAY = 24 * 60 * 60 * 1000;
const kstMidnight = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day) - KST_OFFSET_MS;

describe("questDay", () => {
  it("rolls over exactly at KST midnight", () => {
    const before = Date.UTC(2026, 9, 29, 14, 59, 59, 999);
    const after = Date.UTC(2026, 9, 29, 15, 0, 0, 0);
    expect(questDay(after)).toBe(questDay(before) + 1);
    expect(questDay(Date.UTC(2026, 9, 29, 0, 0, 0, 0))).toBe(questDay(before));
    expect(questDay(Date.UTC(2026, 9, 30, 14, 59, 59, 999))).toBe(questDay(after));
  });

  it("advances by one per day from KST midnight", () => {
    const start = kstMidnight(2026, 10, 30);
    expect(questDay(start + DAY)).toBe(questDay(start) + 1);
    expect(questDay(start + DAY - 1)).toBe(questDay(start));
  });
});

describe("cushionLabel", () => {
  it("names every cushion by row and column", () => {
    const labels = Array.from({ length: CUSHION_COUNT }, (_, id) => cushionLabel(id));
    expect(new Set(labels).size).toBe(CUSHION_COUNT);
    expect(CUSHION_COUNT).toBe(8);
    expect(labels[0]).toBe("부처님 쪽 줄 1번째 방석");
    expect(labels[1]).toBe("부처님 쪽 줄 2번째 방석");
    expect(labels[3]).toBe("부처님 쪽 줄 4번째 방석");
    expect(labels[4]).toBe("입구 쪽 줄 1번째 방석");
    expect(labels[7]).toBe("입구 쪽 줄 4번째 방석");
  });
});

describe("dailyQuests", () => {
  const day = questDay(kstMidnight(2026, 10, 30));

  it("makes a location, an anywhere and a chant quest", () => {
    const [place, anywhere, chant] = dailyQuests(day) as [Quest, Quest, Quest];
    expect(dailyQuests(day)).toHaveLength(3);

    expect(place.id).toBe(`${day}-0`);
    expect(place.cushionId).not.toBeNull();
    expect(place.duringChant).toBe(false);
    expect([3, 5]).toContain(place.target);
    expect(place.text).toBe(`${cushionLabel(place.cushionId as number)}에서 절 ${place.target}번 하기`);

    expect(anywhere.id).toBe(`${day}-1`);
    expect(anywhere.cushionId).toBeNull();
    expect(anywhere.duringChant).toBe(false);
    expect([5, 8, 10]).toContain(anywhere.target);
    expect(anywhere.text).toBe(`방석 어디에서든 절 ${anywhere.target}번 하기`);

    expect(chant.id).toBe(`${day}-2`);
    expect(chant.cushionId).toBeNull();
    expect(chant.duringChant).toBe(true);
    expect([2, 3]).toContain(chant.target);
    expect(chant.text).toBe(`예불 시간에 절 ${chant.target}번 하기`);
  });

  it("is the same for everyone on a given day", () => {
    expect(dailyQuests(day)).toEqual(dailyQuests(day));
  });

  it("changes from day to day", () => {
    const sets = new Set<string>();
    const cushions = new Set<number | null>();
    for (let offset = 0; offset < 30; offset += 1) {
      const quests = dailyQuests(day + offset);
      sets.add(JSON.stringify(quests.map(({ text }) => text)));
      cushions.add(quests[0]!.cushionId);
    }
    expect(sets.size).toBeGreaterThan(1);
    expect(cushions.size).toBeGreaterThan(2);
  });

  it("only points at cushions that exist", () => {
    for (let offset = 0; offset < 200; offset += 1) {
      const cushionId = dailyQuests(day + offset)[0]!.cushionId;
      expect(Number.isInteger(cushionId)).toBe(true);
      expect(cushionId).toBeGreaterThanOrEqual(0);
      expect(cushionId).toBeLessThan(CUSHION_COUNT);
    }
  });
});

describe("questMatches", () => {
  const [place, anywhere, chant] = dailyQuests(questDay(kstMidnight(2026, 10, 30))) as [Quest, Quest, Quest];
  const elsewhere = ((place.cushionId as number) + 1) % CUSHION_COUNT;

  it("needs the named cushion for a location quest", () => {
    expect(questMatches(place, { cushionId: place.cushionId as number, duringChant: false })).toBe(true);
    expect(questMatches(place, { cushionId: place.cushionId as number, duringChant: true })).toBe(true);
    expect(questMatches(place, { cushionId: elsewhere, duringChant: false })).toBe(false);
  });

  it("accepts any cushion for an anywhere quest", () => {
    expect(questMatches(anywhere, { cushionId: 0, duringChant: false })).toBe(true);
    expect(questMatches(anywhere, { cushionId: elsewhere, duringChant: true })).toBe(true);
  });

  it("needs the chant to be active for a chant quest", () => {
    expect(questMatches(chant, { cushionId: 2, duringChant: true })).toBe(true);
    expect(questMatches(chant, { cushionId: 2, duringChant: false })).toBe(false);
  });
});
