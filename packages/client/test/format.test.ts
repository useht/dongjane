import { describe, expect, it } from "vitest";
import { formatSpan, describeChant, modeLabel } from "../src/ui/format.ts";
import { resolveServerHttpBase, toWebSocketBase } from "../src/config.ts";

describe("modeLabel", () => {
  it("labels each state in Korean", () => {
    expect(modeLabel("stand", -1)).toBe("서 있어요");
    expect(modeLabel("walk", -1)).toBe("걷는 중");
    expect(modeLabel("walk", 3)).toBe("돗자리로 가는 중");
    expect(modeLabel("kneel", 3)).toBe("앉아 있어요");
    expect(modeLabel("bow", 3)).toBe("절하는 중");
  });
});

describe("describeChant", () => {
  const chant = { label: "12:30 예불", startsAt: 100_000, durationMs: 180_000 };

  it("counts down to an upcoming chant and flags it as imminent in the last minute", () => {
    expect(describeChant(chant, 100_000 - 25 * 60_000)).toMatchObject({ phase: "upcoming", text: "다음 12:30 예불 · 25분 뒤", imminent: false });
    expect(describeChant(chant, 100_000 - 30_000)).toMatchObject({ phase: "upcoming", text: "다음 12:30 예불 · 30초 뒤", imminent: true });
  });

  it("reports the remaining time while the chant is active", () => {
    expect(describeChant(chant, 100_000 + 60_000)).toMatchObject({ phase: "active", text: "12:30 예불 중 · 2분 남았어요" });
  });

  it("formats spans", () => {
    expect(formatSpan(59)).toBe("59초");
    expect(formatSpan(60)).toBe("1분");
    expect(formatSpan(3600)).toBe("1시간");
    expect(formatSpan(5400)).toBe("1시간 30분");
  });
});

describe("server endpoint resolution", () => {
  const loc = { protocol: "http:", hostname: "192.168.0.5", origin: "http://192.168.0.5:5173" };

  it("targets port 2567 on the page host in dev", () => {
    expect(resolveServerHttpBase(undefined, loc, true)).toBe("http://192.168.0.5:2567");
  });

  it("uses the page origin in production unless overridden", () => {
    expect(resolveServerHttpBase(undefined, { ...loc, origin: "https://dongjane.example" }, false)).toBe("https://dongjane.example");
    expect(resolveServerHttpBase("wss://game.example/", loc, false)).toBe("https://game.example");
  });

  it("derives a websocket base", () => {
    expect(toWebSocketBase("https://a.b")).toBe("wss://a.b");
    expect(toWebSocketBase("http://a.b:2567")).toBe("ws://a.b:2567");
  });
});
