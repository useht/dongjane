import { BufferGeometry, Group, HemisphereLight, InstancedMesh, Mesh, MeshStandardMaterial, PointLight, Texture } from "three";
import { describe, expect, it } from "vitest";
import { MACHINE_SPOTS } from "@dongjane/shared";
import { CASINO_MESHES, CASINO_PROTOTYPES } from "../src/assets/contract.ts";
import type { ModelMeshes } from "../src/assets/registry.ts";
import { CASINO_LAMPS, CASINO_LIGHT, CASINO_SHELL } from "../src/game/casino-layout.ts";
import { CasinoScene } from "../src/game/casino.ts";

// Node has no image decoding or GPU: the glb's meshes are stood in for by empty geometries, with a texture where the game asks for one.
function stub(name: string, withMap = false): Mesh {
  const material = new MeshStandardMaterial();
  if (withMap) material.map = new Texture();
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = name;
  return mesh;
}

function meshes(): ModelMeshes<"casino"> {
  return Object.fromEntries(CASINO_MESHES.map((name) => [name, stub(name, name === "casinoFloor")])) as ModelMeshes<"casino">;
}

function build(weak = false): CasinoScene {
  return new CasinoScene(meshes(), stub("ground", true), { weak, anisotropy: 4 });
}

const lightsOf = (scene: CasinoScene): PointLight[] => scene.group.children.filter((child): child is PointLight => child instanceof PointLight);
const hemisphereOf = (scene: CasinoScene): HemisphereLight => scene.group.children.find((child): child is HemisphereLight => child instanceof HemisphereLight) as HemisphereLight;
const meshNamed = (scene: CasinoScene, name: string): Mesh => scene.group.children.find((child) => child.name === name) as Mesh;
const withDistance = (lights: readonly PointLight[], distance: number): PointLight[] => lights.filter((light) => light.distance === distance);

describe("CasinoScene", () => {
  it("draws every mesh of the glb, the three machine prototypes once per machine the layout lays out", () => {
    const scene = build();
    const prototypes: readonly string[] = CASINO_PROTOTYPES;
    for (const name of CASINO_MESHES) {
      const mesh = meshNamed(scene, name);
      expect(mesh, name).toBeInstanceOf(Mesh);
      expect(mesh instanceof InstancedMesh, name).toBe(prototypes.includes(name));
    }
    expect((meshNamed(scene, "slotCabinet") as InstancedMesh).count).toBe(MACHINE_SPOTS.filter((spot) => ["classic", "fiveReel", "luckySeven"].includes(spot.kind)).length);
    expect((meshNamed(scene, "rouletteTable") as InstancedMesh).count).toBe(MACHINE_SPOTS.filter((spot) => spot.kind === "roulette").length);
    expect((meshNamed(scene, "scratchKiosk") as InstancedMesh).count).toBe(MACHINE_SPOTS.filter((spot) => spot.kind === "scratch").length);
  });

  it("lets a tap land on the carpet, the yard and the road, and be stopped by the walls, the columns and the machines", () => {
    const { floors, blockers } = build().surfaces;
    expect(floors.map((floor) => floor.name).sort()).toEqual(["casinoFloor", "casinoYard", "coastRoad"]);
    expect(blockers.map((blocker) => blocker.name)).toEqual(expect.arrayContaining(["casinoWalls", "casinoFront", "casinoRoof", "casinoColumns", "slotCabinet", "rouletteTable", "scratchKiosk"]));
    for (const floor of floors) expect(blockers).not.toContain(floor);
  });

  it("keeps all its lights in the scene and turned off until a visitor comes near", () => {
    const scene = build();
    scene.update(0, true);
    expect(lightsOf(scene)).toHaveLength(CASINO_LAMPS.gold.length + CASINO_LAMPS.pink.length + CASINO_LAMPS.cyan.length + CASINO_LAMPS.sign.length);
    for (const light of lightsOf(scene)) expect(light.intensity).toBe(0);
    expect(hemisphereOf(scene).intensity).toBe(0);
  });

  it("keeps a weak device to one lamp for the room and one for the front", () => {
    const lights = lightsOf(build(true));
    expect(lights).toHaveLength(2);
    expect(withDistance(lights, CASINO_LIGHT.gold.distance)).toHaveLength(1);
    expect(withDistance(lights, CASINO_LIGHT.sign.distance)).toHaveLength(1);
  });

  it("lights the front for a visitor outside who is near, and the room as far as the doorway shows it", () => {
    const scene = build();
    scene.setPresence(0, 1);
    scene.update(0, true);
    const lights = lightsOf(scene);
    for (const light of withDistance(lights, CASINO_LIGHT.sign.distance)) expect(light.intensity).toBeCloseTo(CASINO_LIGHT.sign.intensity, 9);
    for (const light of withDistance(lights, CASINO_LIGHT.gold.distance)) {
      expect(light.intensity).toBeGreaterThan(0);
      expect(light.intensity).toBeLessThan(CASINO_LIGHT.gold.intensity);
    }
    expect(hemisphereOf(scene).intensity, "the room's warm sky only comes up once the camera is in").toBe(0);
  });

  it("lights the room and puts the front's lamp out once the camera is inside", () => {
    const scene = build();
    scene.setPresence(1, 1);
    scene.update(0, true);
    const lights = lightsOf(scene);
    for (const light of withDistance(lights, CASINO_LIGHT.sign.distance)) expect(light.intensity).toBe(0);
    for (const light of withDistance(lights, CASINO_LIGHT.gold.distance)) expect(light.intensity).toBeCloseTo(CASINO_LIGHT.gold.intensity, 9);
    for (const light of withDistance(lights, CASINO_LIGHT.neon.distance)) expect(light.intensity).toBeCloseTo(CASINO_LIGHT.neon.intensity, 9);
    expect(hemisphereOf(scene).intensity).toBeGreaterThan(0);
  });

  it("flickers the neon only while motion is allowed", () => {
    const scene = build();
    scene.setPresence(1, 1);
    const neon = withDistance(lightsOf(scene), CASINO_LIGHT.neon.distance);
    const seen = (reduceMotion: boolean): Set<number> => {
      const values = new Set<number>();
      for (let time = 0; time < 3; time += 0.37) {
        scene.update(time, reduceMotion);
        values.add(neon[0]?.intensity ?? 0);
      }
      return values;
    };
    expect(seen(true).size).toBe(1);
    expect(seen(false).size).toBeGreaterThan(1);
  });

  it("hides the roof, the front wall and the sign for a visitor inside, and the ceiling too once the camera is up among its beams", () => {
    const scene = build();
    const visible = (): Record<string, boolean> => Object.fromEntries(["casinoFront", "casinoRoof", "casinoSign", "casinoCeiling", "casinoWalls", "casinoFloor"].map((name) => [name, meshNamed(scene, name).visible]));
    const all = { casinoFront: true, casinoRoof: true, casinoSign: true, casinoCeiling: true, casinoWalls: true, casinoFloor: true };
    expect(visible()).toEqual(all);
    scene.setCutaway(true, 1.6);
    expect(visible(), "a low camera in the room still sees its ceiling").toEqual({ ...all, casinoFront: false, casinoRoof: false, casinoSign: false });
    scene.setCutaway(true, CASINO_SHELL.ceilingY + 2);
    expect(visible(), "a high camera looks down through the roof and the ceiling").toEqual({ ...all, casinoFront: false, casinoRoof: false, casinoSign: false, casinoCeiling: false });
    scene.setCutaway(false, CASINO_SHELL.ceilingY + 2);
    expect(visible(), "from outside the building is whole whatever the height").toEqual(all);
  });

  it("releases what it made and leaves the loaded glb's geometry alone, and leaves the scene", () => {
    const scene = build();
    const root = new Group();
    root.add(scene.group);
    const geometry = meshNamed(scene, "casinoWalls").geometry;
    let geometryDisposed = false;
    geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });
    const materials = new Set<unknown>();
    scene.group.traverse((object) => {
      if ((object as Mesh).isMesh) materials.add((object as Mesh).material);
    });
    let released = 0;
    for (const material of materials) (material as MeshStandardMaterial).addEventListener("dispose", () => (released += 1));
    scene.dispose();
    expect(released).toBe(materials.size);
    expect(geometryDisposed, "the geometry belongs to the loaded assets").toBe(false);
    expect(scene.group.parent).toBeNull();
    expect(root.children).toHaveLength(0);
  });
});
