import { KST_OFFSET_MS } from "./constants.ts";

export type SkyPeriod = "night" | "dawn" | "day" | "dusk";
export type Weather = "clear" | "cloudy" | "rain" | "snow";

export interface SkyState {
  hour: number;
  daylight: number;
  period: SkyPeriod;
  weather: Weather;
}

export const SUNRISE_HOUR = 6;
export const SUNSET_HOUR = 18;
export const TWILIGHT_HOURS = 1;

export const WEATHER_SLOT_MS = 60 * 60 * 1000;
export const CLEAR_SHARE = 0.5;
export const CLOUDY_SHARE = 0.25;
export const RAIN_SHARE = 0.15;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WINTER_MONTHS: readonly number[] = [11, 0, 1];

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function hash32(value: number): number {
  let h = (value | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function kstHour(serverNowMs: number): number {
  const msOfDay = (((serverNowMs + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return msOfDay / HOUR_MS;
}

export function daylightAt(hour: number): number {
  const rise = smoothstep(SUNRISE_HOUR - TWILIGHT_HOURS, SUNRISE_HOUR + TWILIGHT_HOURS, hour);
  const set = smoothstep(SUNSET_HOUR - TWILIGHT_HOURS, SUNSET_HOUR + TWILIGHT_HOURS, hour);
  return rise - set;
}

export function periodAt(hour: number): SkyPeriod {
  const dawnStart = SUNRISE_HOUR - TWILIGHT_HOURS;
  const dayStart = SUNRISE_HOUR + TWILIGHT_HOURS;
  const duskStart = SUNSET_HOUR - TWILIGHT_HOURS;
  const nightStart = SUNSET_HOUR + TWILIGHT_HOURS;
  if (hour >= dayStart && hour < duskStart) return "day";
  if (hour >= dawnStart && hour < dayStart) return "dawn";
  if (hour >= duskStart && hour < nightStart) return "dusk";
  return "night";
}

export function weatherAt(serverNowMs: number): Weather {
  const slot = Math.floor(serverNowMs / WEATHER_SLOT_MS);
  const roll = hash32(slot) / 0x100000000;
  if (roll < CLEAR_SHARE) return "clear";
  if (roll < CLEAR_SHARE + CLOUDY_SHARE) return "cloudy";
  if (roll < CLEAR_SHARE + CLOUDY_SHARE + RAIN_SHARE) return "rain";
  const month = new Date(serverNowMs + KST_OFFSET_MS).getUTCMonth();
  return WINTER_MONTHS.includes(month) ? "snow" : "rain";
}

export function skyAt(serverNowMs: number): SkyState {
  const hour = kstHour(serverNowMs);
  return { hour, daylight: daylightAt(hour), period: periodAt(hour), weather: weatherAt(serverNowMs) };
}
