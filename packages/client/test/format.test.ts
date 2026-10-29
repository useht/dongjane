import { describe, expect, it } from "vitest";
import { describeSky, formatClockTime, formatSpan, describeChant, modeLabel, weatherIconName } from "../src/ui/format.ts";
import { resolveServerHttpBase, toWebSocketBase } from "../src/config.ts";

describe("modeLabel", () => {
  it("labels each state in Korean", () => {
    expect(modeLabel("stand", -1, "gatbawi")).toBe("서 있어요");
    expect(modeLabel("walk", -1, "gatbawi")).toBe("걷는 중");
    expect(modeLabel("walk", 3, "gatbawi")).toBe("돗자리로 가는 중");
    expect(modeLabel("walk", 3, "dharma")).toBe("방석으로 가는 중");
    expect(modeLabel("kneel", 3, "dharma")).toBe("앉아 있어요");
    expect(modeLabel("bow", 3, "gatbawi")).toBe("절하는 중");
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

describe("formatClockTime", () => {
  it("writes the Korean 12-hour clock", () => {
    expect(formatClockTime(21 + 14 / 60)).toBe("오후 9:14");
    expect(formatClockTime(7.5)).toBe("오전 7:30");
    expect(formatClockTime(18)).toBe("오후 6:00");
  });

  it("puts midnight at 오전 12 and noon at 오후 12", () => {
    expect(formatClockTime(0)).toBe("오전 12:00");
    expect(formatClockTime(0.5)).toBe("오전 12:30");
    expect(formatClockTime(11 + 59 / 60)).toBe("오전 11:59");
    expect(formatClockTime(12)).toBe("오후 12:00");
    expect(formatClockTime(12 + 5 / 60)).toBe("오후 12:05");
    expect(formatClockTime(23 + 59 / 60)).toBe("오후 11:59");
  });

  it("drops the seconds instead of rounding up", () => {
    expect(formatClockTime(9 + 59.9 / 60)).toBe("오전 9:59");
    expect(formatClockTime(13 + 13.99 / 60)).toBe("오후 1:13");
  });

  it("holds exact minutes against float noise and wraps the day", () => {
    const msOfDay = (14 * 60 + 9) * 60_000;
    expect(formatClockTime(msOfDay / 3_600_000)).toBe("오후 2:09");
    expect(formatClockTime(24)).toBe("오전 12:00");
    expect(formatClockTime(-0.5)).toBe("오후 11:30");
  });

  it("falls back to a placeholder for a broken hour", () => {
    expect(formatClockTime(Number.NaN)).toBe("--:--");
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe("--:--");
  });
});

describe("weatherIconName", () => {
  it("shows the sun in a lit sky and the moon otherwise when clear", () => {
    expect(weatherIconName("clear", 1)).toBe("sun");
    expect(weatherIconName("clear", 0.5)).toBe("sun");
    expect(weatherIconName("clear", 0.49)).toBe("moon");
    expect(weatherIconName("clear", 0)).toBe("moon");
  });

  it("keeps the cloud family regardless of the light", () => {
    expect(weatherIconName("cloudy", 1)).toBe("cloud");
    expect(weatherIconName("rain", 0)).toBe("rain");
    expect(weatherIconName("snow", 1)).toBe("snow");
  });
});

describe("describeSky", () => {
  it("says it is still checking before the server time arrives", () => {
    expect(describeSky(null)).toEqual({ time: "--:--", weather: "확인 중", note: "하늘을 확인하는 중이에요", icon: "cloud" });
  });

  it("reads out time, weather label, period and the icon", () => {
    expect(describeSky({ hour: 21 + 14 / 60, daylight: 0, period: "night", weather: "rain" })).toEqual({
      time: "오후 9:14",
      weather: "비",
      note: "밤 · 비가 내리고 있어요",
      icon: "rain",
    });
    expect(describeSky({ hour: 12, daylight: 1, period: "day", weather: "clear" })).toMatchObject({
      time: "오후 12:00",
      weather: "맑음",
      note: "낮 · 하늘이 맑아요",
      icon: "sun",
    });
  });

  it("labels every period and weather", () => {
    const note = (period: "night" | "dawn" | "day" | "dusk", weather: "clear" | "cloudy" | "rain" | "snow") =>
      describeSky({ hour: 0, daylight: 0, period, weather });
    expect(note("dawn", "cloudy")).toMatchObject({ weather: "흐림", note: "새벽 · 구름이 끼었어요", icon: "cloud" });
    expect(note("dusk", "snow")).toMatchObject({ weather: "눈", note: "저녁 · 눈이 내리고 있어요", icon: "snow" });
    expect(note("night", "clear")).toMatchObject({ weather: "맑음", icon: "moon" });
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
