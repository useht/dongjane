import { PerspectiveCamera, Vector3 } from "three";
import { DHARMA_VENUE, DHARMA_YAW, MACHINE_SPOTS, type Zone, dharmaToWorld, machineFootprint, worldToDharma } from "@dongjane/shared";
import { CASINO_CAMERA_BOUNDS, CASINO_KEEP_OUT, machineHeight } from "./casino-layout.ts";
import { DHARMA, DHARMA_SHELL, FRONT_PILLARS_X, WALL_OPENINGS, WINDOW_BAND } from "./dharma-layout.ts";
import { KITS, kitById } from "./kits/index.ts";
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

const GATBAWI_LIMITS: RigLimits = { minDistance: 2.6, maxDistance: 22, minPitch: 0.16, maxPitch: 1.3 };
const DHARMA_LIMITS: RigLimits = { minDistance: 2.2, maxDistance: 12, minPitch: 0.16, maxPitch: 1.3 };
const CASINO_LIMITS: RigLimits = { minDistance: 2.2, maxDistance: 14, minPitch: 0.16, maxPitch: 1.3 };

// How far the lens keeps from anything the room draws.
export const CAMERA_CLEARANCE = 0.3;

// A box given in the room's own frame (door +z, relative to the middle of its floor), as the world holds it after the quarter turn.
function inWorld(room: { minX: number; maxX: number; minZ: number; maxZ: number }, minY: number, maxY: number): Box {
  const a = dharmaToWorld(room.minX, room.minZ);
  const b = dharmaToWorld(room.maxX, room.maxZ);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY, maxY, minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

// Below the beam band (underside at 6.7) and the hanging lanterns (hooks from 6.7) and inside the side pillars (faces at 10.25).
export const DHARMA_CAMERA_BOUNDS: Box = inWorld({ minX: -9.9, maxX: 9.9, minZ: -5, maxZ: 8.8 }, 0.5, 5.6);

// The 법당's solid outside, up to the finials on its ridge: a camera that follows someone along its front may not swing into it.
export const DHARMA_KEEP_OUT: Box = inWorld(
  {
    minX: -DHARMA.halfWidth - DHARMA_SHELL.plinth,
    maxX: DHARMA.halfWidth + DHARMA_SHELL.plinth,
    minZ: DHARMA.backZ - DHARMA_SHELL.plinth,
    maxZ: DHARMA_SHELL.porchZ,
  },
  -1,
  15,
);

// Whether a world point is inside the room itself: between its walls and under its ceiling.
export function pointInRoom(point: { x: number; y: number; z: number }): boolean {
  const room = worldToDharma(point.x, point.z);
  return Math.abs(room.x) < DHARMA.halfWidth && room.z > DHARMA.backZ && room.z < DHARMA.frontZ && point.y < DHARMA.ceilingHeight;
}

// Round the front wall's engaged pillars, widened by the clearance.
const PILLAR_RADIUS = 0.3;
export const DHARMA_PILLARS_KEEP_OUT: readonly Box[] = FRONT_PILLARS_X.map((x) =>
  inWorld(
    {
      minX: x - PILLAR_RADIUS - CAMERA_CLEARANCE,
      maxX: x + PILLAR_RADIUS + CAMERA_CLEARANCE,
      minZ: DHARMA.frontZ - DHARMA.inset - PILLAR_RADIUS - 0.1,
      maxZ: DHARMA.frontZ,
    },
    0,
    DHARMA.ceilingHeight,
  ),
);

// Everything a camera inside the 법당 is held back from.
export const DHARMA_KEEP_OUTS: readonly Box[] = [DHARMA_KEEP_OUT, ...DHARMA_PILLARS_KEEP_OUT];

// Everything a camera on the open ground is held back from: the 법당 and the casino, whose shell reaches up to its sign. A camera
// whose monk is inside one of them is already in its box and is not held back by it.
export const KEEP_OUTS: readonly Box[] = [...DHARMA_KEEP_OUTS, CASINO_KEEP_OUT];

// The same, with the buildings of the kit venues, which the world's camera is held back from too.
export const WORLD_KEEP_OUTS: readonly Box[] = [...KEEP_OUTS, ...KITS.flatMap((kit) => (kit.camera?.keepOut ? [kit.camera.keepOut] : []))];

// How far short of a keep-out box the camera stops.
const KEEP_OUT_MARGIN = 0.4;

// Each machine's body, widened by the clearance on every side and up. The rows of machines stand right up to the casino's walls
// (the east row's backs are 0.1 m from the wall), so a camera held in the room's box can end up in them. Unlike the keep-out boxes
// the camera is not held in front of these (the visitor playing a machine stands 0.7 m from it, nearer than the camera may come
// to its monk): it is raised over them, to look down from above the row.
export const CASINO_MACHINE_BOXES: readonly Box[] = MACHINE_SPOTS.map((spot) => {
  const footprint = machineFootprint(spot);
  return {
    minX: footprint.minX - CAMERA_CLEARANCE,
    maxX: footprint.maxX + CAMERA_CLEARANCE,
    minY: -1,
    maxY: machineHeight(spot.kind) + CAMERA_CLEARANCE,
    minZ: footprint.minZ - CAMERA_CLEARANCE,
    maxZ: footprint.maxZ + CAMERA_CLEARANCE,
  };
});

// The sill under each front window juts 0.29 m out of the wall, 0.16 m wider than the opening, and its top is 0.03 m under the
// opening's foot (dharma.py): a box round it, widened by the clearance on every side but the wall's and up.
const SILL = { out: 0.3, wider: 0.08, below: 0.03 };
export const DHARMA_SILLS: readonly Box[] = WALL_OPENINGS.filter((opening) => opening.wall === "front").map((opening) =>
  inWorld(
    {
      minX: opening.along - opening.width / 2 - SILL.wider - CAMERA_CLEARANCE,
      maxX: opening.along + opening.width / 2 + SILL.wider + CAMERA_CLEARANCE,
      minZ: DHARMA.frontZ - SILL.out - CAMERA_CLEARANCE,
      maxZ: DHARMA.frontZ,
    },
    0,
    WINDOW_BAND.low - SILL.below + CAMERA_CLEARANCE,
  ),
);

// Everything the camera is raised out of rather than held in front of: the machines, and what a monk at the front wall can stand
// beside, nearer than the camera may come to it: the front pillars and the window sills. The lens is lifted to look down from short of them.
export const WORLD_SOLIDS: readonly Box[] = [...CASINO_MACHINE_BOXES, ...DHARMA_PILLARS_KEEP_OUT, ...DHARMA_SILLS];

// How much steeper the camera's pitch gets at a time while it is raised out of a solid.
const LIFT_STEP = 0.05;

function insideAny(point: { x: number; y: number; z: number }, boxes: readonly Box[]): boolean {
  return boxes.some((box) => point.x > box.minX && point.x < box.maxX && point.y > box.minY && point.y < box.maxY && point.z > box.minZ && point.z < box.maxZ);
}

export interface View {
  yaw: number;
  pitch: number;
  distance: number;
}

// Seen from the back of the plaza, high enough that Gatbawi's hat stone, all fifty mats and the monk fit between the HUD bands.
export const DEFAULT_VIEW: View = { yaw: -0.085, pitch: 0.62, distance: 16 };

const LANDSCAPE_VIEW_WIDE_DISTANCE = 12;
// From the door side of the room toward the altar, whichever way the world has turned the room.
const DHARMA_VIEW: View = { yaw: DHARMA_YAW, pitch: 0.75, distance: 8.5 };
const START_DISTANCE = 7;

// A wide window frames the plaza from nearer than a tall one, which needs the distance to fit the plaza's depth.
export function viewFor(zone: Zone, aspect: number): View {
  if (zone === DHARMA_VENUE.id) return { ...DHARMA_VIEW };
  const kit = kitById(zone)?.camera;
  if (kit) return { ...kit.view };
  return { ...DEFAULT_VIEW, distance: aspect < 1 ? DEFAULT_VIEW.distance : LANDSCAPE_VIEW_WIDE_DISTANCE };
}

export function startViewFor(zone: Zone, aspect: number): View {
  if (zone === DHARMA_VENUE.id || kitById(zone)?.camera) return viewFor(zone, aspect);
  return { ...DEFAULT_VIEW, distance: START_DISTANCE };
}

export function regionFor(zone: Zone): { bounds: Box; limits: RigLimits } {
  if (zone === DHARMA_VENUE.id) return { bounds: DHARMA_CAMERA_BOUNDS, limits: DHARMA_LIMITS };
  const kit = kitById(zone)?.camera;
  if (kit) return { bounds: kit.bounds, limits: kit.limits };
  return { bounds: LANDSCAPE_BOUNDS, limits: GATBAWI_LIMITS };
}

// While the followed visitor is inside the casino the camera has the whole room, up over its (hidden) roof.
export function casinoRegion(): { bounds: Box; limits: RigLimits } {
  return { bounds: CASINO_CAMERA_BOUNDS, limits: CASINO_LIMITS };
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

// How far the idle camera drifts from where it is aimed, at the most: radians of yaw and of pitch.
export const SWAY = { yaw: 0.02, pitch: 0.012 } as const;

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
    private readonly solids: readonly Box[] = [],
  ) {
    this.bounds = { ...bounds };
    this.blendFrom = { ...bounds };
    this.blendTo = { ...bounds };
  }

  get focusPoint(): Readonly<Vector3> {
    return this.focus;
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
    const sway = this.reduceMotion ? 0 : Math.sin(this.clock * 0.35) * SWAY.yaw;
    const bob = this.reduceMotion ? 0 : Math.sin(this.clock * 0.5 + 1) * SWAY.pitch;
    const yaw = this.yaw + sway;
    let pitch = this.pitch + bob;
    this.place(yaw, pitch);
    // A camera that ended up inside something solid is raised, steeper and steeper, until it looks down from over it.
    while (pitch < this.limits.maxPitch && insideAny(this.camera.position, this.solids)) {
      pitch = Math.min(this.limits.maxPitch, pitch + LIFT_STEP);
      this.place(yaw, pitch);
    }
    this.aimAtFocus();
  }

  private place(yaw: number, pitch: number): void {
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
