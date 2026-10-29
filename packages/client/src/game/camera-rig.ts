import { PerspectiveCamera, Vector3 } from "three";
import { DHARMA_ORIGIN, type Zone } from "@dongjane/shared";
import { DHARMA, DHARMA_SHELL } from "./dharma-layout.ts";
import { LANDSCAPE_BOUNDS } from "./landscape-layout.ts";

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

// Largest distance along `dir` from `origin` that stays inside `box` (dir need not be normalized).
export function maxDistanceInside(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  box: Box,
  want: number,
): number {
  let limit = want;
  const axes: Array<[number, number, number, number]> = [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.y, dir.y, box.minY, box.maxY],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (d > 1e-6) limit = Math.min(limit, (hi - o) / d);
    else if (d < -1e-6) limit = Math.min(limit, (lo - o) / d);
  }
  return Math.max(0, limit);
}

// Distance along `dir` (a unit vector) from `origin` to where it first enters `box`, or `want` when it does not get there
// within `want`. An origin that is already inside the box has no entry, so it is not held back.
export function distanceBefore(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  box: Box,
  want: number,
): number {
  let enter = 0;
  let exit = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.y, dir.y, box.minY, box.maxY],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return want;
      continue;
    }
    const near = (lo - o) / d;
    const far = (hi - o) / d;
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
  }
  if (enter <= 0 || enter > exit) return want;
  return Math.min(want, enter);
}

export interface RigLimits {
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
}

const GATBAWI_LIMITS: RigLimits = { minDistance: 2.6, maxDistance: 18, minPitch: 0.16, maxPitch: 1.3 };
const DHARMA_LIMITS: RigLimits = { minDistance: 2.2, maxDistance: 9.5, minPitch: 0.16, maxPitch: 1.3 };

// Inside the 법당: the room is a lit box and the camera stays within it, a little short of its walls.
export const DHARMA_CAMERA_BOUNDS: Box = {
  minX: DHARMA_ORIGIN.x - 9.6,
  maxX: DHARMA_ORIGIN.x + 9.6,
  minY: 0.5,
  maxY: 7,
  minZ: DHARMA_ORIGIN.z - 5,
  maxZ: DHARMA_ORIGIN.z + 8.8,
};

// The 법당's solid outside, up to the finials on its ridge: a camera that follows someone along its front may not swing into it.
export const DHARMA_KEEP_OUT: Box = {
  minX: DHARMA_ORIGIN.x - DHARMA.halfWidth - DHARMA_SHELL.plinth,
  maxX: DHARMA_ORIGIN.x + DHARMA.halfWidth + DHARMA_SHELL.plinth,
  minY: -1,
  maxY: 13,
  minZ: DHARMA_ORIGIN.z + DHARMA.backZ - DHARMA_SHELL.plinth,
  maxZ: DHARMA_ORIGIN.z + DHARMA_SHELL.porchZ,
};

// How far short of a keep-out box the camera stops.
const KEEP_OUT_MARGIN = 0.4;

export interface View {
  yaw: number;
  pitch: number;
  distance: number;
}

// Seen from the back of the plaza, high enough that Gatbawi's hat stone, all fifty mats and the monk fit between the HUD bands.
export const DEFAULT_VIEW: View = { yaw: -0.085, pitch: 0.62, distance: 16 };

const LANDSCAPE_VIEW_WIDE_DISTANCE = 12;
const DHARMA_VIEW: View = { yaw: 0, pitch: 0.75, distance: 8.5 };

// A wide window frames the plaza from nearer than a tall one, which needs the distance to fit the plaza's depth.
export function viewFor(zone: Zone, aspect: number): View {
  if (zone === "dharma") return { ...DHARMA_VIEW };
  return { ...DEFAULT_VIEW, distance: aspect < 1 ? DEFAULT_VIEW.distance : LANDSCAPE_VIEW_WIDE_DISTANCE };
}

export function regionFor(zone: Zone): { bounds: Box; limits: RigLimits } {
  return zone === "dharma"
    ? { bounds: DHARMA_CAMERA_BOUNDS, limits: DHARMA_LIMITS }
    : { bounds: LANDSCAPE_BOUNDS, limits: GATBAWI_LIMITS };
}

export interface Lens {
  fov: number;
  // Radians the optical axis is raised above the line from the camera to the followed monk.
  lift: number;
}

export function lensFor(aspect: number): Lens {
  return aspect < 1 ? { fov: 74, lift: 0.15 } : { fov: 62, lift: 0.15 };
}

// Applies the lens for the canvas size and moves the principal point into the band the HUD leaves free.
export function configureCamera(camera: PerspectiveCamera, rig: CameraRig, width: number, height: number, hudTop: number, hudBottom: number): void {
  const lens = lensFor(width / height);
  camera.aspect = width / height;
  camera.fov = lens.fov;
  rig.lift = lens.lift;
  const shift = (hudTop - hudBottom) / 2;
  if (Math.abs(shift) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(width, height, 0, -shift, width, height);
  camera.updateProjectionMatrix();
}

const projected = new Vector3();

// CSS pixels of a world point inside the canvas, or false when it is behind the camera or off screen. Call after the camera matrices are current.
export function projectToCanvas(
  camera: PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: { x: number; y: number },
): boolean {
  projected.set(x, y, z).project(camera);
  if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return false;
  out.x = (projected.x + 1) * 0.5 * width;
  out.y = (1 - projected.y) * 0.5 * height;
  return true;
}

// Like projectToCanvas, but a point outside the view still gets its place on the plane of the canvas: only a point
// behind the camera has none. A video quad needs this, because its corners are often off screen.
export function projectUnclipped(
  camera: PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: { x: number; y: number },
): boolean {
  projected.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  if (projected.z >= -camera.near) return false;
  projected.applyMatrix4(camera.projectionMatrix);
  out.x = (projected.x + 1) * 0.5 * width;
  out.y = (1 - projected.y) * 0.5 * height;
  return Number.isFinite(out.x) && Number.isFinite(out.y);
}

const BOX_KEYS = ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"] as const;
// How fast the zoom distance follows a new range while the camera box is changing.
const DISTANCE_EASE = 5;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export class CameraRig {
  yaw: number = DEFAULT_VIEW.yaw;
  pitch: number = DEFAULT_VIEW.pitch;
  distance: number = DEFAULT_VIEW.distance;
  lift = 0;
  reduceMotion = false;
  private readonly focus = new Vector3(0, 0.8, 3);
  private readonly dir = new Vector3();
  private readonly aim = new Vector3();
  private clock = 0;
  // The box in force this frame; while a change is under way it lies between `blendFrom` and `blendTo`.
  private bounds: Box;
  private blendFrom: Box;
  private blendTo: Box;
  private blendElapsed = 0;
  private blendSeconds = 0;

  constructor(
    readonly camera: PerspectiveCamera,
    bounds: Box,
    private limits: RigLimits = GATBAWI_LIMITS,
    private readonly keepOut: readonly Box[] = [],
  ) {
    this.bounds = { ...bounds };
    this.blendFrom = { ...bounds };
    this.blendTo = { ...bounds };
  }

  // Moves the camera's box and zoom range; with `blendSeconds` the box slides to the new one and the distance eases into the
  // new range, which is how the camera follows a monk through a doorway without a cut.
  setRegion(bounds: Box, limits: RigLimits, blendSeconds = 0): void {
    this.limits = limits;
    this.blendTo = { ...bounds };
    if (blendSeconds <= 0 || this.reduceMotion) {
      this.bounds = { ...bounds };
      this.blendSeconds = 0;
      this.distance = this.clampDistance(this.distance);
      return;
    }
    this.blendFrom = { ...this.bounds };
    this.blendElapsed = 0;
    this.blendSeconds = blendSeconds;
  }

  private clampDistance(distance: number): number {
    return Math.min(this.limits.maxDistance, Math.max(this.limits.minDistance, distance));
  }

  private stepRegion(dt: number): void {
    if (this.blendSeconds <= 0) return;
    this.blendElapsed = Math.min(this.blendSeconds, this.blendElapsed + dt);
    const t = smooth(this.blendElapsed / this.blendSeconds);
    for (const key of BOX_KEYS) this.bounds[key] = this.blendFrom[key] + (this.blendTo[key] - this.blendFrom[key]) * t;
    const wanted = this.clampDistance(this.distance);
    if (this.blendElapsed >= this.blendSeconds) {
      this.blendSeconds = 0;
      this.distance = wanted;
    } else {
      this.distance += (wanted - this.distance) * (1 - Math.exp(-dt * DISTANCE_EASE));
    }
  }

  orbit(dxRadians: number, dyRadians: number): void {
    this.yaw -= dxRadians;
    this.pitch = Math.min(this.limits.maxPitch, Math.max(this.limits.minPitch, this.pitch + dyRadians));
  }

  zoom(factor: number): void {
    this.distance = Math.min(this.limits.maxDistance, Math.max(this.limits.minDistance, this.distance * factor));
  }

  follow(x: number, z: number, dt: number, snap = false): void {
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.focus.x += (x - this.focus.x) * k;
    this.focus.z += (z - this.focus.z) * k;
  }

  // Direction on the floor that "forward" (away from the camera) points to.
  get forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(dt: number): void {
    this.clock += dt;
    this.stepRegion(dt);
    const sway = this.reduceMotion ? 0 : Math.sin(this.clock * 0.35) * 0.02;
    const bob = this.reduceMotion ? 0 : Math.sin(this.clock * 0.5 + 1) * 0.012;
    const yaw = this.yaw + sway;
    const pitch = this.pitch + bob;
    this.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let reach = maxDistanceInside(this.focus, this.dir, this.bounds, this.distance);
    for (const box of this.keepOut) {
      const entry = distanceBefore(this.focus, this.dir, box, reach);
      if (entry < reach) reach = Math.max(0, entry - KEEP_OUT_MARGIN);
    }
    const used = Math.max(Math.min(this.distance, reach), Math.min(this.distance, this.limits.minDistance * 0.7));
    this.camera.position.copy(this.focus).addScaledVector(this.dir, used);
    this.camera.position.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, this.camera.position.x));
    this.camera.position.y = Math.min(this.bounds.maxY, Math.max(this.bounds.minY, this.camera.position.y));
    this.camera.position.z = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, this.camera.position.z));
    this.aimAtFocus();
  }

  private aimAtFocus(): void {
    const position = this.camera.position;
    const dx = this.focus.x - position.x;
    const dz = this.focus.z - position.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 1e-6 || this.lift === 0) {
      this.camera.lookAt(this.focus);
      return;
    }
    const down = Math.atan2(position.y - this.focus.y, flat) - this.lift;
    const reach = Math.cos(down) / flat;
    this.aim.set(position.x + dx * reach, position.y - Math.sin(down), position.z + dz * reach);
    this.camera.lookAt(this.aim);
  }
}
