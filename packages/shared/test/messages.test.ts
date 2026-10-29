import { describe, expect, it } from "vitest";
import { parseBow, parseMove, parseRelocate, parseSetName, parseSit } from "../src/index.ts";

describe("message parsers", () => {
  it("accepts finite move targets and rejects everything else", () => {
    expect(parseMove({ x: 1.5, z: -2 })).toEqual({ x: 1.5, z: -2 });
    expect(parseMove({ x: Number.NaN, z: 0 })).toBeNull();
    expect(parseMove({ x: 0, z: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseMove({ x: "1", z: 0 })).toBeNull();
    expect(parseMove({ x: 1 })).toBeNull();
    expect(parseMove(null)).toBeNull();
    expect(parseMove([1, 2])).toBeNull();
    expect(parseMove(7)).toBeNull();
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

  it("requires a string name and caps absurd lengths", () => {
    expect(parseSetName({ name: "동자" })).toEqual({ name: "동자" });
    expect(parseSetName({ name: 5 })).toBeNull();
    expect(parseSetName("동자")).toBeNull();
    expect(parseSetName({ name: "x".repeat(10_000) })?.name.length).toBeLessThanOrEqual(64);
  });
});
