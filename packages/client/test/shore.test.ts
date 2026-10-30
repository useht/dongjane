import { BufferGeometry, Float32BufferAttribute } from "three";
import { PLAZA, SEA_LINE_X, SHORE } from "@dongjane/shared";
import { describe, expect, it } from "vitest";
import { LANDSCAPE_BOUNDS } from "../src/game/landscape-layout.ts";
import {
  BEACH_SPAN,
  COAST_X,
  GROUND_UNDER,
  SAND_AREA,
  SAND_Y,
  SEA_AREA,
  SEA_FLOOR_Y,
  WATER_Y,
  beachHeight,
  buildSand,
  buildSea,
  carveGround,
  carvedGroundHeight,
  sandAlpha,
  seaDepth,
  withoutEastHillside,
  withoutTriangles,
} from "../src/game/shore.ts";
import { DAY_LOOK } from "../src/game/sky-look.ts";
import { THEME } from "../src/theme.ts";
import { type Glb, loadGlb, readAccessor } from "./glb.ts";

const world = loadGlb(new URL("../src/assets/models/world.glb", import.meta.url));

function worldGeometry(glb: Glb, name: string): BufferGeometry {
  const node = glb.json.nodes?.find((candidate) => candidate.name === name);
  const primitive = node?.mesh === undefined ? undefined : glb.json.meshes?.[node.mesh]?.primitives[0];
  if (!primitive) throw new Error(`no mesh ${name}`);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(readAccessor(glb, primitive.attributes.POSITION as number).values, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(readAccessor(glb, primitive.attributes.NORMAL as number).values, 3));
  if (primitive.indices !== undefined) geometry.setIndex(readAccessor(glb, primitive.indices).values);
  return geometry;
}

function patch(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 20, 1, 0, 21, 1, 0, 20, 1, 1], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  return geometry;
}

describe("the beach's profile", () => {
  it("is level sand from the plaza to the coast, then slopes down to the sea floor and never rises again", () => {
    expect(beachHeight(SHORE.minX)).toBe(SAND_Y);
    expect(beachHeight(COAST_X)).toBe(SAND_Y);
    expect(beachHeight(COAST_X + BEACH_SPAN)).toBe(SEA_FLOOR_Y);
    expect(beachHeight(SEA_AREA.maxX)).toBe(SEA_FLOOR_Y);
    let last = Number.POSITIVE_INFINITY;
    for (let x = SHORE.minX; x <= SEA_AREA.maxX; x += 0.1) {
      const height = beachHeight(x);
      expect(height).toBeLessThanOrEqual(last);
      last = height;
    }
  });

  it("meets the water at the line the sim stops the walkers at", () => {
    expect(Math.abs(beachHeight(SEA_LINE_X) - WATER_Y)).toBeLessThan(0.05);
    expect(seaDepth(SEA_LINE_X - 1)).toBe(0);
    expect(seaDepth(SEA_LINE_X + 4)).toBeGreaterThan(0.5);
    expect(seaDepth(SEA_AREA.maxX)).toBeCloseTo(-SEA_FLOOR_Y);
  });

  it("keeps the whole walkable shore dry sand", () => {
    for (let x = SHORE.minX; x <= SHORE.maxX; x += 0.25) expect(beachHeight(x)).toBeGreaterThanOrEqual(-0.06);
  });
});

describe("cutting the shore into the baked ground", () => {
  it("leaves the plaza's paving and everything west of it exactly as baked", () => {
    for (const natural of [-0.1, 0, 0.3, 5]) {
      for (const x of [-60, -8, 0, PLAZA.maxX - 0.01, PLAZA.maxX]) expect(carvedGroundHeight(x, 6, natural)).toBe(natural);
    }
  });

  it("only ever lowers the ground", () => {
    for (let x = PLAZA.maxX; x <= 70; x += 1.7) {
      for (let z = -40; z <= 60; z += 3.1) {
        for (const natural of [-1, 0, 2, 9]) expect(carvedGroundHeight(x, z, natural)).toBeLessThanOrEqual(natural + 1e-9);
      }
    }
  });

  it("presses a high hillside under the sand along its whole length and keeps the sea floor below the water", () => {
    for (let x = PLAZA.maxX + 1.2; x <= SAND_AREA.maxX; x += 0.5) {
      for (let z = SAND_AREA.minZ; z <= SAND_AREA.maxZ; z += 1.5) {
        expect(carvedGroundHeight(x, z, 9)).toBeLessThanOrEqual(beachHeight(x) - GROUND_UNDER + 1e-9);
      }
    }
    for (let x = SEA_LINE_X + 2; x <= 100; x += 3) {
      for (let z = SAND_AREA.minZ; z <= SAND_AREA.maxZ; z += 3) expect(carvedGroundHeight(x, z, 9)).toBeLessThan(WATER_Y - 0.3);
    }
    for (const z of [-30, 6, 50]) {
      for (let x = COAST_X + 7; x <= 100; x += 3) expect(carvedGroundHeight(x, z, 9)).toBeLessThan(WATER_Y - 0.3);
    }
  });

  it("lets the hillside rise gently beside the sand instead of standing as a wall", () => {
    const edge = SAND_AREA.maxZ;
    let last = carvedGroundHeight(PLAZA.maxX + 3, edge, 9);
    for (let beside = 0.5; beside <= 20; beside += 0.5) {
      const height = carvedGroundHeight(PLAZA.maxX + 3, edge + beside, 9);
      expect(height).toBeGreaterThanOrEqual(last);
      expect(height - last).toBeLessThan(0.3);
      last = height;
    }
  });

  it("carves a copy of the real ground without touching the plaza's vertices or its baked shading", () => {
    const ground = worldGeometry(world, "ground");
    const before = ground.getAttribute("position").array.slice() as Float32Array;
    const baked = ground.getAttribute("normal").array.slice() as Float32Array;
    const carved = carveGround(ground);
    expect(ground.getAttribute("position").array).toEqual(before);
    const position = carved.getAttribute("position");
    const normal = carved.getAttribute("normal");
    expect(position.count).toBe(ground.getAttribute("position").count);
    let lowered = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = position.getY(i);
      if (x < PLAZA.maxX - 3) {
        expect(y).toBe(before[i * 3 + 1]);
        for (let c = 0; c < 3; c += 1) expect(normal.getComponent(i, c)).toBe(baked[i * 3 + c]);
      }
      if (y < (before[i * 3 + 1] as number) - 1e-6) lowered += 1;
      if (x > SAND_AREA.minX + 1.2 && x < SAND_AREA.maxX && z > SAND_AREA.minZ && z < SAND_AREA.maxZ) expect(y).toBeLessThanOrEqual(beachHeight(x) - GROUND_UNDER + 1e-6);
      if (x > COAST_X + 7) expect(y).toBeLessThan(WATER_Y);
    }
    expect(lowered).toBeGreaterThan(50);
  });

  it("keeps the carved ground shaded from above", () => {
    const carved = carveGround(worldGeometry(world, "ground"));
    const position = carved.getAttribute("position");
    const normal = carved.getAttribute("normal");
    for (let i = 0; i < position.count; i += 1) {
      if (position.getX(i) > PLAZA.maxX && position.getX(i) < SEA_AREA.maxX) expect(normal.getY(i)).toBeGreaterThan(0.2);
    }
  });
});

describe("the hillside east of the plaza", () => {
  it("drops the triangles whose middle is east of the paving and keeps the rest, sharing the vertices", () => {
    const source = patch();
    const kept = withoutEastHillside(source);
    expect(kept.index?.count).toBe(3);
    expect(kept.getAttribute("position")).toBe(source.getAttribute("position"));
    expect(Array.from(kept.index?.array ?? [])).toEqual([0, 1, 2]);
  });

  it("drops by any rule it is given, and keeps a geometry with no index whole when nothing is dropped", () => {
    const none = withoutTriangles(patch(), () => false);
    expect(none.index?.count).toBe(6);
    const all = withoutTriangles(patch(), () => true);
    expect(all.index?.count).toBe(0);
  });

  it("leaves no tree or boulder over the sand or in the water", () => {
    for (const name of ["pine", "maple", "rocks"]) {
      const full = worldGeometry(world, name);
      const cut = withoutEastHillside(full);
      expect(cut.index?.count ?? 0).toBeLessThanOrEqual(full.index?.count ?? 0);
      const position = cut.getAttribute("position");
      const index = cut.index;
      for (let i = 0; i < (index?.count ?? 0); i += 1) {
        const vertex = index?.getX(i) as number;
        const x = position.getX(vertex);
        const y = position.getY(vertex);
        if (y > 0.3) expect(x, `${name} vertex at ${x.toFixed(1)}, ${y.toFixed(1)}`).toBeLessThan(SAND_AREA.minX + 3);
      }
    }
  });

  it("really does cut something away from the baked trees", () => {
    const full = worldGeometry(world, "pine");
    expect(withoutEastHillside(full).index?.count).toBeLessThan(full.index?.count as number);
  });
});

describe("the sand", () => {
  const sand = buildSand();
  const position = sand.getAttribute("position");
  const normal = sand.getAttribute("normal");
  const color = sand.getAttribute("color");

  it("covers the walkable shore and runs a little past it on every side", () => {
    sand.computeBoundingBox();
    const box = sand.boundingBox;
    expect(box?.min.x).toBeLessThanOrEqual(PLAZA.maxX);
    expect(box?.max.x).toBeGreaterThanOrEqual(SEA_LINE_X);
    expect(box?.min.z).toBeLessThan(SHORE.minZ);
    expect(box?.max.z).toBeGreaterThan(SHORE.maxZ);
  });

  it("follows the beach's height and faces up", () => {
    for (let i = 0; i < position.count; i += 1) {
      expect(position.getY(i)).toBeCloseTo(beachHeight(position.getX(i)), 6);
      expect(normal.getY(i)).toBeGreaterThan(0.9);
    }
  });

  it("is opaque over the shore and fades out toward the plaza and the flanks, so the grass shows through its edge", () => {
    expect(color.itemSize).toBe(4);
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const alpha = color.getW(i);
      expect(alpha).toBeCloseTo(sandAlpha(x, z), 4);
      if (x >= PLAZA.maxX + 1.5 && z >= SHORE.minZ && z <= SHORE.maxZ) expect(alpha).toBeGreaterThan(0.95);
    }
    expect(sandAlpha(SAND_AREA.minX, 6)).toBe(0);
    expect(sandAlpha(SEA_LINE_X, SAND_AREA.minZ)).toBe(0);
    expect(sandAlpha(SEA_LINE_X, SAND_AREA.maxZ)).toBe(0);
  });

  it("is paler where it is dry than where the waves wet it, and uses only the theme's sands", () => {
    const hex = (value: string): number => Number.parseInt(value.slice(1), 16);
    const bright = (r: number, g: number, b: number): number => r + g + b;
    let dry = 0;
    let wet = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (position.getX(i) <= SAND_AREA.minX + 1) dry = Math.max(dry, bright(color.getX(i), color.getY(i), color.getZ(i)));
      if (position.getX(i) >= SEA_LINE_X - 0.5) wet = Math.max(wet, bright(color.getX(i), color.getY(i), color.getZ(i)));
    }
    expect(wet).toBeLessThan(dry);
    expect(hex(THEME.scene.sand)).not.toBe(hex(THEME.scene.sandWet));
  });
});

describe("the sea", () => {
  it("runs from just inside the waterline out beyond where the fog swallows everything", () => {
    const sea = buildSea(false);
    sea.computeBoundingBox();
    expect(sea.boundingBox?.min.x).toBeLessThan(SEA_LINE_X);
    const farthest = (sea.boundingBox?.max.x as number) - LANDSCAPE_BOUNDS.maxX;
    expect(farthest).toBeGreaterThan(DAY_LOOK.fogFar);
    expect(sea.boundingBox?.min.z).toBeLessThan(-DAY_LOOK.fogFar);
    expect(sea.boundingBox?.max.z).toBeGreaterThan(DAY_LOOK.fogFar + LANDSCAPE_BOUNDS.maxZ);
  });

  it("is flat at the water's level and faces up, with its ripples laid by world metres", () => {
    for (const weak of [false, true]) {
      const sea = buildSea(weak);
      const position = sea.getAttribute("position");
      const normal = sea.getAttribute("normal");
      const uv = sea.getAttribute("uv");
      for (let i = 0; i < position.count; i += 1) {
        expect(position.getY(i)).toBe(WATER_Y);
        expect(normal.getY(i)).toBeCloseTo(1, 5);
        expect(uv.getX(i) * 8).toBeCloseTo(position.getX(i), 4);
        expect(uv.getY(i) * 8).toBeCloseTo(position.getZ(i), 4);
      }
    }
  });

  it("is clear in the shallows and deep and nearly opaque farther out; a weak device gets it opaque and with fewer lines", () => {
    const sea = buildSea(false);
    const color = sea.getAttribute("color");
    expect(color.itemSize).toBe(4);
    const alphas = Array.from({ length: color.count }, (_, i) => color.getW(i));
    expect(Math.min(...alphas)).toBeLessThan(0.5);
    expect(alphas[alphas.length - 1]).toBeGreaterThan(0.9);
    const weak = buildSea(true);
    expect(weak.getAttribute("color").itemSize).toBe(3);
    expect(weak.getAttribute("position").count).toBeLessThan(sea.getAttribute("position").count);
  });

  it("is a handful of triangles, whatever the device", () => {
    expect((buildSea(false).index?.count ?? 0) / 3).toBeLessThanOrEqual(80);
    expect((buildSea(true).index?.count ?? 0) / 3).toBeLessThanOrEqual(40);
  });
});
