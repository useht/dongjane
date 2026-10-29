import { readFileSync } from "node:fs";
import { BufferGeometry, Group, type Material, Mesh, MeshStandardMaterial, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { GATBAWI_MESHES, MONK_PARTS, TEXTURED, WORLD_MESHES } from "../src/assets/contract.ts";
import { MODELS, type ModelKey, type ModelLoader, collectMeshes, loadGameAssets, normalOf, textureOf } from "../src/assets/registry.ts";

const NAMES = { monk: MONK_PARTS, gatbawi: GATBAWI_MESHES, world: WORLD_MESHES } as const;
const textured: readonly string[] = TEXTURED;

function group(names: readonly string[], withMap = true): Group {
  const root = new Group();
  for (const name of names) {
    const material = new MeshStandardMaterial();
    if (withMap && textured.includes(name)) material.map = new Texture();
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.name = name;
    root.add(mesh);
  }
  return root;
}

// Node has no image decoding, so the real glb files are parsed with the textures stubbed out.
function diskLoader(): ModelLoader {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: "stub-textures", loadTexture: () => Promise.resolve(new Texture()) }));
  return {
    async loadAsync(url) {
      const key = (Object.keys(MODELS) as ModelKey[]).find((candidate) => MODELS[candidate] === url);
      if (!key) throw new Error(`unexpected url ${url}`);
      const file = readFileSync(new URL(`../src/assets/models/${key}.glb`, import.meta.url));
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      const gltf = await loader.parseAsync(buffer, "");
      return { scene: gltf.scene };
    },
  };
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

describe("collectMeshes", () => {
  it("finds every contract mesh by name, wherever it sits in the scene", () => {
    const root = new Group();
    const nested = new Group();
    nested.add(group(MONK_PARTS));
    root.add(nested);
    const parts = collectMeshes(root, "monk");
    for (const name of MONK_PARTS) expect(parts[name].name).toBe(name);
  });

  it("names the model and the mesh that is missing", () => {
    const root = group(WORLD_MESHES.filter((name) => name !== "ground"));
    expect(() => collectMeshes(root, "world")).toThrow('world.glb: missing mesh "ground"');
    expect(() => collectMeshes(group(GATBAWI_MESHES.filter((name) => name !== "figure")), "gatbawi")).toThrow('gatbawi.glb: missing mesh "figure"');
  });

  it("rejects a textured mesh that lost its texture", () => {
    expect(() => collectMeshes(group(WORLD_MESHES, false), "world")).toThrow(/has no texture/);
    expect(() => collectMeshes(group(GATBAWI_MESHES, false), "gatbawi")).toThrow(/has no texture/);
  });
});

describe("textureOf and normalOf", () => {
  it("return the colour map and the normal map of the mesh", () => {
    const map = new Texture();
    const normalMap = new Texture();
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map, normalMap }));
    expect(textureOf(mesh)).toBe(map);
    expect(normalOf(mesh)).toBe(normalMap);
  });

  it("report no normal map when the mesh has none", () => {
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: new Texture() }));
    expect(normalOf(mesh)).toBeNull();
  });
});

describe("loadGameAssets", () => {
  it("serves one glb per model", () => {
    expect(Object.keys(MODELS).sort()).toEqual(["gatbawi", "monk", "world"]);
    for (const url of Object.values(MODELS)) expect(url).toMatch(/\.glb$/);
  });

  it("parses the shipped glb files into the meshes the game asks for", async () => {
    const assets = await loadGameAssets(diskLoader());
    for (const key of Object.keys(NAMES) as ModelKey[]) {
      const meshes: Record<string, Mesh> = assets.models[key];
      expect(Object.keys(meshes).sort(), key).toEqual([...NAMES[key]].sort());
      for (const [name, mesh] of Object.entries(meshes)) {
        const attributes = Object.keys(mesh.geometry.attributes);
        expect(attributes, `${key}.${name}`).toContain("position");
        expect(attributes, `${key}.${name}`).toContain(textured.includes(name) ? "uv" : "color");
        if (textured.includes(name)) expect(textureOf(mesh)).toBeInstanceOf(Texture);
      }
    }
  });

  it("gives every photographed surface but the flat woven mat a normal map, and the painted ones none", async () => {
    const { gatbawi, world } = (await loadGameAssets(diskLoader())).models;
    const meshes: Record<string, Mesh> = { ...gatbawi, ...world };
    for (const [name, mesh] of Object.entries(meshes)) {
      if (textured.includes(name) && name !== "mat") expect(normalOf(mesh), name).toBeInstanceOf(Texture);
      else expect(normalOf(mesh), name).toBeNull();
    }
  });

  it("gives the world one textured mat prototype that also carries vertex colour", async () => {
    const { world } = (await loadGameAssets(diskLoader())).models;
    expect(textureOf(world.mat)).toBeInstanceOf(Texture);
    expect(world.mat.geometry.hasAttribute("color")).toBe(true);
    expect(world.mat.geometry.hasAttribute("uv")).toBe(true);
  });

  it("releases every geometry, material and texture it owns exactly once", async () => {
    const assets = await loadGameAssets(diskLoader());
    const geometries = new Map<BufferGeometry, number>();
    const textures = new Map<Texture, number>();
    const owned = new Set<Material>();
    const released = new Set<Material>();
    const watch = <T extends { addEventListener(type: "dispose", listener: () => void): void }>(item: T, counts: Map<T, number>): void => {
      if (counts.has(item)) return;
      counts.set(item, 0);
      item.addEventListener("dispose", () => counts.set(item, (counts.get(item) ?? 0) + 1));
    };
    for (const meshes of Object.values(assets.models) as Array<Record<string, Mesh>>) {
      for (const mesh of Object.values(meshes)) {
        watch(mesh.geometry, geometries);
        for (const material of materialsOf(mesh)) {
          const { map, normalMap } = material as MeshStandardMaterial;
          for (const texture of [map, normalMap]) if (texture) watch(texture, textures);
          owned.add(material);
          material.addEventListener("dispose", () => released.add(material));
        }
      }
    }
    assets.dispose();
    expect(geometries.size).toBe(MONK_PARTS.length + GATBAWI_MESHES.length + WORLD_MESHES.length);
    expect(textures.size).toBeGreaterThanOrEqual(TEXTURED.length);
    expect([...geometries.values()].every((times) => times === 1)).toBe(true);
    expect([...textures.values()].every((times) => times === 1)).toBe(true);
    expect(owned.size).toBeGreaterThan(0);
    expect(released).toEqual(owned);
  });

  it("names the model that fails to load and keeps the cause", async () => {
    const disk = diskLoader();
    const broken: ModelLoader = {
      loadAsync: (url) => (url === MODELS.world ? Promise.reject(new Error("offline")) : disk.loadAsync(url)),
    };
    const failure = await loadGameAssets(broken).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("world.glb: could not be loaded");
    expect(((failure as Error).cause as Error).message).toBe("offline");
  });
});
