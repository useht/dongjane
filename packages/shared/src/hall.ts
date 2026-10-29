import { HALL_CAPACITY, HALL_COUNT } from "./constants.ts";

export interface HallInfo {
  hall: number;
  roomId: string | null;
  clients: number;
  capacity: number;
  full: boolean;
}

export interface HallListResponse {
  halls: HallInfo[];
}

export function pickHall(halls: readonly HallInfo[]): number | null {
  let best: HallInfo | null = null;
  for (const info of halls) {
    if (info.full || info.roomId === null) continue;
    if (best === null || info.capacity - info.clients > best.capacity - best.clients) best = info;
  }
  return best ? best.hall : null;
}

export function isValidHall(hall: unknown): hall is number {
  return typeof hall === "number" && Number.isInteger(hall) && hall >= 1 && hall <= HALL_COUNT;
}

export function parseHallParam(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) return null;
  const hall = Number(value);
  return isValidHall(hall) ? hall : null;
}

export function isHallFullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /locked|already full|is full/i.test(message);
}

export function emptyHall(hall: number): HallInfo {
  return { hall, roomId: null, clients: 0, capacity: HALL_CAPACITY, full: false };
}
