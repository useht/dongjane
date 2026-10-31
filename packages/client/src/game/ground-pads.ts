import type { BufferGeometry } from "three";
import type { Bounds } from "@dongjane/shared";

// How far outside a pad the hillside eases back to its own height.
export const PAD_FALLOFF = 1.5;

const smoothstep = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

// 1 on a pad, falling to 0 at `falloff` metres from its edge; the strongest pad counts.
export function padWeight(pads: readonly Bounds[], x: number, z: number, falloff = PAD_FALLOFF): number {
  let weight = 0;
  for (const pad of pads) {
    const outside = Math.hypot(Math.max(pad.minX - x, 0, x - pad.maxX), Math.max(pad.minZ - z, 0, z - pad.maxZ));
    weight = Math.max(weight, 1 - smoothstep(0, falloff, outside));
  }
  return weight;
}

// Presses flat pads into the ground (edits `geometry` in place): the venues stand on level floors, so the hillside must not poke
// through them, and it eases back to its own height round the edge. Only normals of vertices the pads reach are redone, so the rest
// of the ground shades exactly as it was baked.
export function levelGround(geometry: BufferGeometry, pads: readonly Bounds[], height: number, falloff = PAD_FALLOFF): BufferGeometry {
  if (pads.length === 0) return geometry;
  const position = geometry.getAttribute("position");
  const changed = new Set<number>();
  for (let i = 0; i < position.count; i += 1) {
    const weight = padWeight(pads, position.getX(i), position.getZ(i), falloff);
    if (weight <= 0) continue;
    const y = position.getY(i);
    const leveled = y + (height - y) * weight;
    if (Math.abs(leveled - y) > 1e-6) {
      position.setY(i, leveled);
      changed.add(i);
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
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
