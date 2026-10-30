import { describe, expect, it } from "vitest";
import { DHARMA_SEATS, GATBAWI_SEATS, KST_OFFSET_MS, ZONES, dailyQuests, placeLabel, questDay, questMatches, type Quest, type QuestPlace } from "../src/index.ts";

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

describe("placeLabel", () => {
  it("names a row of seats by zone, and the seat kind the zone uses", () => {
    expect(placeLabel({ zone: "gatbawi", row: 0 })).toBe("갓바위 부처님 쪽 1번째 줄 돗자리");
    expect(placeLabel({ zone: "gatbawi", row: 9 })).toBe("갓바위 부처님 쪽 10번째 줄 돗자리");
    expect(placeLabel({ zone: "dharma", row: 2 })).toBe("법당 부처님 쪽 3번째 줄 방석");
  });
});

describe("dailyQuests", () => {
  const day = questDay(kstMidnight(2026, 10, 30));

  it("makes a location, an anywhere and a chant quest", () => {
    const [place, anywhere, chant] = dailyQuests(day) as [Quest, Quest, Quest];
    expect(dailyQuests(day)).toHaveLength(3);

    expect(place.id).toBe(`${day}-0`);
    expect(place.place).not.toBeNull();
    expect(place.duringChant).toBe(false);
    expect([3, 5]).toContain(place.target);
    expect(place.text).toBe(`${placeLabel(place.place as QuestPlace)}에서 절 ${place.target}번 하기`);

    expect(anywhere.id).toBe(`${day}-1`);
    expect(anywhere.place).toBeNull();
    expect(anywhere.duringChant).toBe(false);
    expect([5, 8, 10]).toContain(anywhere.target);
    expect(anywhere.text).toBe(`방석이나 돗자리 어디에서든 절 ${anywhere.target}번 하기`);

    expect(chant.id).toBe(`${day}-2`);
    expect(chant.place).toBeNull();
    expect(chant.duringChant).toBe(true);
    expect([2, 3]).toContain(chant.target);
    expect(chant.text).toBe(`예불 시간에 절 ${chant.target}번 하기`);
  });

  it("is the same for everyone on a given day", () => {
    expect(dailyQuests(day)).toEqual(dailyQuests(day));
  });

  it("changes from day to day", () => {
    const sets = new Set<string>();
    const places = new Set<string>();
    for (let offset = 0; offset < 30; offset += 1) {
      const quests = dailyQuests(day + offset);
      sets.add(JSON.stringify(quests.map(({ text }) => text)));
      places.add(JSON.stringify(quests[0]!.place));
    }
    expect(sets.size).toBeGreaterThan(1);
    expect(places.size).toBeGreaterThan(2);
  });

  it("only points at rows that exist, and visits both zones", () => {
    const seen = new Set<string>();
    for (let offset = 0; offset < 200; offset += 1) {
      const place = dailyQuests(day + offset)[0]!.place as QuestPlace;
      seen.add(place.zone);
      const rows = (place.zone === "gatbawi" ? GATBAWI_SEATS : DHARMA_SEATS).map((spot) => spot.row);
      expect(rows).toContain(place.row);
    }
    expect([...seen].sort()).toEqual([...ZONES].sort());
  });
});

describe("questMatches", () => {
  const [place, anywhere, chant] = dailyQuests(questDay(kstMidnight(2026, 10, 30))) as [Quest, Quest, Quest];
  const target = place.place as QuestPlace;
  const seats = target.zone === "gatbawi" ? GATBAWI_SEATS : DHARMA_SEATS;
  const inRow = seats.find((spot) => spot.row === target.row)!.id;
  const elsewhere = seats.find((spot) => spot.row !== target.row)!.id;
  const otherZone = target.zone === "gatbawi" ? "dharma" : "gatbawi";

  it("needs a seat in the named row of the named zone for a location quest", () => {
    expect(questMatches(place, { zone: target.zone, seatId: inRow, duringChant: false })).toBe(true);
    expect(questMatches(place, { zone: target.zone, seatId: inRow, duringChant: true })).toBe(true);
    expect(questMatches(place, { zone: target.zone, seatId: elsewhere, duringChant: false })).toBe(false);
    expect(questMatches(place, { zone: otherZone, seatId: inRow, duringChant: false })).toBe(false);
  });

  it("accepts any seat in either zone for an anywhere quest", () => {
    expect(questMatches(anywhere, { zone: "gatbawi", seatId: 0, duringChant: false })).toBe(true);
    expect(questMatches(anywhere, { zone: "dharma", seatId: elsewhere, duringChant: true })).toBe(true);
  });

  it("needs the chant to be active for a chant quest", () => {
    expect(questMatches(chant, { zone: "gatbawi", seatId: 2, duringChant: true })).toBe(true);
    expect(questMatches(chant, { zone: "dharma", seatId: 2, duringChant: false })).toBe(false);
  });
});
