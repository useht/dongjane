import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial, type Texture } from "three";
import type { Vec3 } from "./kits/kit.ts";

// How brightly a glowing surface shines by day and by night; `nightGlow` eases from one to the other as the sky darkens.
export interface GlowRange {
  readonly day: number;
  readonly night: number;
}

// The paper lanterns glow a little by day and fully at night. The street lamps' globes shine as fully at night, but by day are glass.
export const LANTERN_GLOW: GlowRange = { day: 0.12, night: 1.1 };
export const STREET_LAMP_GLOW: GlowRange = { day: 0.3, night: LANTERN_GLOW.night };

export function nightGlow(range: GlowRange, nightSky: number): number {
  return range.day + (range.night - range.day) * nightSky;
}

// How far from a lamp its halo and its pool of light reach, in metres.
export const LAMP_REACH = { halo: 1.1, pool: 3.5 } as const;

const HALO_OPACITY = 0.9;
const POOL_OPACITY = 0.35;
// The pool lies this far over the paving; the polygon offset keeps the two from fighting at a distance.
const POOL_LIFT = 0.012;
const VISIBLE = 0.002;

export interface NightLampsSpec {
  // The middle of each lamp's globe.
  readonly spots: readonly Vec3[];
  readonly groundY: number;
  readonly haloRadius: number;
  readonly poolRadius: number;
  readonly color: string;
  // A white soft round glow (see `lampHaloTexture`); the caller owns it.
  readonly texture: Texture;
}

// What a row of street lamps adds at night beyond their globes: a halo round each globe and a pool of light on the ground under it.
// They are drawn, not lit, so they cost no light in the scene, which every material would pay for. Not part of any `FloorSurfaces`:
// a tap goes through them.
export class NightLamps {
  readonly group = new Group();

  private readonly halo: SpriteMaterial;
  private readonly pool: MeshBasicMaterial;
  private readonly poolGeometry: PlaneGeometry;

  constructor(spec: NightLampsSpec) {
    this.group.name = "night-lamps";
    const glow = { map: spec.texture, color: spec.color, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, toneMapped: false } as const;
    this.halo = new SpriteMaterial(glow);
    this.pool = new MeshBasicMaterial({ ...glow, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.poolGeometry = new PlaneGeometry(spec.poolRadius * 2, spec.poolRadius * 2).rotateX(-Math.PI / 2);
    for (const [x, y, z] of spec.spots) {
      const halo = new Sprite(this.halo);
      halo.position.set(x, y, z);
      halo.scale.setScalar(spec.haloRadius * 2);
      const pool = new Mesh(this.poolGeometry, this.pool);
      pool.position.set(x, spec.groundY + POOL_LIFT, z);
      this.group.add(halo, pool);
    }
    this.setNight(0);
  }

  // `share`: 0 by day, or wherever the sky or the camera hides the street; 1 on a clear night in the open.
  setNight(share: number): void {
    this.halo.opacity = HALO_OPACITY * share;
    this.pool.opacity = POOL_OPACITY * share;
    this.group.visible = share > VISIBLE;
  }

  dispose(): void {
    this.halo.dispose();
    this.pool.dispose();
    this.poolGeometry.dispose();
    this.group.removeFromParent();
  }
}
