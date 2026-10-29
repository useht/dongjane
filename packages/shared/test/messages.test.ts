import { describe, expect, it } from "vitest";
import { parseBow, parseMove, parseRelocate, parseSit } from "../src/index.ts";

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

  it("accepts only integer mat ids 0..7", () => {
    expect(parseSit({ matId: 0 })).toEqual({ matId: 0 });
    expect(parseSit({ matId: 11 })).toEqual({ matId: 11 });
    expect(parseSit({ matId: 12 })).toBeNull();
    expect(parseSit({ matId: -1 })).toBeNull();
    expect(parseSit({ matId: 2.5 })).toBeNull();
    expect(parseSit({ matId: Number.NaN })).toBeNull();
    expect(parseSit({ matId: "3" })).toBeNull();
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

  it("accepts only a positive integer world to relocate to", () => {
    expect(parseRelocate({ world: 3 })).toEqual({ world: 3 });
    expect(parseRelocate({ world: 0 })).toBeNull();
    expect(parseRelocate({ world: 1.5 })).toBeNull();
    expect(parseRelocate({ world: "3" })).toBeNull();
    expect(parseRelocate({})).toBeNull();
    expect(parseRelocate(null)).toBeNull();
  });
});
