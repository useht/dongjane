import { describe, expect, it } from "vitest";
import { classifyJoinError } from "../src/net/session.ts";

describe("classifyJoinError", () => {
  it("recognises a full or locked hall", () => {
    expect(classifyJoinError(new Error('room "abc" is locked'))).toBe("full");
    expect(classifyJoinError(new Error("room is already full"))).toBe("full");
  });

  it("recognises a hall that no longer exists", () => {
    expect(classifyJoinError(new Error('room "abc" not found'))).toBe("gone");
    expect(classifyJoinError(new Error("seat reservation expired"))).toBe("gone");
  });

  it("treats anything else as an unreachable server", () => {
    expect(classifyJoinError(new Error("WebSocket connection failed"))).toBe("offline");
    expect(classifyJoinError("boom")).toBe("offline");
    expect(classifyJoinError(undefined)).toBe("offline");
  });
});
