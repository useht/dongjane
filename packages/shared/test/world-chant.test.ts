import { describe, expect, it } from "vitest";
import {
  CHANT_EVERY_MS,
  CHANT_MS,
  WORLD_CAPACITY,
  WORLD_SPARE_AT,
  chantAt,
  chantEndsAt,
  chantLabel,
  chantPhase,
  isWorldFullError,
  isValidWorld,
  parseWorldParam,
  parseSeatRequest,
} from "../src/index.ts";

describe("world numbers", () => {
  it("keeps a world at most a dozen visitors and opens the next at ten", () => {
    expect(WORLD_CAPACITY).toBe(12);
    expect(WORLD_SPARE_AT).toBe(10);
  });

  it("parses the ?world= parameter strictly", () => {
    expect(parseWorldParam("3")).toBe(3);
    expect(parseWorldParam("25")).toBe(25);
    expect(parseWorldParam("0")).toBeNull();
    expect(parseWorldParam("-1")).toBeNull();
    expect(parseWorldParam("2abc")).toBeNull();
    expect(parseWorldParam("12345")).toBeNull();
    expect(parseWorldParam("")).toBeNull();
    expect(parseWorldParam(null)).toBeNull();
    expect(isValidWorld(1.5)).toBe(false);
    expect(isValidWorld("2")).toBe(false);
    expect(isValidWorld(1)).toBe(true);
  });

  it("reads a seat request and treats anything unusable as no preference", () => {
    expect(parseSeatRequest({ world: 4 })).toEqual({ world: 4 });
    expect(parseSeatRequest({ world: null })).toEqual({ world: null });
    expect(parseSeatRequest({ world: 0 })).toEqual({ world: null });
    expect(parseSeatRequest({ world: "4" })).toEqual({ world: null });
    expect(parseSeatRequest(undefined)).toEqual({ world: null });
    expect(parseSeatRequest("4")).toEqual({ world: null });
  });

  it("recognizes full-world errors from the matchmaker", () => {
    expect(isWorldFullError(new Error('room "abc" is locked'))).toBe(true);
    expect(isWorldFullError(new Error('"abc" is already full.'))).toBe(true);
    expect(isWorldFullError(new Error("network down"))).toBe(false);
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
