import type { SkyState, Weather } from "@dongjane/shared";

export type Rgb = [number, number, number];

export interface SkyLook {
  sunIntensity: number;
  sunColor: Rgb;
  hemisphereIntensity: number;
  hemisphereSky: Rgb;
  hemisphereGround: Rgb;
  candleBoost: number;
  paperGlow: number;
  sunbeamOpacity: number;
  nightSky: number;
  cloudCover: number;
  cloudTint: Rgb;
  rain: number;
  snow: number;
  precipTint: Rgb;
  background: Rgb;
  fogColor: Rgb;
  fogNear: number;
  fogFar: number;
}

export const SCALAR_KEYS = [
  "sunIntensity",
  "hemisphereIntensity",
  "candleBoost",
  "paperGlow",
  "sunbeamOpacity",
  "nightSky",
  "cloudCover",
  "rain",
  "snow",
  "fogNear",
  "fogFar",
] as const satisfies readonly (keyof SkyLook)[];

export const COLOR_KEYS = [
  "sunColor",
  "hemisphereSky",
  "hemisphereGround",
  "cloudTint",
  "precipTint",
  "background",
  "fogColor",
] as const satisfies readonly (keyof SkyLook)[];

const WEATHER_SHAPE: Record<Weather, { cloud: number; rain: number; snow: number }> = {
  clear: { cloud: 0, rain: 0, snow: 0 },
  cloudy: { cloud: 0.75, rain: 0, snow: 0 },
  rain: { cloud: 0.95, rain: 1, snow: 0 },
  snow: { cloud: 0.8, rain: 0, snow: 1 },
};

export function rgb(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function packRgb(color: Readonly<Rgb>): number {
  return (Math.round(color[0]) << 16) | (Math.round(color[1]) << 8) | Math.round(color[2]);
}

function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function mixRgb(a: Readonly<Rgb>, b: Readonly<Rgb>, t: number): Rgb {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function ramp(night: number, twilight: number, day: number, daylight: number): Rgb {
  return daylight < 0.5
    ? mixRgb(rgb(night), rgb(twilight), daylight * 2)
    : mixRgb(rgb(twilight), rgb(day), (daylight - 0.5) * 2);
}

export function skyLook(sky: SkyState): SkyLook {
  const d = Math.min(1, Math.max(0, sky.daylight));
  const shape = WEATHER_SHAPE[sky.weather];
  const overcast = shape.cloud;
  const precip = Math.max(shape.rain, shape.snow);
  const overcastGrey = mixRgb(rgb(0x3a4560), rgb(0xc8d0dc), d);
  const overcastFog = mixRgb(rgb(0x0a0e1a), rgb(0x5a5f68), d);
  const cloudFair = mixRgb(rgb(0x2a3248), rgb(0xe6e9ef), d);
  const cloudStorm = mixRgb(rgb(0x1c2230), rgb(0x9aa3b0), d);

  return {
    sunIntensity: mix(0.18, 3.1, d) * (1 - 0.6 * overcast),
    sunColor: ramp(0x7f93c8, 0xff9a5c, 0xffd8a0, d),
    hemisphereIntensity: mix(0.32, 1.25, d) * (1 - 0.12 * overcast),
    hemisphereSky: mixRgb(ramp(0x4a5c9c, 0xffb48c, 0xffe2b4, d), overcastGrey, 0.4 * overcast),
    hemisphereGround: mixRgb(ramp(0x1a1e30, 0x4a3a34, 0x6b4a2a, d), overcastGrey, 0.2 * overcast),
    candleBoost: 1 + 0.85 * (1 - d),
    paperGlow: mix(0.1, 0.55, d) * (1 - 0.25 * overcast),
    sunbeamOpacity: 0.32 * smoothstep(0.2, 0.9, d) * (1 - overcast),
    nightSky: 1 - smoothstep(0.05, 0.75, d),
    cloudCover: overcast,
    cloudTint: mixRgb(cloudFair, cloudStorm, shape.rain),
    rain: shape.rain,
    snow: shape.snow,
    precipTint: mixRgb(rgb(0x4d5a78), rgb(0xd8e4f0), d),
    background: ramp(0x04060d, 0x14101a, 0x1c120b, d),
    fogColor: mixRgb(ramp(0x070b18, 0x2a1c20, 0x2a1a10, d), overcastFog, 0.35 * overcast),
    fogNear: mix(12, 16, d) * (1 - 0.2 * precip),
    fogFar: mix(36, 42, d) * (1 - 0.3 * precip),
  };
}

export const DAY_LOOK: SkyLook = skyLook({ hour: 12, daylight: 1, period: "day", weather: "clear" });

export function cloneLook(look: SkyLook): SkyLook {
  const copy = { ...look };
  for (const key of COLOR_KEYS) copy[key] = [...look[key]];
  return copy;
}

export function easeLook(current: SkyLook, target: SkyLook, t: number): void {
  for (const key of SCALAR_KEYS) current[key] = mix(current[key], target[key], t);
  for (const key of COLOR_KEYS) {
    const from = current[key];
    const to = target[key];
    from[0] = mix(from[0], to[0], t);
    from[1] = mix(from[1], to[1], t);
    from[2] = mix(from[2], to[2], t);
  }
}
