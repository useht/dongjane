import { readFileSync } from "node:fs";
import { BufferGeometry, Group, type Material, Mesh, MeshStandardMaterial, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { BORROWS_PAVING, BORROWS_STONE, BUDDHA_MESHES, CASINO_MESHES, DHARMA_MESHES, GATBAWI_MESHES, TEXTURED, VENUE_MESHES, WORLD_MESHES } from "../src/assets/contract.ts";
import { MODELS, type ModelKey, type ModelLoader, collectMeshes, headOf, loadGameAssets, normalOf, textureOf } from "../src/assets/registry.ts";

const NAMES = { gatbawi: GATBAWI_MESHES, buddha: BUDDHA_MESHES, world: WORLD_MESHES, venue: VENUE_MESHES, dharma: DHARMA_MESHES, casino: CASINO_MESHES } as const;
const MODEL_KEYS = ["buddha", "casino", "dharma", "gatbawi", "venue", "world"];
const textured: readonly string[] = TEXTURED;
const borrowsStone: readonly string[] = [...BORROWS_STONE, ...BORROWS_PAVING];

const HEAD = { headTop: [0, 1, 0.04], headRadius: 0.074 };

function group(names: readonly string[], withMap = true, extras: Record<string, unknown> = HEAD): Group {
  const root = new Group();
  for (const name of names) {
    const material = new MeshStandardMaterial();
    if (withMap && textured.includes(name)) material.map = new Texture();
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.name = name;
    if (name === "buddha") Object.assign(mesh.userData, extras);
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
    nested.add(group(GATBAWI_MESHES));
    root.add(nested);
    const parts = collectMeshes(root, "gatbawi");
    for (const name of GATBAWI_MESHES) expect(parts[name].name).toBe(name);
  });

  it("names the model and the mesh that is missing", () => {
    const root = group(WORLD_MESHES.filter((name) => name !== "ground"));
    expect(() => collectMeshes(root, "world")).toThrow('world.glb: missing mesh "ground"');
    expect(() => collectMeshes(group(GATBAWI_MESHES.filter((name) => name !== "hatStone")), "gatbawi")).toThrow('gatbawi.glb: missing mesh "hatStone"');
    expect(() => collectMeshes(group([]), "buddha")).toThrow('buddha.glb: missing mesh "buddha"');
  });

  it("rejects a Buddha that does not say where his head is", () => {
    expect(collectMeshes(group(BUDDHA_MESHES), "buddha").buddha.name).toBe("buddha");
    for (const extras of [{}, { headTop: [0, 1, 0] }, { headRadius: 0.07 }, { headTop: [0, 1], headRadius: 0.07 }, { headTop: [0, "1", 0], headRadius: 0.07 }, { headTop: [0, 1, 0], headRadius: 0 }]) {
      expect(() => collectMeshes(group(BUDDHA_MESHES, true, extras), "buddha"), JSON.stringify(extras)).toThrow(/does not say where its head is/);
    }
  });

  it("rejects a textured mesh that lost its texture", () => {
    expect(() => collectMeshes(group(WORLD_MESHES, false), "world")).toThrow(/has no texture/);
    expect(() => collectMeshes(group(BUDDHA_MESHES, false), "buddha")).toThrow(/has no texture/);
  });

  it("lets the hat stone and the pedestal go without a picture: they borrow the rocks'", () => {
    expect(Object.keys(collectMeshes(group(GATBAWI_MESHES, false), "gatbawi")).sort()).toEqual([...GATBAWI_MESHES].sort());
  });

  it("asks the casino for its carpet's picture, but not for the yard's and the road's: they borrow the paving's", () => {
    expect(() => collectMeshes(group(CASINO_MESHES, false), "casino")).toThrow(/mesh "casinoFloor" has no texture/);
    expect(Object.keys(collectMeshes(group(CASINO_MESHES), "casino")).sort()).toEqual([...CASINO_MESHES].sort());
  });
});

describe("headOf", () => {
  it("reads the crown and the head radius off the mesh", () => {
    const mesh = collectMeshes(group(BUDDHA_MESHES), "buddha").buddha;
    expect(headOf(mesh)).toEqual({ top: [0, 1, 0.04], radius: 0.074 });
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
    expect(Object.keys(MODELS).sort()).toEqual(MODEL_KEYS);
    for (const url of Object.values(MODELS)) expect(url).toMatch(/\.glb$/);
  });

  it("parses the shipped glb files into the meshes the game asks for", async () => {
    const assets = await loadGameAssets(diskLoader());
    for (const key of Object.keys(NAMES) as (keyof typeof NAMES)[]) {
      const meshes: Record<string, Mesh> = assets.models[key];
      expect(Object.keys(meshes).sort(), key).toEqual([...NAMES[key]].sort());
      for (const [name, mesh] of Object.entries(meshes)) {
        const attributes = Object.keys(mesh.geometry.attributes);
        expect(attributes, `${key}.${name}`).toContain("position");
        if (borrowsStone.includes(name)) expect(attributes, `${key}.${name}`).toEqual(expect.arrayContaining(["uv", "color"]));
        else expect(attributes, `${key}.${name}`).toContain(textured.includes(name) ? "uv" : "color");
        if (textured.includes(name)) expect(textureOf(mesh)).toBeInstanceOf(Texture);
      }
    }
  });

  it("fetches every glb once at start, the 법당's included, so the first frame can show the room", async () => {
    const disk = diskLoader();
    const asked: string[] = [];
    const watched: ModelLoader = {
      loadAsync: (url) => {
        asked.push(url);
        return disk.loadAsync(url);
      },
    };
    const assets = await loadGameAssets(watched);
    expect(asked.sort()).toEqual(MODEL_KEYS.map((key) => MODELS[key as ModelKey]).sort());
    expect(Object.keys(assets.models).sort()).toEqual(MODEL_KEYS);
    assets.dispose();
  });

  it("gives every photographed surface but the flat woven mat a normal map, and the painted ones none", async () => {
    const { gatbawi, world } = (await loadGameAssets(diskLoader())).models;
    const meshes: Record<string, Mesh> = { ...gatbawi, ...world };
    for (const [name, mesh] of Object.entries(meshes)) {
      if (textured.includes(name) && name !== "mat") expect(normalOf(mesh), name).toBeInstanceOf(Texture);
      else expect(normalOf(mesh), name).toBeNull();
    }
  });

  it("gives the hat stone and the pedestal UVs and vertex colour but no picture, so the game lends them the rocks'", async () => {
    const { gatbawi, world } = (await loadGameAssets(diskLoader())).models;
    for (const mesh of [gatbawi.hatStone, gatbawi.pedestal]) {
      expect(mesh.geometry.hasAttribute("uv"), mesh.name).toBe(true);
      expect(mesh.geometry.hasAttribute("color"), mesh.name).toBe(true);
      expect(() => textureOf(mesh), mesh.name).toThrow(/has no texture/);
      expect(normalOf(mesh), mesh.name).toBeNull();
    }
    expect(textureOf(world.rocks)).toBeInstanceOf(Texture);
    expect(normalOf(world.rocks)).toBeInstanceOf(Texture);
  });

  it("gives the casino's carpet a picture and a normal map, and its yard and road UVs and vertex colour but no picture", async () => {
    const { casino } = (await loadGameAssets(diskLoader())).models;
    expect(textureOf(casino.casinoFloor)).toBeInstanceOf(Texture);
    expect(normalOf(casino.casinoFloor)).toBeInstanceOf(Texture);
    for (const mesh of [casino.casinoYard, casino.coastRoad]) {
      expect(mesh.geometry.hasAttribute("uv"), mesh.name).toBe(true);
      expect(mesh.geometry.hasAttribute("color"), mesh.name).toBe(true);
      expect(() => textureOf(mesh), mesh.name).toThrow(/has no texture/);
      expect(normalOf(mesh), mesh.name).toBeNull();
    }
    for (const mesh of [casino.slotCabinet, casino.rouletteTable, casino.scratchKiosk]) expect(mesh.geometry.hasAttribute("color"), mesh.name).toBe(true);
  });

  it("gives the shipped Buddha one picture, no vertex colour, and the head the game seats the hat stone on", async () => {
    const { buddha } = (await loadGameAssets(diskLoader())).models;
    expect(textureOf(buddha.buddha)).toBeInstanceOf(Texture);
    expect(normalOf(buddha.buddha)).toBeNull();
    expect(buddha.buddha.geometry.hasAttribute("color")).toBe(false);
    const { top, radius } = headOf(buddha.buddha);
    expect(top[1]).toBeCloseTo(1, 2);
    expect(radius).toBeGreaterThan(0.04);
    expect(radius).toBeLessThan(0.12);
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
    expect(geometries.size).toBe(GATBAWI_MESHES.length + BUDDHA_MESHES.length + WORLD_MESHES.length + VENUE_MESHES.length + DHARMA_MESHES.length + CASINO_MESHES.length);
    expect(textures.size).toBeGreaterThanOrEqual(TEXTURED.length);
    expect([...geometries.values()].every((times) => times === 1)).toBe(true);
    expect([...textures.values()].every((times) => times === 1)).toBe(true);
    expect(owned.size).toBeGreaterThan(0);
    expect(released).toEqual(owned);
  });

  it("names the model that fails to load and keeps the cause", async () => {
    const disk = diskLoader();
    for (const key of ["world", "dharma", "casino"] as const) {
      const broken: ModelLoader = {
        loadAsync: (url) => (url === MODELS[key] ? Promise.reject(new Error("offline")) : disk.loadAsync(url)),
      };
      const failure = await loadGameAssets(broken).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(`${key}.glb: could not be loaded`);
      expect(((failure as Error).cause as Error).message).toBe("offline");
    }
  });
});
