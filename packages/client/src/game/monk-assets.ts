import { BufferGeometry, Color, Float32BufferAttribute, type BufferAttribute, type InterleavedBufferAttribute, type Material, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import monkUrl from "../../assets/monk/monk.glb?url";
import monkRig from "../../assets/monk/monk-rig.json";
import { buildItemGeometries } from "./monk-items.ts";
import { BODY_PART_NAMES, type BodyPartName, type PartName } from "./monk-model.ts";

export { monkRig };

export interface MonkAssets {
  parts: Record<PartName, BufferGeometry>;
  rig: typeof monkRig;
}

type Attribute = BufferAttribute | InterleavedBufferAttribute;

function floats(source: Attribute, itemSize: number): Float32BufferAttribute {
  const out = new Float32Array(source.count * itemSize);
  for (let i = 0; i < source.count; i += 1) {
    out[i * itemSize] = source.getX(i);
    out[i * itemSize + 1] = source.getY(i);
    out[i * itemSize + 2] = source.getZ(i);
  }
  return new Float32BufferAttribute(out, itemSize);
}

function materialColor(material: Material | Material[]): Color {
  const first = Array.isArray(material) ? material[0] : material;
  return (first as { color?: Color } | undefined)?.color ?? new Color(1, 1, 1);
}

function bakePiece(mesh: Mesh, part: BodyPartName): BufferGeometry {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  if (!position || !normal) throw new Error(`monk part "${part}" needs positions and normals`);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", floats(position, 3));
  geometry.setAttribute("normal", floats(normal, 3));
  const color = source.getAttribute("color");
  if (color) {
    geometry.setAttribute("color", floats(color, 3));
  } else {
    const tint = materialColor(mesh.material);
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) tint.toArray(colors, i * 3);
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }
  if (source.index) geometry.setIndex(Array.from(source.index.array));
  geometry.applyMatrix4(mesh.matrixWorld);
  return geometry;
}

// Bakes every named part of the loaded scene into its pivot-local frame (node transforms applied).
export function extractMonkParts(scene: Object3D): Record<BodyPartName, BufferGeometry> {
  scene.updateMatrixWorld(true);
  const parts = {} as Record<BodyPartName, BufferGeometry>;
  for (const part of BODY_PART_NAMES) {
    const node = scene.getObjectByName(part);
    if (!node) throw new Error(`monk model is missing the "${part}" part`);
    const pieces: BufferGeometry[] = [];
    node.traverse((child) => {
      if ((child as Mesh).isMesh) pieces.push(bakePiece(child as Mesh, part));
    });
    const geometry = pieces.length > 1 ? mergeGeometries(pieces) : pieces[0];
    if (!geometry) throw new Error(`monk part "${part}" has no mesh`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts[part] = geometry;
  }
  return parts;
}

export async function loadMonkAssets(url: string = monkUrl): Promise<MonkAssets> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return { parts: { ...extractMonkParts(gltf.scene), ...buildItemGeometries() }, rig: monkRig };
}
