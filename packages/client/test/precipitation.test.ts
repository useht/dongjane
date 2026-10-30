import { describe, expect, it } from "vitest";
import type { BufferAttribute, LineSegments, Points, Texture } from "three";
import { Precipitation } from "../src/game/precipitation.ts";

const RANGE = 14;
const SPAN = RANGE * 2;
const WHITE = 0xffffff;

type Drop = [number, number, number];

function drops(precipitation: Precipitation, kind: "rain" | "snow"): Drop[] {
  const object = precipitation.group.getObjectByName(kind) as Points | LineSegments;
  const position = object.geometry.getAttribute("position") as BufferAttribute;
  const stride = kind === "rain" ? 2 : 1;
  const visible = object.geometry.drawRange.count / stride;
  return Array.from({ length: visible }, (_, i): Drop => [position.getX(i * stride), position.getY(i * stride), position.getZ(i * stride)]);
}

function fresh(count: number): Precipitation {
  return new Precipitation(count, {} as Texture);
}

describe("Precipitation", () => {
  it("falls only around the spot the camera is aimed at", () => {
    const precipitation = fresh(200);
    const focus = { x: -12, z: 20 };
    precipitation.update(0.5, 1, 1, 0, WHITE, focus);
    for (const [x, , z] of drops(precipitation, "rain")) {
      expect(x).toBeGreaterThanOrEqual(focus.x - RANGE - 1e-6);
      expect(x).toBeLessThanOrEqual(focus.x + RANGE + 1e-6);
      expect(z).toBeGreaterThanOrEqual(focus.z - RANGE - 1e-6);
      expect(z).toBeLessThanOrEqual(focus.z + RANGE + 1e-6);
    }
  });

  it("keeps each drop in place as the aim moves, the square sliding under it", () => {
    const precipitation = fresh(200);
    precipitation.update(0.5, 1, 1, 0, WHITE, { x: 0, z: 0 });
    const before = drops(precipitation, "rain");
    precipitation.update(0, 1, 1, 0, WHITE, { x: 3.5, z: -2 });
    const after = drops(precipitation, "rain");
    expect(after).toHaveLength(before.length);
    before.forEach(([x0, , z0], i) => {
      const [x1, , z1] = after[i] as Drop;
      const dx = (((x1 - x0) % SPAN) + SPAN) % SPAN;
      const dz = (((z1 - z0) % SPAN) + SPAN) % SPAN;
      expect(Math.min(dx, SPAN - dx)).toBeLessThan(1e-6);
      expect(Math.min(dz, SPAN - dz)).toBeLessThan(1e-6);
    });
  });

  it("is not stuck to the first aim: far from it, drops fall on both sides of the new spot", () => {
    const precipitation = fresh(400);
    precipitation.update(0.5, 1, 1, 0, WHITE, { x: 0, z: 0 });
    precipitation.update(0, 1, 1, 0, WHITE, { x: 9, z: 14 });
    const rain = drops(precipitation, "rain");
    expect(rain.some(([x]) => x > 9)).toBe(true);
    expect(rain.some(([x]) => x < 9)).toBe(true);
    expect(rain.some(([, , z]) => z > 14)).toBe(true);
    expect(rain.some(([, , z]) => z < 14)).toBe(true);
  });

  it("puts the snow around the same spot", () => {
    const precipitation = fresh(120);
    const focus = { x: 5, z: -4 };
    precipitation.update(0.5, 1, 0, 1, WHITE, focus);
    for (const [x, , z] of drops(precipitation, "snow")) {
      expect(Math.abs(x - focus.x)).toBeLessThanOrEqual(RANGE + 1);
      expect(Math.abs(z - focus.z)).toBeLessThanOrEqual(RANGE + 1);
    }
  });
});
