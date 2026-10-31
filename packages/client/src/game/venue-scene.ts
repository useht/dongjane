import {
  Color,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PointLight,
} from "three";
import { ZONE_SEATS, isZone, seatYaw } from "@dongjane/shared";
import type { KitModel } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import type { FloorSurfaces } from "./floor-pick.ts";
import type { KitLook, KitSpec } from "./kits/kit.ts";
import { vertexGlowMaterial } from "./vertex-glow.ts";

const SEAT_OCCUPIED_TINT = 0.55;
const PANE_GLOW = 0.9;
const WATER_OPACITY = 0.78;
const LAMP_DECAY = 2;

// A venue made from a kit: the floor, the walls, the roof, the lit panes and the water as the kit's glb drew them, and one
// instance of the seat prototype at each of the venue's seats. The venue's light is not its own: all kit venues share one
// `VenueLights` rig, because a light in the scene costs every material, whether or not it reaches them.
export class VenueScene {
  readonly group = new Group();
  readonly spec: KitSpec;
  // The floor a tap can walk to, and the walls, roof and water that stand on it.
  readonly surfaces: FloorSurfaces;

  private readonly roof: Mesh | undefined;
  private readonly seats: InstancedMesh | undefined;
  private readonly materials: Material[] = [];
  private readonly tint = new Color();
  private readonly occupied = new Set<number>();

  constructor(spec: KitSpec, model: KitModel) {
    this.spec = spec;
    this.group.name = `venue:${spec.id}`;
    const { meshes } = model;

    const lit = (): MeshLambertMaterial => this.keep(new MeshLambertMaterial({ vertexColors: true }));
    const floor = this.add(meshes.floor, lit());
    const shell = this.add(meshes.shell, lit());
    this.roof = this.add(meshes.roof, lit());
    this.add(meshes.glow, this.keep(vertexGlowMaterial(THEME.material.paper, PANE_GLOW)));
    const water = this.add(meshes.water, this.keep(new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: WATER_OPACITY, depthWrite: false })));

    this.seats = this.buildSeats(model);
    const blockers = [shell, this.roof, water].filter((mesh): mesh is Mesh => mesh !== undefined);
    this.surfaces = { floors: floor ? [floor] : [], blockers };
  }

  private keep<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private add(source: Mesh | undefined, material: Material): Mesh | undefined {
    if (!source) return undefined;
    const mesh = new Mesh(source.geometry, material);
    mesh.name = source.name;
    this.group.add(mesh);
    return mesh;
  }

  // The seat prototype is modelled at the origin facing -z, with the seat's height in its own geometry; each instance is moved to its
  // spot and turned to the way the monk on it faces.
  private buildSeats(model: KitModel): InstancedMesh | undefined {
    const source = model.meshes.seat;
    if (!source || !isZone(this.spec.id)) return undefined;
    const spots = ZONE_SEATS[this.spec.id];
    const seats = new InstancedMesh(source.geometry, this.keep(new MeshLambertMaterial({ vertexColors: true })), spots.length);
    seats.instanceColor = new InstancedBufferAttribute(new Float32Array(spots.length * 3).fill(1), 3);
    seats.instanceColor.setUsage(DynamicDrawUsage);
    seats.frustumCulled = false;
    seats.name = "seats";
    const m = new Matrix4();
    for (const spot of spots) {
      m.makeRotationY(seatYaw(this.spec.id, spot.id)).setPosition(spot.x, 0, spot.z);
      seats.setMatrixAt(spot.id, m);
    }
    this.group.add(seats);
    return seats;
  }

  // Which of the venue's seats are taken: they are drawn darker.
  setOccupancy(occupied: ReadonlySet<number>): void {
    if (!this.seats) return;
    const count = this.seats.count;
    for (let id = 0; id < count; id += 1) {
      const taken = occupied.has(id);
      if (taken === this.occupied.has(id)) continue;
      if (taken) this.occupied.add(id);
      else this.occupied.delete(id);
      this.tint.setScalar(taken ? SEAT_OCCUPIED_TINT : 1);
      this.seats.setColorAt(id, this.tint);
    }
    if (this.seats.instanceColor) this.seats.instanceColor.needsUpdate = true;
  }

  // The roof is in the way of a camera over the venue, so it is hidden while a visitor is inside.
  setCutaway(cut: boolean): void {
    if (this.roof) this.roof.visible = !cut;
  }

  // The geometries that came with the glb belong to the loaded model; only what the scene made is released here.
  dispose(): void {
    for (const material of this.materials) material.dispose();
    this.seats?.dispose();
    this.group.removeFromParent();
  }
}

// How unsteady a fire's light is at a time in seconds, from -1 to 1: three sines that never line up.
export function flicker(time: number): number {
  return (Math.sin(time * 7.3) + 0.7 * Math.sin(time * 12.9 + 1.7) + 0.5 * Math.sin(time * 21.1 + 4.2)) / 2.2;
}

export interface VenueLightsQuality {
  weak: boolean;
}

// The warm hemisphere and the lamps that light whichever kit venue the camera is in. They stay in the scene all the time at
// intensity 0 (adding or removing one would recompile every material); `show` sets them to a venue's look and share.
export class VenueLights {
  readonly group = new Group();

  // Three starts a light white; `configure` gives it the venue's colours.
  private readonly hemisphere = new HemisphereLight();
  private readonly lamps: PointLight[] = [];
  private readonly sky = new Color();
  private readonly ground = new Color();
  private shown: KitLook | null = null;

  constructor(quality: VenueLightsQuality) {
    this.group.name = "venue-lights";
    this.hemisphere.intensity = 0;
    this.group.add(this.hemisphere);
    // A weak device keeps one lamp; every light costs every material in the scene.
    for (let i = 0; i < (quality.weak ? 1 : 2); i += 1) {
      const lamp = new PointLight();
      lamp.intensity = 0;
      lamp.distance = 1;
      lamp.decay = LAMP_DECAY;
      this.lamps.push(lamp);
      this.group.add(lamp);
    }
  }

  // `look` is the venue the camera is in, or the last one it was in while the lights go down; `share` is 0 to 1. `time` (seconds)
  // sets how a fire's lamp wavers; without it, or with reduced motion, every lamp burns steadily.
  show(look: KitLook | null, share: number, time: number | null = null): void {
    if (look !== this.shown && look) this.configure(look);
    this.shown = look;
    this.hemisphere.intensity = look ? look.hemisphere.intensity * share : 0;
    this.lamps.forEach((lamp, index) => {
      const spec = look?.lamps[index];
      if (!spec) {
        lamp.intensity = 0;
        return;
      }
      const waver = spec.flicker && time !== null ? 1 + spec.flicker * flicker(time + index * 3.1) : 1;
      lamp.intensity = spec.intensity * share * waver;
    });
  }

  private configure(look: KitLook): void {
    this.hemisphere.color.copy(this.sky.set(look.hemisphere.sky));
    this.hemisphere.groundColor.copy(this.ground.set(look.hemisphere.ground));
    this.lamps.forEach((lamp, index) => {
      const spec = look.lamps[index];
      if (!spec) return;
      lamp.color.set(spec.color);
      lamp.position.set(...spec.at);
      lamp.distance = spec.distance;
    });
  }

  dispose(): void {
    this.hemisphere.dispose();
    this.group.removeFromParent();
  }
}
