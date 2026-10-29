import { describe, expect, it } from "vitest";
import { parseBow, parseMove, parseRelocate, parseSit } from "../src/index.ts";

describe("message parsers", () => {
  it("accepts finite move targets and rejects everything else", () => {
    expect(parseMove({ x: 1.5, z: -2 })).toEqual({ x: 1.5, z: -2, seq: 0 });
    expect(parseMove({ x: Number.NaN, z: 0 })).toBeNull();
    expect(parseMove({ x: 0, z: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseMove({ x: "1", z: 0 })).toBeNull();
    expect(parseMove({ x: 1 })).toBeNull();
    expect(parseMove(null)).toBeNull();
    expect(parseMove([1, 2])).toBeNull();
    expect(parseMove(7)).toBeNull();
  });

  it("keeps a move seq only when it is a non-negative 32-bit integer, otherwise reads it as 0", () => {
    expect(parseMove({ x: 1, z: 2, seq: 7 })).toEqual({ x: 1, z: 2, seq: 7 });
    expect(parseMove({ x: 1, z: 2, seq: 0 })).toEqual({ x: 1, z: 2, seq: 0 });
    expect(parseMove({ x: 1, z: 2, seq: 0xffffffff })).toEqual({ x: 1, z: 2, seq: 0xffffffff });
    for (const seq of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000000, "3", null, [4]]) {
      expect(parseMove({ x: 1, z: 2, seq })).toEqual({ x: 1, z: 2, seq: 0 });
    }
    expect(parseMove({ x: Number.NaN, z: 2, seq: 3 })).toBeNull();
  });

  it("accepts only integer cushion ids 0..7", () => {
    expect(parseSit({ cushionId: 0 })).toEqual({ cushionId: 0 });
    expect(parseSit({ cushionId: 7 })).toEqual({ cushionId: 7 });
    expect(parseSit({ cushionId: 8 })).toBeNull();
    expect(parseSit({ cushionId: -1 })).toBeNull();
    expect(parseSit({ cushionId: 2.5 })).toBeNull();
    expect(parseSit({ cushionId: Number.NaN })).toBeNull();
    expect(parseSit({ cushionId: "3" })).toBeNull();
    expect(parseSit(undefined)).toBeNull();
  });

  it("accepts only 1, 2 or 3 bows", () => {
    expect(parseBow({ times: 1 })).toEqual({ times: 1 });
    expect(parseBow({ times: 3 })).toEqual({ times: 3 });
    expect(parseBow({ times: 0 })).toBeNull();
    expect(parseBow({ times: 4 })).toBeNull();
    expect(parseBow({ times: 1.5 })).toBeNull();
    expect(parseBow({ times: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseBow({})).toBeNull();
  });

  it("accepts only a positive integer hall to relocate to", () => {
    expect(parseRelocate({ hall: 3 })).toEqual({ hall: 3 });
    expect(parseRelocate({ hall: 0 })).toBeNull();
    expect(parseRelocate({ hall: 1.5 })).toBeNull();
    expect(parseRelocate({ hall: "3" })).toBeNull();
    expect(parseRelocate({})).toBeNull();
    expect(parseRelocate(null)).toBeNull();
  });
});
