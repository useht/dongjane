import { readFileSync } from "node:fs";
import { BufferGeometry, Group, type Material, Mesh, MeshStandardMaterial, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { BUDDHA_MESHES, HALL_MESHES, MONK_PARTS, TEXTURED } from "../src/assets/contract.ts";
import { MODELS, type ModelKey, type ModelLoader, collectMeshes, loadGameAssets, textureOf } from "../src/assets/registry.ts";

const NAMES = { monk: MONK_PARTS, hall: HALL_MESHES, buddha: BUDDHA_MESHES } as const;
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
    const root = group(HALL_MESHES.filter((name) => name !== "sky"));
    expect(() => collectMeshes(root, "hall")).toThrow('hall.glb: missing mesh "sky"');
  });

  it("rejects a textured mesh that lost its texture", () => {
    expect(() => collectMeshes(group(HALL_MESHES, false), "hall")).toThrow(/has no texture/);
  });
});

describe("textureOf", () => {
  it("returns the colour map of the mesh", () => {
    const map = new Texture();
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map }));
    expect(textureOf(mesh)).toBe(map);
  });
});

describe("loadGameAssets", () => {
  it("serves one glb per model", () => {
    expect(Object.keys(MODELS).sort()).toEqual(["buddha", "hall", "monk"]);
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

  it("gives the hall's cushion prototypes a texture only on the top", async () => {
    const { hall } = (await loadGameAssets(diskLoader())).models;
    expect(textureOf(hall.cushionTop)).toBeInstanceOf(Texture);
    expect(hall.cushionBody.geometry.hasAttribute("color")).toBe(true);
  });

  it("releases the geometries, materials and textures it owns", async () => {
    const assets = await loadGameAssets(diskLoader());
    let geometries = 0;
    let textures = 0;
    const owned = new Set<Material>();
    const released = new Set<Material>();
    for (const meshes of Object.values(assets.models) as Array<Record<string, Mesh>>) {
      for (const mesh of Object.values(meshes)) {
        mesh.geometry.addEventListener("dispose", () => (geometries += 1));
        if (textured.includes(mesh.name)) textureOf(mesh).addEventListener("dispose", () => (textures += 1));
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          owned.add(material);
          material.addEventListener("dispose", () => released.add(material));
        }
      }
    }
    assets.dispose();
    expect(geometries).toBe(MONK_PARTS.length + HALL_MESHES.length + BUDDHA_MESHES.length);
    expect(textures).toBe(TEXTURED.length);
    expect(owned.size).toBeGreaterThan(0);
    expect(released).toEqual(owned);
  });

  it("names the model that fails to load and keeps the cause", async () => {
    const disk = diskLoader();
    const broken: ModelLoader = {
      loadAsync: (url) => (url === MODELS.hall ? Promise.reject(new Error("offline")) : disk.loadAsync(url)),
    };
    const failure = await loadGameAssets(broken).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("hall.glb: could not be loaded");
    expect(((failure as Error).cause as Error).message).toBe("offline");
  });
});
