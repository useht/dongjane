import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { bendNormal, bendPoint } from "../src/game/monk-bend.ts";
import type { MonkAvatar, PartName } from "../src/game/monk-model.ts";

// The jacket and its trim are bent per vertex by the shader, so the geometry in the file is the upright one. This is the geometry as
// the shader draws it for a monk bowing by `bend` (its position and its normals bent, the rest shared), to measure on the CPU.
export function bentGeometry(source: BufferGeometry, bend: { theta: number; gather: number }): BufferGeometry {
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  const points = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  const out = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position as never, i);
    n.fromBufferAttribute(normal as never, i);
    bendPoint(p, bend.theta, bend.gather, out).toArray(points, i * 3);
    bendNormal(p, n, bend.theta, bend.gather, out).toArray(normals, i * 3);
  }
  const geometry = new BufferGeometry();
  for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name));
  geometry.setIndex(source.index);
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return geometry;
}

// A part's geometry as this monk draws it now.
export function shownGeometry(avatar: MonkAvatar, part: PartName, geometry: BufferGeometry): BufferGeometry {
  return part === "jacket" || part === "trim" ? bentGeometry(geometry, avatar.bend) : geometry;
}
