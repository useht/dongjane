export const WALK_BOUNDS = { minX: -5, maxX: 5, minZ: -3, maxZ: 5 } as const;

export const BUDDHA_Z = -5;
export const LANDSCAPE_HALF_WIDTH = 7;
export const LANDSCAPE_FRONT_Z = 8;

export const SPAWN_POINT = { x: 0, z: 4.4 } as const;

export interface MatSpot {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

const ROW_Z = [-1.2, 1.2] as const;
const COLUMN_X = [-3, -1, 1, 3] as const;

export const MAT_SPOTS: readonly MatSpot[] = ROW_Z.flatMap((z, row) =>
  COLUMN_X.map((x, column) => ({ id: row * COLUMN_X.length + column, x, z })),
);

export const MAT_COUNT = MAT_SPOTS.length;

export function matSpot(id: number): MatSpot | undefined {
  return Number.isInteger(id) ? MAT_SPOTS[id] : undefined;
}

export function resolveWalkable(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(WALK_BOUNDS.maxX, Math.max(WALK_BOUNDS.minX, x)),
    z: Math.min(WALK_BOUNDS.maxZ, Math.max(WALK_BOUNDS.minZ, z)),
  };
}

export function worldName(world: number): string {
  return `${world}번 월드`;
}

export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.floor((angle + Math.PI) / turn);
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * t;
}
