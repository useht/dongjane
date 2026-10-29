import { PerspectiveCamera, Vector3 } from "three";

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

export interface RigLimits {
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
}

const LIMITS: RigLimits = { minDistance: 2.6, maxDistance: 7, minPitch: 0.16, maxPitch: 1.3 };

// A low, wide view from the back of the hall: the Buddha's halo, the altar and the monk all fit between the HUD bands.
export const DEFAULT_VIEW = { yaw: 0, pitch: 0.3, distance: 5.6 } as const;

export interface Lens {
  fov: number;
  // Radians the optical axis is raised above the line from the camera to the followed monk.
  lift: number;
}

export function lensFor(aspect: number): Lens {
  return aspect < 1 ? { fov: 66, lift: 0.15 } : { fov: 62, lift: 0.15 };
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

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly bounds: Box,
    private readonly limits: RigLimits = LIMITS,
  ) {}

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
    const sway = this.reduceMotion ? 0 : Math.sin(this.clock * 0.35) * 0.02;
    const bob = this.reduceMotion ? 0 : Math.sin(this.clock * 0.5 + 1) * 0.012;
    const yaw = this.yaw + sway;
    const pitch = this.pitch + bob;
    this.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const reach = maxDistanceInside(this.focus, this.dir, this.bounds, this.distance);
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
