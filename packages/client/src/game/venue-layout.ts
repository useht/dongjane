// Plain numbers about the open-air concert stage and the lantern canopy over the plaza. Pure data and arithmetic: the Blender build reads it through scripts/asset-inputs.ts, and
// the runtime and its tests read the same file, so the models and the game cannot drift apart.
// Metres, the game's frame: Y up, +Z toward the viewer.

export interface Spot {
  readonly x: number;
  readonly z: number;
}

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// The stage stands north-east of Gatbawi, behind the plaza, turned to face the middle of the mats.
export const STAGE = {
  x: 9.5,
  z: -8.5,
  width: 9,
  depth: 4.5,
  height: 1.2,
  aimX: 0,
  aimZ: 5,
} as const;

// Rotation about Y that turns the stage's front (+Z) toward the aim point.
export const STAGE_YAW = Math.round(Math.atan2(STAGE.aimX - STAGE.x, STAGE.aimZ - STAGE.z) * 1e4) / 1e4;

// The LED screen stands on the deck, `setback` behind its centre, `bottom` metres above the ground.
export const SCREEN = { width: 7.2, height: 4.05, bottom: 3, setback: 1.2 } as const;

// Where a point in the stage's own frame (u to the audience's right, v toward the audience) lands in the world.
export function stageToWorld(u: number, v: number): Spot {
  const cos = Math.cos(STAGE_YAW);
  const sin = Math.sin(STAGE_YAW);
  return { x: STAGE.x + u * cos + v * sin, z: STAGE.z - u * sin + v * cos };
}

// The four corners of the screen in the world: bottom-left, bottom-right, top-right, top-left as the audience sees it.
export function screenCorners(): readonly [Point3, Point3, Point3, Point3] {
  const corner = (u: number, y: number): Point3 => ({ ...stageToWorld(u, -SCREEN.setback), y });
  const half = SCREEN.width / 2;
  const top = SCREEN.bottom + SCREEN.height;
  return [corner(-half, SCREEN.bottom), corner(half, SCREEN.bottom), corner(half, top), corner(-half, top)];
}

// Where a point of the screen sits on its picture, (0, 0) at the bottom-left corner and (1, 1) at the top-right.
export function screenUv(point: Point3): { u: number; v: number } {
  const [bottomLeft, bottomRight] = screenCorners();
  const rightX = bottomRight.x - bottomLeft.x;
  const rightZ = bottomRight.z - bottomLeft.z;
  const along = ((point.x - bottomLeft.x) * rightX + (point.z - bottomLeft.z) * rightZ) / (rightX * rightX + rightZ * rightZ);
  return { u: along, v: (point.y - SCREEN.bottom) / SCREEN.height };
}

// The strings of lotus lanterns: poles, pairs of poles joined by a string, and how the strings hang.
export const CANOPY = {
  height: 5.5,
  sag: 0.8,
  spacing: 0.55,
  poles: [
    [-4.2, -1.5],
    [-4.2, 4],
    [-4.2, 9.5],
    [-4.2, 15],
    [4.2, -1.5],
    [4.2, 4],
    [4.2, 9.5],
    [4.2, 15],
    [12, -2],
    [12, 4],
    [12, 10],
  ],
  strings: [
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
    [0, 1],
    [1, 2],
    [2, 3],
    [4, 5],
    [5, 6],
    [6, 7],
    [4, 8],
    [5, 9],
    [6, 10],
    [8, 9],
    [9, 10],
  ],
} as const;

// A string between two poles sags like a parabola: t runs 0..1 along it.
export function stringPoint(from: Spot, to: Spot, t: number): Point3 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: CANOPY.height - CANOPY.sag * 4 * t * (1 - t),
    z: from.z + (to.z - from.z) * t,
  };
}

export interface LanternSpot extends Point3 {
  readonly yaw: number;
  readonly scale: number;
  readonly tone: number;
}

function jitter(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

// Every lantern hangs from its string, evenly spaced along each; a bigger one hangs from each pole's tip.
export function lanternSpots(): readonly LanternSpot[] {
  const spots: LanternSpot[] = [];
  const add = (point: Point3, scale: number): void => {
    const index = spots.length;
    spots.push({ ...point, yaw: jitter(index, 1) * Math.PI * 2, scale: scale * (0.9 + 0.2 * jitter(index, 2)), tone: jitter(index, 3) });
  };
  for (const [a, b] of CANOPY.strings) {
    const [fromX, fromZ] = CANOPY.poles[a] as readonly [number, number];
    const [toX, toZ] = CANOPY.poles[b] as readonly [number, number];
    const from = { x: fromX, z: fromZ };
    const to = { x: toX, z: toZ };
    const parts = Math.max(2, Math.round(Math.hypot(toX - fromX, toZ - fromZ) / CANOPY.spacing));
    for (let i = 1; i < parts; i += 1) add(stringPoint(from, to, i / parts), 1);
  }
  for (const [x, z] of CANOPY.poles) add({ x, y: CANOPY.height - 0.05, z }, 1.35);
  return spots;
}

// Terrain that is held level so the stage and the 법당 stand on flat ground: `margin` metres past each
// footprint it is level, then it eases back into the hillside over `blend` metres.
export const PADS = { stageMargin: 1.8, dharmaMargin: 1.2, blend: 3.5 } as const;
