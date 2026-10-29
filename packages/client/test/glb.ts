import { readFileSync } from "node:fs";

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";
  min?: number[];
  max?: number[];
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfJson {
  asset: { version: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    skin?: number;
    camera?: number;
    extensions?: Record<string, unknown>;
  }>;
  meshes?: Array<{ name?: string; primitives: GltfPrimitive[] }>;
  materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ mimeType?: string; bufferView?: number }>;
  accessors?: GltfAccessor[];
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  skins?: unknown[];
  animations?: unknown[];
  cameras?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface Glb {
  bytes: number;
  version: number;
  json: GltfJson;
  bin: Uint8Array;
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;

export function parseGlb(source: Uint8Array): Glb {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb: bad magic");
  const version = view.getUint32(4, true);
  if (view.getUint32(8, true) !== source.byteLength) throw new Error("glb length does not match the file");
  let json: GltfJson | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  for (let at = 12; at < source.byteLength; ) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const chunk = source.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as GltfJson;
    else if (type === 0x004e4942) bin = chunk;
    at += 8 + length;
  }
  if (!json) throw new Error("glb has no JSON chunk");
  return { bytes: source.byteLength, version, json, bin };
}

export function loadGlb(url: URL): Glb {
  return parseGlb(new Uint8Array(readFileSync(url)));
}

// Reads an accessor into a flat array of its components; normalised integers come back in 0..1.
export function readAccessor(glb: Glb, index: number): { count: number; size: number; values: number[] } {
  const accessor = glb.json.accessors?.[index];
  if (!accessor) throw new Error(`missing accessor ${index}`);
  const size = COMPONENTS[accessor.type];
  const bufferView = glb.json.bufferViews?.[accessor.bufferView ?? -1];
  if (!bufferView) throw new Error(`accessor ${index} has no buffer view`);
  const bytesPer = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  if (!bytesPer) throw new Error(`unsupported component type ${accessor.componentType}`);
  const stride = bufferView.byteStride ?? size * bytesPer;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  const values: number[] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < size; c += 1) {
      const at = start + i * stride + c * bytesPer;
      switch (accessor.componentType) {
        case 5126:
          values.push(view.getFloat32(at, true));
          break;
        case 5125:
          values.push(view.getUint32(at, true));
          break;
        case 5123:
          values.push(view.getUint16(at, true) / (accessor.normalized ? 65535 : 1));
          break;
        case 5122:
          values.push(Math.max(view.getInt16(at, true) / (accessor.normalized ? 32767 : 1), accessor.normalized ? -1 : -Infinity));
          break;
        case 5121:
          values.push(view.getUint8(at) / (accessor.normalized ? 255 : 1));
          break;
        default:
          values.push(Math.max(view.getInt8(at) / (accessor.normalized ? 127 : 1), accessor.normalized ? -1 : -Infinity));
      }
    }
  }
  return { count: accessor.count, size, values };
}

export interface GlbNode {
  name: string;
  meshName: string;
  primitives: number;
  triangles: number;
  attributes: string[];
  material: number | undefined;
  hasTexture: boolean;
  identity: boolean;
  positions: { min: [number, number, number]; max: [number, number, number] };
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// One summary per root node, in scene order.
export function rootNodes(glb: Glb): GlbNode[] {
  const { json } = glb;
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  return roots.map((index) => {
    const node = json.nodes?.[index];
    if (!node) throw new Error(`missing node ${index}`);
    const mesh = node.mesh === undefined ? undefined : json.meshes?.[node.mesh];
    const primitives = mesh?.primitives ?? [];
    const first = primitives[0];
    const positions = first ? json.accessors?.[first.attributes.POSITION ?? -1] : undefined;
    const triangleCount = primitives.reduce((sum, primitive) => {
      const accessor = json.accessors?.[primitive.indices ?? primitive.attributes.POSITION ?? -1];
      return sum + (accessor ? accessor.count / 3 : 0);
    }, 0);
    const material = first?.material === undefined ? undefined : json.materials?.[first.material];
    const translation = node.translation ?? [0, 0, 0];
    const rotation = node.rotation ?? [0, 0, 0, 1];
    const scale = node.scale ?? [1, 1, 1];
    const identity =
      !node.matrix || node.matrix.every((value, i) => Math.abs(value - (IDENTITY_MATRIX[i] as number)) < 1e-6)
        ? translation.every((value) => Math.abs(value) < 1e-6) &&
          rotation.every((value, i) => Math.abs(value - (i === 3 ? 1 : 0)) < 1e-6) &&
          scale.every((value) => Math.abs(value - 1) < 1e-6)
        : false;
    return {
      name: node.name ?? "",
      meshName: mesh?.name ?? "",
      primitives: primitives.length,
      triangles: triangleCount,
      attributes: first ? Object.keys(first.attributes).sort() : [],
      material: first?.material,
      hasTexture: Boolean(material?.pbrMetallicRoughness?.baseColorTexture),
      identity: identity && !node.children?.length,
      positions: {
        min: (positions?.min ?? [NaN, NaN, NaN]) as [number, number, number],
        max: (positions?.max ?? [NaN, NaN, NaN]) as [number, number, number],
      },
    };
  });
}

function attribute(glb: Glb, nodeName: string, name: "POSITION" | "COLOR_0"): { count: number; size: number; values: number[] } {
  const { json } = glb;
  const index = json.nodes?.findIndex((node) => node.name === nodeName) ?? -1;
  const meshIndex = json.nodes?.[index]?.mesh;
  const primitive = meshIndex === undefined ? undefined : json.meshes?.[meshIndex]?.primitives[0];
  const accessor = primitive?.attributes[name];
  if (accessor === undefined) throw new Error(`${nodeName} has no ${name}`);
  return readAccessor(glb, accessor);
}

export function colors(glb: Glb, nodeName: string): { count: number; size: number; values: number[] } {
  return attribute(glb, nodeName, "COLOR_0");
}

export function positions(glb: Glb, nodeName: string): { count: number; size: number; values: number[] } {
  return attribute(glb, nodeName, "POSITION");
}
