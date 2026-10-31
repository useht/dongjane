import {
  ARRIVAL,
  CASINO_AREAS,
  CASINO_YARD,
  COAST_ROAD,
  DEFAULT_ZONE,
  DHARMA_SEATS,
  SEA_LINE_X,
  SHORE,
  VENUES,
  type Bounds,
  type VenueDef,
  type Weather,
} from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { seaLevel } from "../src/audio/sea-level.ts";
import { BEDS, PLACES, SILENCE, VENUE_SOUNDS, ambienceAt, placeAt } from "../src/audio/soundscape.ts";

const WEATHERS: readonly (Weather | null)[] = ["clear", "cloudy", "rain", "snow", null];

const middle = (area: Bounds) => ({ x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 });
const centreOf = (id: string) => middle((PLACES.find((place) => place.id === id)?.areas[0]) as Bounds);

describe("VENUE_SOUNDS", () => {
  it("has a profile for every venue and none for anything else", () => {
    expect(Object.keys(VENUE_SOUNDS).sort()).toEqual(VENUES.map((venue) => venue.id).sort());
  });

  it("names only beds that exist, each as a share between 0 and 1", () => {
    for (const [id, profile] of Object.entries(VENUE_SOUNDS)) {
      for (const [bed, value] of Object.entries(profile)) {
        expect(BEDS, `${id} ${bed}`).toContain(bed);
        expect(value, `${id} ${bed}`).toBeGreaterThanOrEqual(0);
        expect(value, `${id} ${bed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives the wind, the rain and the surf to every open-air venue and to no roofed one", () => {
    for (const venue of VENUES) {
      const profile = VENUE_SOUNDS[venue.id];
      for (const bed of ["wind", "rain", "sea"] as const) {
        if (venue.indoor) expect(profile[bed] ?? 0, `${venue.id} ${bed}`).toBe(0);
        else expect(profile[bed] ?? 0, `${venue.id} ${bed}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("placeAt", () => {
  it("finds every venue at the middle of each of its rooms", () => {
    for (const place of PLACES) {
      for (const area of place.areas) {
        const { x, z } = middle(area);
        expect(placeAt(x, z), place.id).toBe(place.id);
      }
    }
  });

  it("holds every seat and every machine of a venue, so nobody sits or plays under another place's sound", () => {
    for (const venue of VENUES as readonly VenueDef[]) {
      for (const spot of venue.seats?.spots ?? []) expect(placeAt(spot.x, spot.z), `${venue.id} seat`).toBe(venue.id);
      for (const spot of venue.activities ?? []) expect(placeAt(spot.frontX, spot.frontZ), `${venue.id} ${spot.id}`).toBe(venue.id);
    }
  });

  it("finds the venues the rules cannot tell from the open ground", () => {
    expect(placeAt(0, 17.5)).toBe("street");
    expect(placeAt(10, 17)).toBe("street");
    expect(placeAt(15.5, 6)).toBe("shore");
    for (const area of CASINO_AREAS) {
      const { x, z } = middle(area);
      expect(placeAt(x, z)).toBe("casino");
    }
  });

  it("finds the 법당 from the door to the last seat", () => {
    expect(placeAt(ARRIVAL.x, ARRIVAL.z)).toBe("dharma");
    for (const seat of DHARMA_SEATS) expect(placeAt(seat.x, seat.z)).toBe("dharma");
  });

  it("leaves the casino's coast road and yard to the open ground, since only its floor is a room", () => {
    for (const area of [COAST_ROAD, CASINO_YARD]) {
      const { x, z } = middle(area);
      expect(placeAt(x, z)).toBe(DEFAULT_ZONE);
    }
  });

  it("falls back to the open ground outside every venue", () => {
    expect(placeAt(500, 500)).toBe(DEFAULT_ZONE);
    expect(placeAt(Number.NaN, 0)).toBe(DEFAULT_ZONE);
  });

  it("has places that never overlap, so no point can be in two of them", () => {
    const rooms = PLACES.flatMap((place) => place.areas.map((area) => ({ id: place.id, area })));
    for (const [i, a] of rooms.entries()) {
      for (const b of rooms.slice(i + 1)) {
        if (a.id === b.id) continue;
        const across = Math.min(a.area.maxX, b.area.maxX) - Math.max(a.area.minX, b.area.minX);
        const along = Math.min(a.area.maxZ, b.area.maxZ) - Math.max(a.area.minZ, b.area.minZ);
        expect(across > 1e-6 && along > 1e-6, `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });
});

describe("ambienceAt", () => {
  it("is silent in every roofed venue, in every weather, with the video playing or not", () => {
    for (const venue of VENUES.filter((candidate) => candidate.indoor)) {
      const { x, z } = centreOf(venue.id);
      for (const weather of WEATHERS) {
        for (const video of [false, true]) {
          const levels = ambienceAt(venue.id, x, z, weather, video);
          expect(levels.wind, `${venue.id} ${weather} wind`).toBe(0);
          expect(levels.rain, `${venue.id} ${weather} rain`).toBe(0);
          expect(levels.sea, `${venue.id} ${weather} sea`).toBe(0);
          expect(levels.fire, `${venue.id} ${weather} fire`).toBe(0);
        }
      }
    }
  });

  it("keeps the rain, the wind and the surf out of the 법당 wherever the monk is in it", () => {
    for (const spot of [ARRIVAL, ...DHARMA_SEATS]) {
      expect(ambienceAt(placeAt(spot.x, spot.z), spot.x, spot.z, "rain", false)).toEqual(SILENCE);
    }
  });

  it("keeps the surf out of the casino even on its east side, a few steps from the water", () => {
    const aisle = CASINO_AREAS[3] as Bounds;
    const x = aisle.maxX - 0.5;
    const z = (aisle.minZ + aisle.maxZ) / 2;
    expect(SEA_LINE_X - x).toBeLessThan(5);
    expect(ambienceAt(placeAt(x, z), x, z, "clear", false).sea).toBe(0);
  });

  it("rains only in rain weather", () => {
    for (const weather of WEATHERS.filter((candidate) => candidate !== "rain")) {
      for (const venue of VENUES) {
        const { x, z } = centreOf(venue.id);
        expect(ambienceAt(venue.id, x, z, weather, false).rain, `${venue.id} ${weather}`).toBe(0);
      }
    }
  });

  it("rains on the open air and nowhere roofed when it rains", () => {
    for (const venue of VENUES) {
      const { x, z } = centreOf(venue.id);
      const rain = ambienceAt(venue.id, x, z, "rain", false).rain;
      if (venue.indoor) expect(rain, venue.id).toBe(0);
      else expect(rain, venue.id).toBeGreaterThan(0);
    }
  });

  it("lets the concert video drown the wind, the rain and the fire but not the surf or the water", () => {
    const shore = ambienceAt("shore", SEA_LINE_X - 2, 6, "rain", false);
    const shoreVideo = ambienceAt("shore", SEA_LINE_X - 2, 6, "rain", true);
    expect(shore.wind).toBeGreaterThan(0);
    expect(shore.rain).toBeGreaterThan(0);
    expect(shore.sea).toBeGreaterThan(0);
    expect(shoreVideo.wind).toBe(0);
    expect(shoreVideo.rain).toBe(0);
    expect(shoreVideo.sea).toBe(shore.sea);

    const { x: fx, z: fz } = centreOf("bonfire");
    expect(ambienceAt("bonfire", fx, fz, "clear", false).fire).toBeGreaterThan(0);
    expect(ambienceAt("bonfire", fx, fz, "clear", true).fire).toBe(0);

    const { x: bx, z: bz } = centreOf("bathhouse");
    expect(ambienceAt("bathhouse", bx, bz, "clear", true).water).toBe(ambienceAt("bathhouse", bx, bz, "clear", false).water);
  });

  it("gives the bathhouse its water and nothing of the weather", () => {
    const { x, z } = centreOf("bathhouse");
    for (const weather of WEATHERS) {
      expect(ambienceAt("bathhouse", x, z, weather, false)).toEqual({ ...SILENCE, water: 1 });
    }
  });

  it("gives the bonfire its fire under a gentler wind than the open ground", () => {
    const { x, z } = centreOf("bonfire");
    const fire = ambienceAt("bonfire", x, z, "clear", false);
    const open = ambienceAt("gatbawi", x, z, "clear", false);
    expect(fire.fire).toBe(1);
    expect(fire.wind).toBeGreaterThan(0);
    expect(fire.wind).toBeLessThan(open.wind);
    expect(open.fire).toBe(0);
  });

  it("takes the surf from how near the monk is to the water, as seaLevel gives it", () => {
    for (const venue of ["gatbawi", "shore", "street", "bonfire"] as const) {
      for (const x of [SHORE.minX - 20, SHORE.minX - 10, SHORE.minX, SEA_LINE_X - 3, SEA_LINE_X + 2]) {
        expect(ambienceAt(venue, x, 6, "clear", false).sea, `${venue} ${x}`).toBe(seaLevel(x, 6));
      }
    }
    expect(ambienceAt("shore", SEA_LINE_X, 6, "clear", false).sea).toBe(1);
    expect(ambienceAt("shore", SHORE.minX - 40, 6, "clear", false).sea).toBe(0);
  });

  it("keeps every level a finite number from 0 to 1, whatever the position or the weather", () => {
    const spots = [Number.NaN, Number.POSITIVE_INFINITY, -1e9, -30, 0, 6, 18.5, 1e9];
    for (const venue of VENUES) {
      for (const x of spots) {
        for (const z of spots) {
          for (const weather of WEATHERS) {
            const levels = ambienceAt(venue.id, x, z, weather, false);
            for (const bed of BEDS) {
              expect(Number.isFinite(levels[bed]), `${venue.id} ${bed}`).toBe(true);
              expect(levels[bed], `${venue.id} ${bed}`).toBeGreaterThanOrEqual(0);
              expect(levels[bed], `${venue.id} ${bed}`).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it("reads a broken position as no surf, without taking the wind away", () => {
    const levels = ambienceAt("gatbawi", Number.NaN, Number.NaN, "clear", false);
    expect(levels.sea).toBe(0);
    expect(levels.wind).toBe(1);
  });
});
