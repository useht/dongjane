import { describe, expect, it } from "vitest";
import {
  CHANT_EVERY_MS,
  CHANT_MS,
  HALL_CAPACITY,
  HALL_SPARE_AT,
  chantAt,
  chantEndsAt,
  chantLabel,
  chantPhase,
  isHallFullError,
  isValidHall,
  parseHallParam,
  parseSeatRequest,
} from "../src/index.ts";

describe("hall numbers", () => {
  it("keeps a hall at most a dozen visitors and opens the next at ten", () => {
    expect(HALL_CAPACITY).toBe(12);
    expect(HALL_SPARE_AT).toBe(10);
  });

  it("parses the ?hall= parameter strictly", () => {
    expect(parseHallParam("3")).toBe(3);
    expect(parseHallParam("25")).toBe(25);
    expect(parseHallParam("0")).toBeNull();
    expect(parseHallParam("-1")).toBeNull();
    expect(parseHallParam("2abc")).toBeNull();
    expect(parseHallParam("12345")).toBeNull();
    expect(parseHallParam("")).toBeNull();
    expect(parseHallParam(null)).toBeNull();
    expect(isValidHall(1.5)).toBe(false);
    expect(isValidHall("2")).toBe(false);
    expect(isValidHall(1)).toBe(true);
  });

  it("reads a seat request and treats anything unusable as no preference", () => {
    expect(parseSeatRequest({ hall: 4 })).toEqual({ hall: 4 });
    expect(parseSeatRequest({ hall: null })).toEqual({ hall: null });
    expect(parseSeatRequest({ hall: 0 })).toEqual({ hall: null });
    expect(parseSeatRequest({ hall: "4" })).toEqual({ hall: null });
    expect(parseSeatRequest(undefined)).toEqual({ hall: null });
    expect(parseSeatRequest("4")).toEqual({ hall: null });
  });

  it("recognizes full-hall errors from the matchmaker", () => {
    expect(isHallFullError(new Error('room "abc" is locked'))).toBe(true);
    expect(isHallFullError(new Error('"abc" is already full.'))).toBe(true);
    expect(isHallFullError(new Error("network down"))).toBe(false);
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
