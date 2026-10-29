import { describe, expect, it } from "vitest";
import type { SkyState, Weather } from "@dongjane/shared";
import {
  COLOR_KEYS,
  DAY_LOOK,
  SCALAR_KEYS,
  cloneLook,
  easeLook,
  packRgb,
  hexToRgb,
  skyLook,
} from "../src/game/sky-look.ts";
import { THEME } from "../src/theme.ts";

const sky = (daylight: number, weather: Weather = "clear"): SkyState => ({
  hour: 12,
  daylight,
  period: daylight >= 1 ? "day" : daylight <= 0 ? "night" : "dawn",
  weather,
});

const packed = (hex: string): number => packRgb(hexToRgb(hex));

describe("hexToRgb and packRgb", () => {
  it("round-trip a theme colour", () => {
    expect(hexToRgb("#ffd29a")).toEqual([255, 210, 154]);
    expect(packRgb(hexToRgb("#ffd29a"))).toBe(0xffd29a);
  });
});

describe("skyLook at full daylight and clear weather", () => {
  const look = skyLook(sky(1));
  const { scene } = THEME;

  it("is the daylight palette of the theme", () => {
    expect(packRgb(look.sunColor)).toBe(packed(scene.sun));
    expect(packRgb(look.hemisphereSky)).toBe(packed(scene.hemiSky));
    expect(packRgb(look.hemisphereGround)).toBe(packed(scene.hemiGround));
    expect(packRgb(look.skyTop)).toBe(packed(scene.skyTop));
    expect(packRgb(look.skyMid)).toBe(packed(scene.skyMid));
    expect(packRgb(look.fogColor)).toBe(packed(scene.skyHorizon));
    expect(packRgb(look.cloudTint)).toBe(packed(scene.cloudDay));
    expect(packRgb(look.precipTint)).toBe(packed(scene.precipDay));
  });

  it("shows the sun and no stars, cloud or precipitation", () => {
    expect(look.sunGlow).toBe(1);
    expect(look.nightSky).toBe(0);
    expect(look.cloudCover).toBe(0);
    expect(look.rain).toBe(0);
    expect(look.snow).toBe(0);
  });

  it("is what the world starts from", () => {
    expect(DAY_LOOK).toEqual(look);
  });
});

describe("skyLook at night", () => {
  it("hides the sun and shows the stars", () => {
    for (const weather of ["clear", "cloudy", "rain", "snow"] as const) {
      const look = skyLook(sky(0, weather));
      expect(look.sunGlow).toBe(0);
      expect(look.nightSky).toBe(1);
    }
  });

  it("is darker than the day but never pitch black", () => {
    const night = skyLook(sky(0));
    const day = skyLook(sky(1));
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity * 0.3);
    expect(night.sunIntensity).toBeGreaterThan(0.2);
    expect(night.hemisphereIntensity).toBeLessThan(day.hemisphereIntensity);
    expect(night.hemisphereIntensity).toBeGreaterThan(0.5);
    expect(night.envIntensity).toBeLessThan(day.envIntensity);
    expect(night.fogColor[2]).toBeGreaterThan(night.fogColor[0]);
    expect(packRgb(night.fogColor)).toBe(packed(THEME.scene.skyHorizonNight));
  });

  it("has no rain or snow when the weather is clear or cloudy", () => {
    for (const weather of ["clear", "cloudy"] as const) {
      const look = skyLook(sky(0, weather));
      expect(look.rain).toBe(0);
      expect(look.snow).toBe(0);
    }
  });
});

describe("skyLook at twilight", () => {
  it("warms the horizon between the night and the day colours", () => {
    const look = skyLook(sky(0.5));
    expect(packRgb(look.fogColor)).toBe(packed(THEME.scene.skyHorizonTwilight));
    expect(packRgb(look.sunColor)).toBe(packed(THEME.scene.sunTwilight));
    expect(look.fogColor[0]).toBeGreaterThan(look.fogColor[2]);
  });
});

describe("skyLook weather", () => {
  it("only shows rain in rain and only shows snow in snow", () => {
    expect(skyLook(sky(1, "clear")).rain).toBe(0);
    expect(skyLook(sky(1, "clear")).snow).toBe(0);
    expect(skyLook(sky(1, "cloudy")).rain).toBe(0);
    expect(skyLook(sky(1, "cloudy")).snow).toBe(0);
    expect(skyLook(sky(1, "rain")).rain).toBeGreaterThan(0);
    expect(skyLook(sky(1, "rain")).snow).toBe(0);
    expect(skyLook(sky(1, "snow")).snow).toBeGreaterThan(0);
    expect(skyLook(sky(1, "snow")).rain).toBe(0);
  });

  it("covers the sky with cloud, dims the sun and hides the sun disc in overcast weather", () => {
    const clear = skyLook(sky(1, "clear"));
    for (const weather of ["cloudy", "rain", "snow"] as const) {
      const look = skyLook(sky(1, weather));
      expect(look.cloudCover).toBeGreaterThan(0.5);
      expect(look.sunIntensity).toBeLessThan(clear.sunIntensity);
      expect(look.sunGlow).toBeLessThan(clear.sunGlow);
    }
  });

  it("dims the horizon under cloud", () => {
    const total = (color: readonly number[]): number => color.reduce((sum, channel) => sum + channel, 0);
    const clear = skyLook(sky(1, "clear"));
    for (const weather of ["cloudy", "rain", "snow"] as const) {
      expect(total(skyLook(sky(1, weather)).fogColor)).toBeLessThan(total(clear.fogColor));
    }
  });

  it("pulls the fog in while it precipitates", () => {
    const clear = skyLook(sky(1, "clear"));
    for (const weather of ["rain", "snow"] as const) {
      const look = skyLook(sky(1, weather));
      expect(look.fogNear).toBeLessThan(clear.fogNear);
      expect(look.fogFar).toBeLessThan(clear.fogFar);
    }
  });

  it("keeps the whole walkable plaza and the statue clear of fog in the rain", () => {
    for (const weather of ["clear", "rain", "snow"] as const) {
      expect(skyLook(sky(1, weather)).fogNear).toBeGreaterThan(14);
    }
  });
});

describe("skyLook across the day", () => {
  const steps = Array.from({ length: 101 }, (_, i) => i / 100);

  it("raises the sun with daylight", () => {
    for (const weather of ["clear", "cloudy", "rain", "snow"] as const) {
      let previous = -Infinity;
      for (const daylight of steps) {
        const { sunIntensity } = skyLook(sky(daylight, weather));
        expect(sunIntensity).toBeGreaterThanOrEqual(previous);
        previous = sunIntensity;
      }
    }
  });

  it("fades the stars out and the sun in with daylight", () => {
    let nightSky = Infinity;
    let sunGlow = -Infinity;
    for (const daylight of steps) {
      const look = skyLook(sky(daylight));
      expect(look.nightSky).toBeLessThanOrEqual(nightSky);
      expect(look.sunGlow).toBeGreaterThanOrEqual(sunGlow);
      nightSky = look.nightSky;
      sunGlow = look.sunGlow;
    }
  });

  it("keeps every value finite and every colour channel in 0..255", () => {
    for (const weather of ["clear", "cloudy", "rain", "snow"] as const) {
      for (const daylight of steps) {
        const look = skyLook(sky(daylight, weather));
        for (const key of SCALAR_KEYS) expect(Number.isFinite(look[key])).toBe(true);
        for (const key of COLOR_KEYS) {
          for (const channel of look[key]) {
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(255);
          }
        }
      }
    }
  });

  it("clamps daylight outside 0..1", () => {
    expect(skyLook(sky(-3))).toEqual(skyLook(sky(0)));
    expect(skyLook(sky(7))).toEqual(skyLook(sky(1)));
  });
});

describe("easeLook", () => {
  it("lists every field exactly once", () => {
    expect([...SCALAR_KEYS, ...COLOR_KEYS].sort()).toEqual(Object.keys(DAY_LOOK).sort());
  });

  it("moves toward the target and reaches it", () => {
    const target = skyLook(sky(0, "rain"));
    const current = cloneLook(DAY_LOOK);
    easeLook(current, target, 0.5);
    expect(current.sunIntensity).toBeLessThan(DAY_LOOK.sunIntensity);
    expect(current.sunIntensity).toBeGreaterThan(target.sunIntensity);
    for (let i = 0; i < 60; i += 1) easeLook(current, target, 0.5);
    for (const key of SCALAR_KEYS) expect(current[key]).toBeCloseTo(target[key], 9);
    for (const key of COLOR_KEYS) expect(packRgb(current[key])).toBe(packRgb(target[key]));
  });

  it("settles on the exact target colour even when each step is tiny", () => {
    const target = skyLook(sky(0));
    const current = cloneLook(DAY_LOOK);
    for (let i = 0; i < 3000; i += 1) easeLook(current, target, 0.011);
    for (const key of COLOR_KEYS) expect(packRgb(current[key])).toBe(packRgb(target[key]));
  });

  it("does not touch the look it was cloned from", () => {
    const copy = cloneLook(DAY_LOOK);
    easeLook(copy, skyLook(sky(0, "snow")), 1);
    expect(packRgb(DAY_LOOK.fogColor)).toBe(packed(THEME.scene.skyHorizon));
    expect(DAY_LOOK.snow).toBe(0);
  });
});
