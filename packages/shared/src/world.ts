export interface WorldInfo {
  world: number;
  roomId: string;
  clients: number;
  capacity: number;
  full: boolean;
}

export interface WorldListResponse {
  worlds: WorldInfo[];
  serverTime: number;
}

export interface SeatRequest {
  world: number | null;
}

export interface SeatResponse {
  world: number;
  roomId: string;
  fellBack: boolean;
}

export function isValidWorld(world: unknown): world is number {
  return typeof world === "number" && Number.isSafeInteger(world) && world >= 1;
}

export function parseWorldParam(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  const world = Number(value);
  return isValidWorld(world) ? world : null;
}

export function parseSeatRequest(payload: unknown): SeatRequest {
  const world = typeof payload === "object" && payload !== null ? (payload as { world?: unknown }).world : undefined;
  return { world: isValidWorld(world) ? world : null };
}

export function isWorldFullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /locked|already full|is full/i.test(message);
}
