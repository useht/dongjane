import type { SkyState, Weather } from "@dongjane/shared";
import { THEME } from "../theme.ts";

export type Rgb = [number, number, number];

// Everything the outdoor scene changes with the hour and the weather. Colours are 0..255 channels.
export interface SkyLook {
  sunIntensity: number;
  sunColor: Rgb;
  hemisphereIntensity: number;
  hemisphereSky: Rgb;
  hemisphereGround: Rgb;
  envIntensity: number;
  skyTop: Rgb;
  skyMid: Rgb;
  // The horizon of the dome, the clear colour and the colour distant ground fades into.
  fogColor: Rgb;
  fogNear: number;
  fogFar: number;
  sunGlow: number;
  nightSky: number;
  cloudCover: number;
  cloudTint: Rgb;
  rain: number;
  snow: number;
  precipTint: Rgb;
}

export const SCALAR_KEYS = [
  "sunIntensity",
  "hemisphereIntensity",
  "envIntensity",
  "fogNear",
  "fogFar",
  "sunGlow",
  "nightSky",
  "cloudCover",
  "rain",
  "snow",
] as const satisfies readonly (keyof SkyLook)[];

export const COLOR_KEYS = [
  "sunColor",
  "hemisphereSky",
  "hemisphereGround",
  "skyTop",
  "skyMid",
  "fogColor",
  "cloudTint",
  "precipTint",
] as const satisfies readonly (keyof SkyLook)[];

const WEATHER_SHAPE: Record<Weather, { cloud: number; rain: number; snow: number }> = {
  clear: { cloud: 0, rain: 0, snow: 0 },
  cloudy: { cloud: 0.75, rain: 0, snow: 0 },
  rain: { cloud: 0.95, rain: 1, snow: 0 },
  snow: { cloud: 0.8, rain: 0, snow: 1 },
};

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
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

// Night at daylight 0, the twilight colour at 0.5 and the day colour at 1.
function ramp(night: string, twilight: string, day: string, daylight: number): Rgb {
  return daylight < 0.5
    ? mixRgb(hexToRgb(night), hexToRgb(twilight), daylight * 2)
    : mixRgb(hexToRgb(twilight), hexToRgb(day), (daylight - 0.5) * 2);
}

export function skyLook(sky: SkyState): SkyLook {
  const palette = THEME.scene;
  const d = Math.min(1, Math.max(0, sky.daylight));
  const shape = WEATHER_SHAPE[sky.weather];
  const overcast = shape.cloud;
  const precip = Math.max(shape.rain, shape.snow);
  const overcastGrey = mixRgb(hexToRgb(palette.overcastNight), hexToRgb(palette.overcastDay), d);
  const cloudFair = mixRgb(hexToRgb(palette.cloudNight), hexToRgb(palette.cloudDay), d);
  const cloudStorm = mixRgb(hexToRgb(palette.stormNight), hexToRgb(palette.stormDay), d);

  return {
    sunIntensity: mix(0.5, 2.8, d) * (1 - 0.6 * overcast),
    sunColor: ramp(palette.sunNight, palette.sunTwilight, palette.sun, d),
    hemisphereIntensity: mix(0.8, 1.15, d) * (1 - 0.1 * overcast),
    hemisphereSky: mixRgb(ramp(palette.hemiSkyNight, palette.hemiSkyTwilight, palette.hemiSky, d), overcastGrey, 0.4 * overcast),
    hemisphereGround: mixRgb(ramp(palette.hemiGroundNight, palette.hemiGroundTwilight, palette.hemiGround, d), overcastGrey, 0.2 * overcast),
    envIntensity: mix(0.2, 0.7, d) * (1 - 0.3 * overcast),
    skyTop: mixRgb(ramp(palette.skyTopNight, palette.skyTopTwilight, palette.skyTop, d), overcastGrey, 0.35 * overcast),
    skyMid: mixRgb(ramp(palette.skyMidNight, palette.skyMidTwilight, palette.skyMid, d), overcastGrey, 0.5 * overcast),
    fogColor: mixRgb(ramp(palette.skyHorizonNight, palette.skyHorizonTwilight, palette.skyHorizon, d), overcastGrey, 0.6 * overcast),
    fogNear: mix(22, 26, d) * (1 - 0.25 * precip),
    fogFar: mix(54, 62, d) * (1 - 0.35 * precip),
    sunGlow: smoothstep(0.15, 0.7, d) * (1 - overcast),
    nightSky: 1 - smoothstep(0.05, 0.75, d),
    cloudCover: overcast,
    cloudTint: mixRgb(cloudFair, cloudStorm, shape.rain),
    rain: shape.rain,
    snow: shape.snow,
    precipTint: mixRgb(hexToRgb(palette.precipNight), hexToRgb(palette.precipDay), d),
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
