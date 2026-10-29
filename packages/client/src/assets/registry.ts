import type { Material, Mesh, MeshStandardMaterial, Object3D, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DHARMA_MESHES, GATBAWI_MESHES, MONK_PARTS, TEXTURED, VENUE_MESHES, WORLD_MESHES } from "./contract.ts";
import dharmaUrl from "./models/dharma.glb?url";
import gatbawiUrl from "./models/gatbawi.glb?url";
import monkUrl from "./models/monk.glb?url";
import venueUrl from "./models/venue.glb?url";
import worldUrl from "./models/world.glb?url";

export const MODELS = { monk: monkUrl, gatbawi: gatbawiUrl, world: worldUrl, venue: venueUrl, dharma: dharmaUrl } as const;

export type ModelKey = keyof typeof MODELS;

// The models the first frame needs; the 법당's inside is fetched when someone is about to enter it.
export type EagerKey = Exclude<ModelKey, "dharma">;

const NAMES = { monk: MONK_PARTS, gatbawi: GATBAWI_MESHES, world: WORLD_MESHES, venue: VENUE_MESHES, dharma: DHARMA_MESHES } as const;

// The glTF materials are placeholders: the game builds its own and only borrows the textures.
export type ModelMeshes<K extends ModelKey> = { readonly [Name in (typeof NAMES)[K][number]]: Mesh };

export interface GameAssets {
  readonly models: { readonly [K in EagerKey]: ModelMeshes<K> };
  // Fetches the 법당's inside once; a failed fetch is not remembered, so asking again retries it.
  loadDharma(): Promise<ModelMeshes<"dharma">>;
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

// The normal map the glb gave the mesh, if it has one.
export function normalOf(mesh: Mesh): Texture | null {
  for (const material of materialsOf(mesh)) {
    const { normalMap } = material as MeshStandardMaterial;
    if (normalMap) return normalMap;
  }
  return null;
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

// Meshes of one glb share textures, so each is released once.
function disposeMeshes(meshes: Readonly<Record<string, Mesh>>): void {
  const textures = new Set<Texture>();
  for (const mesh of Object.values(meshes)) {
    mesh.geometry.dispose();
    for (const material of materialsOf(mesh)) {
      const { map, normalMap } = material as MeshStandardMaterial;
      if (map) textures.add(map);
      if (normalMap) textures.add(normalMap);
      material.dispose();
    }
  }
  for (const texture of textures) texture.dispose();
}

export async function loadGameAssets(loader: ModelLoader = new GLTFLoader()): Promise<GameAssets> {
  const load = async <K extends ModelKey>(key: K): Promise<ModelMeshes<K>> => {
    const { scene } = await loader.loadAsync(MODELS[key]).catch((cause: unknown) => {
      throw new Error(`${key}.glb: could not be loaded`, { cause });
    });
    return collectMeshes(scene, key);
  };
  const [monk, gatbawi, world, venue] = await Promise.all([load("monk"), load("gatbawi"), load("world"), load("venue")]);
  let pending: Promise<ModelMeshes<"dharma">> | null = null;
  let dharma: ModelMeshes<"dharma"> | null = null;
  return {
    models: { monk, gatbawi, world, venue },
    loadDharma(): Promise<ModelMeshes<"dharma">> {
      if (!pending) {
        const request = load("dharma");
        pending = request;
        request.then(
          (meshes) => {
            if (pending === request) dharma = meshes;
          },
          () => {
            if (pending === request) pending = null;
          },
        );
      }
      return pending;
    },
    dispose(): void {
      for (const meshes of [monk, gatbawi, world, venue]) disposeMeshes(meshes);
      if (dharma) disposeMeshes(dharma);
      else void pending?.then((meshes) => disposeMeshes(meshes), () => undefined);
    },
  };
}
