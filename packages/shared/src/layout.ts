// Gatbawi sits on a granite platform at the far end (-z); the plaza where the visitors kneel runs
// toward +z. Visitors stay on the plaza, so the stone steps and the platform are never walked on.
export const GATBAWI_Z = -6;
export const PLATFORM = { minZ: -6.5, maxZ: -4.4, topY: 1.2 } as const;
export const STEPS = { minZ: -4.4, maxZ: -2.2 } as const;
export const PLAZA = { minZ: -2.2, maxZ: 5 } as const;

export const WORLD_BOUNDS = { minX: -5.5, maxX: 5.5, minZ: -2.4, maxZ: 5 } as const;

export const SPAWN_POINT = { x: 0, z: 4.4 } as const;

// Every mat faces -z, toward Gatbawi, which is yaw 0 in yawFromDirection's convention.
export const MAT_YAW = 0;
export const MAT_SIZE = { x: 1.1, z: 1.3 } as const;

export interface MatSpot {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

export const MAT_ROW_Z = [-1, 0.8, 2.6] as const;
export const MAT_COLUMN_X = [-2.25, -0.75, 0.75, 2.25] as const;

export const MAT_SPOTS: readonly MatSpot[] = MAT_ROW_Z.flatMap((z, row) =>
  MAT_COLUMN_X.map((x, column) => ({ id: row * MAT_COLUMN_X.length + column, x, z })),
);

export const MAT_COUNT = MAT_SPOTS.length;

export function matSpot(id: number): MatSpot | undefined {
  return Number.isInteger(id) ? MAT_SPOTS[id] : undefined;
}

export function resolveWalkable(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(WORLD_BOUNDS.maxX, Math.max(WORLD_BOUNDS.minX, x)),
    z: Math.min(WORLD_BOUNDS.maxZ, Math.max(WORLD_BOUNDS.minZ, z)),
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
