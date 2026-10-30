import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { PLAZA, SEA_LINE_X, SHORE } from "@dongjane/shared";
import { THEME } from "../theme.ts";

// The shore is drawn here and not in a Blender model, so the walkable layout can move without a rebuild of the assets. The sand lies
// on the baked ground, which is pressed down under it; past the waterline the ground sinks away into the sea floor, everywhere
// east of the coast, and nothing of the baked hillside stands in the water.

export const SAND_Y = 0.02;
export const WATER_Y = 0;
export const SEA_FLOOR_Y = -2;
// The sand runs level to here, then the beach slopes down over BEACH_SPAN metres to the sea floor.
export const COAST_X = SEA_LINE_X - 0.5;
export const BEACH_SPAN = 9;
export const SAND_AREA = { minX: PLAZA.maxX, maxX: SEA_LINE_X + 4, minZ: SHORE.minZ - 1.4, maxZ: SHORE.maxZ + 1.4 } as const;
export const SEA_AREA = { minX: SEA_LINE_X - 1, maxX: 110, minZ: -80, maxZ: 125 } as const;
// How far the baked ground lies under the sand, and how steeply it may rise again beside the sand.
export const GROUND_UNDER = 0.06;
const SHOULDER_SLOPE = 0.35;
const SHOULDER_EASE = 6;
const CARVE_EDGE = 1.2;
const DUNE_REACH = 26;
const DUNE_SHADE = 1.7;
const SAND_STEP = 0.5;
const SAND_FADE = 1.5;
const WET_REACH = 2.2;
// Water this deep (metres) hides the floor under it.
const OPAQUE_DEPTH = 0.9;
const SHOAL_ALPHA = 0.35;
const DEEP_ALPHA = 0.96;
const DEEP_COLOR_DEPTH = 1.8;
export const SEA_TILE = 8;

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

// The top of the sand and, past the waterline, the floor under the shallows.
export function beachHeight(x: number): number {
  return SAND_Y + (SEA_FLOOR_Y - SAND_Y) * smoothstep(COAST_X, COAST_X + BEACH_SPAN, x);
}

export function seaDepth(x: number): number {
  return Math.max(0, WATER_Y - beachHeight(x));
}

// Where the baked ground of the hillside (`natural` metres high at x, z) lies once the shore is cut into it: level under the sand,
// rising beside it, sinking into the sea past the coast, and untouched under the plaza's paving.
export function carvedGroundHeight(x: number, z: number, natural: number): number {
  const weight = smoothstep(PLAZA.maxX, PLAZA.maxX + CARVE_EDGE, x);
  if (weight <= 0) return natural;
  const beside = Math.max(0, SAND_AREA.minZ - z, z - SAND_AREA.maxZ);
  const limit = beachHeight(x) - GROUND_UNDER + SHOULDER_SLOPE * beside * (1 - smoothstep(COAST_X, COAST_X + SHOULDER_EASE, x));
  return natural + weight * (Math.min(natural, limit) - natural);
}

// How much of the sand's own tone the ground takes on: all of it under and right beside the sand, so the sand's fading edge has no
// seam to show, and none of it DUNE_REACH metres out, where the baked forest floor takes over again. The hillside the shore is cut
// from is baked dark for the shade of its trees, which no longer stand there.
export function duneWeight(x: number, z: number): number {
  const { maxX, minZ, maxZ } = SAND_AREA;
  const outside = Math.hypot(Math.max(0, x - maxX), Math.max(0, minZ - z, z - maxZ));
  return smoothstep(PLAZA.maxX, PLAZA.maxX + CARVE_EDGE, x) * (1 - smoothstep(0, DUNE_REACH, outside));
}

// A copy of the ground with the shore cut into it. Only normals of vertices the cut reaches are redone, so the rest of the
// ground shades exactly as it was baked.
export function carveGround(source: BufferGeometry): BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const dune = new Color(THEME.scene.sand).multiplyScalar(DUNE_SHADE);
  const tone = new Color();
  const changed = new Set<number>();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);
    const carved = carvedGroundHeight(x, z, y);
    if (Math.abs(carved - y) > 1e-6) {
      position.setY(i, carved);
      changed.add(i);
    }
    const weight = duneWeight(x, z);
    if (weight > 0) {
      tone.setRGB(color.getX(i), color.getY(i), color.getZ(i)).lerp(dune, weight);
      color.setXYZ(i, tone.r, tone.g, tone.b);
    }
  }
  const index = geometry.index;
  if (changed.size === 0 || !index) return geometry;
  const dirty = new Set<number>();
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (corners.some((corner) => changed.has(corner))) for (const corner of corners) dirty.add(corner);
  }
  const normal = geometry.getAttribute("normal");
  const baked = new Float32Array(normal.array as Float32Array);
  geometry.computeVertexNormals();
  for (let i = 0; i < normal.count; i += 1) {
    if (!dirty.has(i)) normal.setXYZ(i, baked[i * 3] as number, baked[i * 3 + 1] as number, baked[i * 3 + 2] as number);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// A geometry that shares the source's vertices but draws only the triangles `drop` does not name (by the triangle's middle).
export function withoutTriangles(source: BufferGeometry, drop: (x: number, y: number, z: number) => boolean): BufferGeometry {
  const position = source.getAttribute("position");
  const index = source.index;
  const corners = index ? index.count : position.count;
  const corner = (i: number): number => (index ? index.getX(i) : i);
  const kept: number[] = [];
  for (let t = 0; t < corners; t += 3) {
    const a = corner(t);
    const b = corner(t + 1);
    const c = corner(t + 2);
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    if (!drop(x, y, z)) kept.push(a, b, c);
  }
  const geometry = new BufferGeometry();
  for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name));
  geometry.setIndex(kept);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// Whatever is baked into the hillside east of the plaza's paving (the pines, the maples, the boulders and the outcrop) stands where
// the shore and the sea now are.
export function withoutEastHillside(source: BufferGeometry): BufferGeometry {
  return withoutTriangles(source, (x) => x >= PLAZA.maxX);
}

function noise(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// The alpha of the sand's edge on the plaza side and on both flanks: the baked grass shows through it.
export function sandAlpha(x: number, z: number): number {
  const { minX, minZ, maxZ } = SAND_AREA;
  return Math.min(smoothstep(minX, minX + SAND_FADE, x), smoothstep(minZ, minZ + SAND_FADE, z), smoothstep(maxZ, maxZ - SAND_FADE, z));
}

// The sand of the shore: dry and pale near the plaza, darker where the waves wet it.
export function buildSand(): BufferGeometry {
  const { minX, maxX, minZ, maxZ } = SAND_AREA;
  const { sand, sandWet } = THEME.scene;
  const dry = new Color(sand);
  const wet = new Color(sandWet);
  const tone = new Color();
  const nx = Math.round((maxX - minX) / SAND_STEP);
  const nz = Math.round((maxZ - minZ) / SAND_STEP);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let iz = 0; iz <= nz; iz += 1) {
    for (let ix = 0; ix <= nx; ix += 1) {
      const x = minX + ((maxX - minX) * ix) / nx;
      const z = minZ + ((maxZ - minZ) * iz) / nz;
      positions.push(x, beachHeight(x), z);
      const damp = 0.85 * smoothstep(SEA_LINE_X - WET_REACH, SEA_LINE_X + 0.3, x);
      tone.copy(dry).lerp(wet, damp).multiplyScalar(0.94 + 0.12 * noise(x, z));
      colors.push(tone.r, tone.g, tone.b, sandAlpha(x, z));
    }
  }
  const row = nx + 1;
  for (let iz = 0; iz < nz; iz += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const a = iz * row + ix;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The sea from just inside the waterline to far past where the fog swallows it: clear and pale in the shallows, deep blue out
// beyond. Seen from above, a weak device gets it opaque and with fewer lines.
export function buildSea(weak: boolean): BufferGeometry {
  const { minX, maxX, minZ, maxZ } = SEA_AREA;
  const { seaShoal, seaDeep } = THEME.scene;
  const shoal = new Color(seaShoal);
  const deep = new Color(seaDeep);
  const tone = new Color();
  const lines = weak ? 10 : 20;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= lines; i += 1) {
    const x = minX + (maxX - minX) * (i / lines) ** 2;
    const depth = seaDepth(x);
    tone.copy(shoal).lerp(deep, smoothstep(0, DEEP_COLOR_DEPTH, depth));
    const alpha = weak ? 1 : SHOAL_ALPHA + (DEEP_ALPHA - SHOAL_ALPHA) * smoothstep(0, OPAQUE_DEPTH, depth);
    for (const z of [minZ, maxZ]) {
      positions.push(x, WATER_Y, z);
      if (weak) colors.push(tone.r, tone.g, tone.b);
      else colors.push(tone.r, tone.g, tone.b, alpha);
      uvs.push(x / SEA_TILE, z / SEA_TILE);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, weak ? 3 : 4));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
