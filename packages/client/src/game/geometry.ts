import {
  BufferGeometry,
  Color,
  type ColorRepresentation,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3();

export function placement(p: Placement): Matrix4 {
  tmpPos.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  tmpQuat.setFromEuler(tmpEuler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0));
  tmpScale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  return new Matrix4().compose(tmpPos, tmpQuat, tmpScale);
}

// Collects primitives into one non-indexed geometry with a per-vertex colour, so a whole
// room section or avatar part renders in a single draw call.
export class GeometryBuilder {
  private readonly parts: BufferGeometry[] = [];

  add(source: BufferGeometry, color: ColorRepresentation, at: Placement = {}): this {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    geometry.applyMatrix4(placement(at));
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
    }
    const tint = new Color(color);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    this.parts.push(geometry);
    return this;
  }

  addBuilt(source: BufferGeometry, at: Placement = {}): this {
    const geometry = source.clone();
    geometry.applyMatrix4(placement(at));
    this.parts.push(geometry);
    return this;
  }

  get size(): number {
    return this.parts.length;
  }

  build(): BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error("nothing to merge");
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}
