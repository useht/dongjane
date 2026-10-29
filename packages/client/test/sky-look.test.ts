import { describe, expect, it } from "vitest";
import type { SkyState, Weather } from "@dongjane/shared";
import {
  COLOR_KEYS,
  DAY_LOOK,
  SCALAR_KEYS,
  cloneLook,
  easeLook,
  packRgb,
  skyLook,
} from "../src/game/sky-look.ts";

const sky = (daylight: number, weather: Weather = "clear"): SkyState => ({
  hour: 12,
  daylight,
  period: daylight >= 1 ? "day" : daylight <= 0 ? "night" : "dawn",
  weather,
});

describe("skyLook at full daylight and clear weather", () => {
  const look = skyLook(sky(1));

  it("matches the hall as it was before the sky followed the clock", () => {
    expect(look.sunIntensity).toBe(3.1);
    expect(packRgb(look.sunColor)).toBe(0xffd8a0);
    expect(look.hemisphereIntensity).toBe(1.25);
    expect(packRgb(look.hemisphereSky)).toBe(0xffe2b4);
    expect(packRgb(look.hemisphereGround)).toBe(0x6b4a2a);
    expect(packRgb(look.background)).toBe(0x1c120b);
    expect(packRgb(look.fogColor)).toBe(0x2a1a10);
    expect(look.fogNear).toBe(16);
    expect(look.fogFar).toBe(42);
    expect(look.sunbeamOpacity).toBeCloseTo(0.32, 12);
    expect(look.nightSky).toBe(0);
    expect(look.candleBoost).toBe(1);
    expect(look.cloudCover).toBe(0);
    expect(look.rain).toBe(0);
    expect(look.snow).toBe(0);
  });

  it("is what the hall starts from", () => {
    expect(DAY_LOOK).toEqual(look);
  });
});

describe("skyLook at night", () => {
  it("turns the sunbeams off and shows the night sky", () => {
    for (const weather of ["clear", "cloudy", "rain", "snow"] as const) {
      const look = skyLook(sky(0, weather));
      expect(look.sunbeamOpacity).toBe(0);
      expect(look.nightSky).toBe(1);
    }
  });

  it("is darker than the day and brightens the candles", () => {
    const night = skyLook(sky(0));
    const day = skyLook(sky(1));
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity * 0.2);
    expect(night.hemisphereIntensity).toBeLessThan(day.hemisphereIntensity);
    expect(night.candleBoost).toBeGreaterThan(day.candleBoost);
    expect(night.paperGlow).toBeLessThan(day.paperGlow);
    expect(night.background[2]).toBeGreaterThan(night.background[0]);
  });

  it("has no rain or snow when the weather is clear or cloudy", () => {
    for (const weather of ["clear", "cloudy"] as const) {
      const look = skyLook(sky(0, weather));
      expect(look.rain).toBe(0);
      expect(look.snow).toBe(0);
    }
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

  it("covers the sky with cloud, dims the sun and hides the sunbeams in overcast weather", () => {
    const clear = skyLook(sky(1, "clear"));
    for (const weather of ["cloudy", "rain", "snow"] as const) {
      const look = skyLook(sky(1, weather));
      expect(look.cloudCover).toBeGreaterThan(0.5);
      expect(look.sunIntensity).toBeLessThan(clear.sunIntensity);
      expect(look.sunbeamOpacity).toBeLessThan(clear.sunbeamOpacity);
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

  it("fades the night sky out and the sunbeams in with daylight", () => {
    let nightSky = Infinity;
    let sunbeams = -Infinity;
    for (const daylight of steps) {
      const look = skyLook(sky(daylight));
      expect(look.nightSky).toBeLessThanOrEqual(nightSky);
      expect(look.sunbeamOpacity).toBeGreaterThanOrEqual(sunbeams);
      nightSky = look.nightSky;
      sunbeams = look.sunbeamOpacity;
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
    expect(packRgb(DAY_LOOK.background)).toBe(0x1c120b);
    expect(DAY_LOOK.snow).toBe(0);
  });
});
