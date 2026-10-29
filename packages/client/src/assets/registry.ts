import type { Material, Mesh, MeshStandardMaterial, Object3D, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BUDDHA_MESHES, HALL_MESHES, MONK_PARTS, TEXTURED } from "./contract.ts";
import buddhaUrl from "./models/buddha.glb?url";
import hallUrl from "./models/hall.glb?url";
import monkUrl from "./models/monk.glb?url";

export const MODELS = { monk: monkUrl, hall: hallUrl, buddha: buddhaUrl } as const;

export type ModelKey = keyof typeof MODELS;

const NAMES = { monk: MONK_PARTS, hall: HALL_MESHES, buddha: BUDDHA_MESHES } as const;

// The glTF materials are placeholders: the game builds its own and only borrows the texture.
export type ModelMeshes<K extends ModelKey> = { readonly [Name in (typeof NAMES)[K][number]]: Mesh };

export interface GameAssets {
  readonly models: { readonly [K in ModelKey]: ModelMeshes<K> };
  dispose(): void;
}

export interface ModelLoader {
  loadAsync(url: string): Promise<{ scene: Object3D }>;
}

const textured: readonly string[] = TEXTURED;

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export function textureOf(mesh: Mesh): Texture {
  for (const material of materialsOf(mesh)) {
    const { map } = material as MeshStandardMaterial;
    if (map) return map;
  }
  throw new Error(`mesh "${mesh.name}" has no texture`);
}

export function collectMeshes<K extends ModelKey>(root: Object3D, key: K): ModelMeshes<K> {
  const found = new Map<string, Mesh>();
  root.traverse((object) => {
    if ((object as Mesh).isMesh) found.set(object.name, object as Mesh);
  });
  const meshes: Record<string, Mesh> = {};
  for (const name of NAMES[key]) {
    const mesh = found.get(name);
    if (!mesh) throw new Error(`${key}.glb: missing mesh "${name}"`);
    if (textured.includes(name)) textureOf(mesh);
    meshes[name] = mesh;
  }
  return meshes as ModelMeshes<K>;
}

function disposeMeshes(meshes: Readonly<Record<string, Mesh>>): void {
  for (const mesh of Object.values(meshes)) {
    mesh.geometry.dispose();
    for (const material of materialsOf(mesh)) {
      (material as MeshStandardMaterial).map?.dispose();
      material.dispose();
    }
  }
}

export async function loadGameAssets(loader: ModelLoader = new GLTFLoader()): Promise<GameAssets> {
  const load = async <K extends ModelKey>(key: K): Promise<ModelMeshes<K>> => {
    const { scene } = await loader.loadAsync(MODELS[key]).catch((cause: unknown) => {
      throw new Error(`${key}.glb: could not be loaded`, { cause });
    });
    return collectMeshes(scene, key);
  };
  const [monk, hall, buddha] = await Promise.all([load("monk"), load("hall"), load("buddha")]);
  return {
    models: { monk, hall, buddha },
    dispose(): void {
      for (const meshes of [monk, hall, buddha]) disposeMeshes(meshes);
    },
  };
}
