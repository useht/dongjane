import { describe, expect, it } from "vitest";
import { KST_OFFSET_MS, WEATHER_SLOT_MS, skyAt, weatherAt, type Weather } from "../src/index.ts";

const MINUTE = 60_000;
const kst = (year: number, month: number, day: number, hour: number, minute = 0): number =>
  Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
const kstMonth = (ms: number): number => new Date(ms + KST_OFFSET_MS).getUTCMonth() + 1;

describe("time of day", () => {
  it("reads the hour in KST", () => {
    const noon = Date.UTC(2026, 9, 29, 3, 0);
    const sky = skyAt(noon);
    expect(sky.hour).toBeCloseTo(12, 9);
    expect(sky.period).toBe("day");
    expect(sky.daylight).toBe(1);
    expect(skyAt(Date.UTC(2026, 9, 29, 15, 30)).hour).toBeCloseTo(0.5, 9);
    expect(skyAt(Date.UTC(1969, 11, 31, 15, 0)).hour).toBeCloseTo(0, 9);
  });

  it("is dark in the middle of the night", () => {
    const sky = skyAt(kst(2026, 10, 29, 2));
    expect(sky.hour).toBeCloseTo(2, 9);
    expect(sky.period).toBe("night");
    expect(sky.daylight).toBe(0);
  });

  it("switches period at 05:00, 07:00, 17:00 and 19:00", () => {
    const period = (hour: number, minute = 0) => skyAt(kst(2026, 10, 29, hour, minute)).period;
    expect(period(4, 59)).toBe("night");
    expect(period(5)).toBe("dawn");
    expect(period(6, 59)).toBe("dawn");
    expect(period(7)).toBe("day");
    expect(period(16, 59)).toBe("day");
    expect(period(17)).toBe("dusk");
    expect(period(18, 59)).toBe("dusk");
    expect(period(19)).toBe("night");
    expect(period(23, 59)).toBe("night");
  });

  it("puts sunrise and sunset halfway up the ramp", () => {
    const daylight = (hour: number) => skyAt(kst(2026, 10, 29, hour)).daylight;
    expect(daylight(5)).toBe(0);
    expect(daylight(6)).toBeCloseTo(0.5, 9);
    expect(daylight(7)).toBe(1);
    expect(daylight(12)).toBe(1);
    expect(daylight(17)).toBe(1);
    expect(daylight(18)).toBeCloseTo(0.5, 9);
    expect(daylight(19)).toBe(0);
  });

  it("changes continuously and stays within 0..1 across a whole day", () => {
    const start = kst(2026, 10, 29, 0);
    let previous = skyAt(start).daylight;
    for (let minute = 1; minute <= 24 * 60; minute += 1) {
      const { daylight } = skyAt(start + minute * MINUTE);
      expect(daylight).toBeGreaterThanOrEqual(0);
      expect(daylight).toBeLessThanOrEqual(1);
      expect(Math.abs(daylight - previous)).toBeLessThan(0.015);
      previous = daylight;
    }
  });

  it("brightens through the morning and dims through the evening", () => {
    let previous = -1;
    for (let minute = 4 * 60; minute <= 8 * 60; minute += 5) {
      const { daylight } = skyAt(kst(2026, 10, 29, 0, minute));
      expect(daylight).toBeGreaterThanOrEqual(previous);
      previous = daylight;
    }
    for (let minute = 16 * 60; minute <= 20 * 60; minute += 5) {
      const { daylight } = skyAt(kst(2026, 10, 29, 0, minute));
      expect(daylight).toBeLessThanOrEqual(previous);
      previous = daylight;
    }
  });
});

describe("weather", () => {
  const winter = kst(2027, 1, 1, 0);

  it("is the same for every moment inside one slot", () => {
    const slotStart = Math.floor(kst(2026, 10, 29, 13) / WEATHER_SLOT_MS) * WEATHER_SLOT_MS;
    const expected = weatherAt(slotStart);
    for (let offset = 0; offset < WEATHER_SLOT_MS; offset += 7 * MINUTE) {
      expect(weatherAt(slotStart + offset)).toBe(expected);
    }
    expect(weatherAt(slotStart + WEATHER_SLOT_MS - 1)).toBe(expected);
  });

  it("is deterministic, so client and server agree", () => {
    for (let slot = 0; slot < 200; slot += 1) {
      const at = winter + slot * WEATHER_SLOT_MS + 1234;
      expect(skyAt(at)).toEqual(skyAt(at));
    }
  });

  it("varies from hour to hour across a month", () => {
    const seen = new Set<Weather>();
    let changes = 0;
    let previous: Weather | null = null;
    for (let slot = 0; slot < 30 * 24; slot += 1) {
      const weather = weatherAt(winter + slot * WEATHER_SLOT_MS);
      seen.add(weather);
      if (previous !== null && weather !== previous) changes += 1;
      previous = weather;
    }
    expect([...seen].sort()).toEqual(["clear", "cloudy", "rain", "snow"]);
    expect(changes).toBeGreaterThan(100);
  });

  it("is mostly clear, then cloudy, then rainy over a year", () => {
    const counts: Record<Weather, number> = { clear: 0, cloudy: 0, rain: 0, snow: 0 };
    const start = kst(2026, 1, 1, 0);
    const slots = 365 * 24;
    for (let slot = 0; slot < slots; slot += 1) counts[weatherAt(start + slot * WEATHER_SLOT_MS)] += 1;
    expect(counts.clear / slots).toBeGreaterThan(0.44);
    expect(counts.clear / slots).toBeLessThan(0.56);
    expect(counts.cloudy / slots).toBeGreaterThan(0.2);
    expect(counts.cloudy / slots).toBeLessThan(0.3);
    expect((counts.rain + counts.snow) / slots).toBeGreaterThan(0.2);
    expect((counts.rain + counts.snow) / slots).toBeLessThan(0.3);
  });

  it("snows only from December to February (KST)", () => {
    const start = kst(2026, 1, 1, 0);
    const monthsWithSnow = new Set<number>();
    for (let slot = 0; slot < 365 * 24; slot += 1) {
      const at = start + slot * WEATHER_SLOT_MS;
      if (weatherAt(at) === "snow") monthsWithSnow.add(kstMonth(at));
    }
    expect([...monthsWithSnow].sort((a, b) => a - b)).toEqual([1, 2, 12]);
  });

  it("uses the KST month, not the UTC month, at the boundary", () => {
    const lastSlotOfNovember = kst(2026, 11, 30, 23);
    const firstSlotOfDecember = kst(2026, 12, 1, 0);
    expect(kstMonth(lastSlotOfNovember)).toBe(11);
    expect(kstMonth(firstSlotOfDecember)).toBe(12);
    expect(weatherAt(lastSlotOfNovember)).not.toBe("snow");
  });

  it("turns would-be snow into rain outside winter", () => {
    const winterWeather: Weather[] = [];
    const summerWeather: Weather[] = [];
    for (let slot = 0; slot < 24 * 31; slot += 1) {
      winterWeather.push(weatherAt(kst(2027, 1, 1, 0) + slot * WEATHER_SLOT_MS));
      summerWeather.push(weatherAt(kst(2026, 7, 1, 0) + slot * WEATHER_SLOT_MS));
    }
    expect(winterWeather.includes("snow")).toBe(true);
    expect(summerWeather.includes("snow")).toBe(false);
    expect(summerWeather.includes("rain")).toBe(true);
  });
});
