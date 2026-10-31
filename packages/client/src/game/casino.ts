import {
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  type Intersection,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PointLight,
  Vector3,
} from "three";
import { MACHINE_SIZE, MACHINE_SPOTS, type MachineKind, type MachineSpot } from "@dongjane/shared";
import { type ModelMeshes, normalOf, textureOf } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import { CASINO_LAMPS, CASINO_LIGHT, CASINO_SHELL } from "./casino-layout.ts";
import type { FloorSurfaces } from "./floor-pick.ts";
import { LIFT } from "./landscape.ts";
import { vertexGlowMaterial } from "./vertex-glow.ts";

export interface CasinoQuality {
  weak: boolean;
  anisotropy: number;
}

// The air of the casino's room: the world beyond its open roof falls away into the dark behind it. The room is 29 m deep, so the fog starts past a camera's view of its far wall.
export const CASINO_FOG = { near: 24, far: 62 } as const;

// The inside is lit by its own lamps and a warm hemisphere that comes up as the camera comes in, as the 법당's does.
const HEMISPHERE_LIGHT = 1.25;
// How much of the room's lamps a visitor outside already sees through the door.
const DOORWAY_SHARE = 0.8;
const SIGN_GLOW = 0.9;
const NEON_GLOW = 1.1;
const COLUMN_GLOW = 0.3;
const MACHINE_GLOW = 0.4;
const NEON_FLICKER = 0.06;
// A camera higher than this is among the ceiling's beams or over them (the ceiling's underside is at 4.7).
const CEILING_CUT_Y = CASINO_SHELL.ceilingY - 0.8;

// The size each machine kind was modelled at: the slot cabinets of three kinds are all one prototype, stretched to the width
// of their kind.
const AUTHORED_AS: Readonly<Record<MachineKind, MachineKind>> = {
  classic: "classic",
  fiveReel: "classic",
  luckySeven: "classic",
  roulette: "roulette",
  scratch: "scratch",
};

interface Lamp {
  light: PointLight;
  role: "room" | "neon" | "sign";
  intensity: number;
  phase: number;
}

// The casino at the end of the coast road: the building, its yard and road, the machines inside. Like the 법당 it owns its lights
// and keeps them in the scene all the time (adding or removing one would recompile every material); `setPresence` turns them up
// as a visitor comes near and as the camera comes in. While a visitor is inside, the roof, the front wall and the sign are
// hidden (`setCutaway`), so the camera, which then moves over the whole room, looks down into it.
export class CasinoScene {
  readonly group = new Group();
  // The carpet, the yard and the road a tap can walk to, and the walls and machines that stand on them.
  readonly surfaces: FloorSurfaces;

  private readonly hemisphere: HemisphereLight;
  private readonly lamps: Lamp[] = [];
  private readonly materials: Material[] = [];
  private readonly machines: InstancedMesh[] = [];
  // Which spot each instance of a machine mesh stands for.
  private readonly spotsOf = new Map<object, readonly MachineSpot[]>();
  private readonly cutaway: readonly Mesh[];
  private readonly ceiling: Mesh;
  private inside = 0;
  private near = 0;

  constructor(meshes: ModelMeshes<"casino">, paving: Mesh, quality: CasinoQuality) {
    const { scene: palette, material: tokens } = THEME;
    this.group.name = "casino";

    this.hemisphere = new HemisphereLight(palette.casinoHemiSky, palette.casinoHemiGround, 0);
    this.group.add(this.hemisphere);
    const { gold, neon, sign, decay } = CASINO_LIGHT;
    const lamp = (at: readonly [number, number, number], color: string, role: Lamp["role"], intensity: number, distance: number): void => {
      const light = new PointLight(color, 0, distance, decay);
      light.position.set(...at);
      this.group.add(light);
      this.lamps.push({ light, role, intensity, phase: this.lamps.length * 1.9 });
    };
    // A weak device keeps one lamp for the room and one for the front; every light costs every material in the scene.
    for (const at of quality.weak ? CASINO_LAMPS.gold.slice(0, 1) : CASINO_LAMPS.gold) lamp(at, palette.casinoLampGold, "room", gold.intensity, gold.distance);
    if (!quality.weak) {
      for (const at of CASINO_LAMPS.pink) lamp(at, palette.casinoLampPink, "neon", neon.intensity, neon.distance);
      for (const at of CASINO_LAMPS.cyan) lamp(at, palette.casinoLampCyan, "neon", neon.intensity, neon.distance);
    }
    for (const at of CASINO_LAMPS.sign) lamp(at, palette.casinoSignLight, "sign", sign.intensity, sign.distance);

    const lit = (): MeshLambertMaterial => new MeshLambertMaterial({ vertexColors: true });
    const walls = this.add(meshes.casinoWalls, lit());
    const front = this.add(meshes.casinoFront, lit());
    const roof = this.add(meshes.casinoRoof, lit());
    const ceiling = this.add(meshes.casinoCeiling, lit());
    const columns = this.add(meshes.casinoColumns, vertexGlowMaterial(palette.goldGlow, COLUMN_GLOW));
    const board = this.add(meshes.casinoSign, vertexGlowMaterial(palette.casinoSignLight, SIGN_GLOW));
    this.add(meshes.casinoNeon, vertexGlowMaterial(tokens.casinoCream, NEON_GLOW));

    // The yard and the road wear the plaza's paving picture; the carpet has its own.
    const stone = this.surface(textureOf(paving), normalOf(paving), quality.anisotropy, LIFT.ground);
    const yard = this.add(meshes.casinoYard, stone);
    const road = this.add(meshes.coastRoad, stone);
    const carpet = this.add(meshes.casinoFloor, this.surface(textureOf(meshes.casinoFloor), normalOf(meshes.casinoFloor), quality.anisotropy, 1));

    this.machines.push(...this.buildMachines(meshes));
    this.surfaces = { floors: [carpet, yard, road], blockers: [walls, front, roof, columns, board, ...this.machines] };
    this.cutaway = [front, roof, board];
    this.ceiling = ceiling;
    this.update(0, true);
  }

  private add(source: Mesh, material: Material): Mesh {
    const mesh = new Mesh(source.geometry, material);
    mesh.name = source.name;
    if (!this.materials.includes(material)) this.materials.push(material);
    this.group.add(mesh);
    return mesh;
  }

  // A photograph and, when the glb has one, its normal map, times the colours painted into the vertices.
  private surface(map: ReturnType<typeof textureOf>, normalMap: ReturnType<typeof normalOf>, anisotropy: number, lift: number): MeshLambertMaterial {
    map.anisotropy = anisotropy;
    if (normalMap) normalMap.anisotropy = anisotropy;
    const material = new MeshLambertMaterial({ map, normalMap, vertexColors: true });
    material.color.setScalar(lift);
    return material;
  }

  private buildMachines(meshes: ModelMeshes<"casino">): InstancedMesh[] {
    const { scene: palette } = THEME;
    const tints: Readonly<Partial<Record<MachineKind, string>>> = { classic: palette.slotClassic, fiveReel: palette.slotFiveReel, luckySeven: palette.slotLuckySeven };
    const slot = vertexGlowMaterial(THEME.material.casinoCream, MACHINE_GLOW);
    const kiosk = vertexGlowMaterial(THEME.material.casinoCream, MACHINE_GLOW);
    const table = new MeshLambertMaterial({ vertexColors: true });
    this.materials.push(slot, kiosk, table);
    const kinds: readonly [Mesh, MeshLambertMaterial, readonly MachineKind[]][] = [
      [meshes.slotCabinet, slot, ["classic", "fiveReel", "luckySeven"]],
      [meshes.rouletteTable, table, ["roulette"]],
      [meshes.scratchKiosk, kiosk, ["scratch"]],
    ];
    return kinds.map(([source, material, served]) => this.instance(source.name, source.geometry, material, MACHINE_SPOTS.filter((spot) => served.includes(spot.kind)), tints));
  }

  // The prototype faces -z at the origin, its width along x and its depth along z; each machine turns to its yaw and stretches to its
  // kind's size. A slot cabinet's colour multiplies the cream of its body, so each kind gets its own.
  private instance(name: string, geometry: BufferGeometry, material: Material, spots: readonly MachineSpot[], tints: Readonly<Partial<Record<MachineKind, string>>>): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, spots.length);
    mesh.name = name;
    mesh.frustumCulled = false;
    this.spotsOf.set(mesh, spots);
    const tinted = spots.some((spot) => tints[spot.kind] !== undefined);
    if (tinted) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(spots.length * 3).fill(1), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
    }
    const m = new Matrix4();
    const stretch = new Vector3();
    spots.forEach((spot, index) => {
      const made = MACHINE_SIZE[AUTHORED_AS[spot.kind]];
      const size = MACHINE_SIZE[spot.kind];
      stretch.set(size.width / made.width, 1, size.depth / made.depth);
      m.makeRotationY(spot.yaw).scale(stretch).setPosition(spot.x, 0, spot.z);
      mesh.setMatrixAt(index, m);
      const tint = tints[spot.kind];
      if (tint !== undefined) mesh.setColorAt(index, TINT.set(tint));
    });
    this.group.add(mesh);
    return mesh;
  }

  // The machine a pick landed on, if it landed on one.
  machineAt(hit: Intersection | null): MachineSpot | null {
    if (!hit || hit.instanceId === undefined) return null;
    return this.spotsOf.get(hit.object)?.[hit.instanceId] ?? null;
  }

  // The roof, the front wall and the sign are in the way of a camera over the room; they are hidden while a visitor is inside. The
  // coffered ceiling goes with them once the camera is up among its beams, and comes back for a camera low in the room.
  setCutaway(cut: boolean, cameraY: number): void {
    for (const mesh of this.cutaway) mesh.visible = !cut;
    this.ceiling.visible = !(cut && cameraY > CEILING_CUT_Y);
  }

  // `inside`: 0 when the camera is outside and 1 once it is in the room. `near`: 0 when the visitor is far from the building and 1
  // at its door. The hemisphere is the room's own; the lamps are local and come up with either.
  setPresence(inside: number, near: number): void {
    this.inside = inside;
    this.near = near;
  }

  update(time: number, reduceMotion: boolean): void {
    this.hemisphere.intensity = HEMISPHERE_LIGHT * this.inside;
    const room = Math.max(this.inside, this.near * DOORWAY_SHARE);
    for (const lamp of this.lamps) {
      if (lamp.role === "sign") lamp.light.intensity = lamp.intensity * this.near * (1 - this.inside);
      else if (lamp.role === "neon") lamp.light.intensity = lamp.intensity * room * (1 + (reduceMotion ? 0 : NEON_FLICKER * Math.sin(time * 2.1 + lamp.phase)));
      else lamp.light.intensity = lamp.intensity * room;
    }
  }

  // The geometries and textures that came with the glb belong to the loaded assets; only what the casino made is released here.
  dispose(): void {
    for (const material of this.materials) material.dispose();
    for (const machines of this.machines) machines.dispose();
    this.group.removeFromParent();
  }
}

const TINT = new Color();
