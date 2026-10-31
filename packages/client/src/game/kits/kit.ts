import type { Bounds } from "@dongjane/shared";
import type { KIT_MESHES } from "../../assets/contract.ts";

export type KitMesh = (typeof KIT_MESHES)[number];

export type Vec3 = readonly [number, number, number];

// One colour as #rrggbb, or two for a blend from the piece's lowest point (first) to its highest (second).
export type Paint = string | readonly [string, string];

// What blender/venue_kit.py can draw, in the world's own metres (y up, +z toward the viewer). Nothing here is a three.js object, so the
// asset build reads the same data the client does.
export type KitPiece =
  | { readonly shape: "box"; readonly min: Vec3; readonly max: Vec3; readonly paint: Paint; readonly skip?: readonly string[] }
  | { readonly shape: "cylinder"; readonly from: Vec3; readonly to: Vec3; readonly radius: number; readonly radiusTo?: number; readonly sides: number; readonly paint: Paint; readonly flat?: boolean }
  | { readonly shape: "sphere"; readonly at: Vec3; readonly radii: Vec3; readonly sides: number; readonly paint: Paint }
  | { readonly shape: "floor"; readonly area: Bounds; readonly y: number; readonly step: number; readonly pattern: "plain" | "checker" | "boards" | "fade"; readonly paint: Paint; readonly along?: "x" | "z" }
  | { readonly shape: "gable"; readonly from: Vec3; readonly to: Vec3; readonly ridge: number; readonly along: "x" | "z"; readonly paint: Paint };

export type KitPieces = Partial<Readonly<Record<KitMesh, readonly KitPiece[]>>>;

// A lamp that lights the venue while the camera is in it.
export interface KitLamp {
  readonly at: Vec3;
  readonly color: string;
  readonly intensity: number;
  readonly distance: number;
  // How far the light wavers, as a share of its intensity (a fire's): 0 or absent for a steady lamp.
  readonly flicker?: number;
}

// The light and the air of a venue the camera is in. `air` and `fog` replace the sky's only for an indoor venue.
export interface KitLook {
  readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number };
  readonly lamps: readonly KitLamp[];
  readonly air: string;
  readonly fog: { readonly near: number; readonly far: number };
}

// The box the camera moves in while the followed monk is in the venue, and the zoom range there.
export interface KitCamera {
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number; readonly minZ: number; readonly maxZ: number };
  readonly limits: { readonly minDistance: number; readonly maxDistance: number; readonly minPitch: number; readonly maxPitch: number };
  readonly view: { readonly yaw: number; readonly pitch: number; readonly distance: number };
  // The building's solid outside up to its roof: a camera that follows someone along its front may not swing into it. A venue in
  // the open has none.
  readonly keepOut?: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number; readonly minZ: number; readonly maxZ: number };
}

export interface KitSpec {
  readonly id: string;
  readonly meshes: KitPieces;
  // Ground that is levelled flat to the floor's height under the kit, so the hillside does not poke through it.
  readonly pads: readonly Bounds[];
  // Present for a venue the camera goes into (a seated venue), absent for the street, which is only drawn.
  readonly look?: KitLook;
  readonly camera?: KitCamera;
}

export const PAD_HEIGHT = -0.04;

export function meshNames(spec: KitSpec): KitMesh[] {
  return (Object.keys(spec.meshes) as KitMesh[]).filter((name) => (spec.meshes[name]?.length ?? 0) > 0);
}
