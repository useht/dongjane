import { describe, expect, it } from "vitest";
import {
  CHANT_EVERY_MS,
  CHANT_MS,
  HALL_CAPACITY,
  chantAt,
  chantEndsAt,
  chantLabel,
  chantPhase,
  emptyHall,
  isHallFullError,
  isValidHall,
  parseHallParam,
  pickHall,
  type HallInfo,
} from "../src/index.ts";

const info = (hall: number, clients: number, roomId: string | null = `r${hall}`): HallInfo => ({
  hall,
  roomId,
  clients,
  capacity: HALL_CAPACITY,
  full: clients >= HALL_CAPACITY,
});

describe("hall selection", () => {
  it("prefers the hall with the most free room", () => {
    expect(pickHall([info(1, 10), info(2, 3), info(3, 7)])).toBe(2);
  });

  it("skips full halls and halls without a room", () => {
    expect(pickHall([info(1, HALL_CAPACITY), info(2, 29), info(3, 0, null)])).toBe(2);
    expect(pickHall([info(1, HALL_CAPACITY)])).toBeNull();
    expect(pickHall([])).toBeNull();
  });

  it("breaks ties toward the lowest hall number", () => {
    expect(pickHall([info(4, 2), info(5, 2)])).toBe(4);
  });

  it("parses the ?hall= parameter strictly", () => {
    expect(parseHallParam("3")).toBe(3);
    expect(parseHallParam("8")).toBe(8);
    expect(parseHallParam("0")).toBeNull();
    expect(parseHallParam("9")).toBeNull();
    expect(parseHallParam("2abc")).toBeNull();
    expect(parseHallParam("")).toBeNull();
    expect(parseHallParam(null)).toBeNull();
    expect(isValidHall(1.5)).toBe(false);
  });

  it("recognizes full-hall errors from the matchmaker", () => {
    expect(isHallFullError(new Error('room "abc" is locked'))).toBe(true);
    expect(isHallFullError(new Error('"abc" is already full.'))).toBe(true);
    expect(isHallFullError(new Error("network down"))).toBe(false);
    expect(emptyHall(2)).toEqual({ hall: 2, roomId: null, clients: 0, capacity: HALL_CAPACITY, full: false });
  });
});

describe("chant schedule", () => {
  const hour = 3_600_000;
  const base = Math.floor(1_800_000_000_000 / hour) * hour;

  it("aligns to the half hour and stays active for CHANT_MS", () => {
    const during = chantAt(base + 5_000);
    expect(during.startsAt).toBe(base);
    expect(during.durationMs).toBe(CHANT_MS);
    expect(chantPhase(during, base + 5_000)).toBe("active");
    expect(chantEndsAt(during)).toBe(base + CHANT_MS);
  });

  it("points at the next half hour after the chant ends", () => {
    const after = chantAt(base + CHANT_MS + 1);
    expect(after.startsAt).toBe(base + CHANT_EVERY_MS);
    expect(chantPhase(after, base + CHANT_MS + 1)).toBe("upcoming");
    expect(chantPhase(after, after.startsAt + after.durationMs)).toBe("ended");
  });

  it("labels the start time in Korea Standard Time", () => {
    expect(chantLabel(Date.UTC(2026, 0, 1, 0, 30))).toBe("09:30 예불");
    expect(chantLabel(Date.UTC(2026, 0, 1, 15, 0))).toBe("00:00 예불");
  });
});
