export interface HallInfo {
  hall: number;
  roomId: string;
  clients: number;
  capacity: number;
  full: boolean;
}

export interface HallListResponse {
  halls: HallInfo[];
}

export interface SeatRequest {
  hall: number | null;
}

export interface SeatResponse {
  hall: number;
  roomId: string;
  fellBack: boolean;
}

export function isValidHall(hall: unknown): hall is number {
  return typeof hall === "number" && Number.isSafeInteger(hall) && hall >= 1;
}

export function parseHallParam(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  const hall = Number(value);
  return isValidHall(hall) ? hall : null;
}

export function parseSeatRequest(payload: unknown): SeatRequest {
  const hall = typeof payload === "object" && payload !== null ? (payload as { hall?: unknown }).hall : undefined;
  return { hall: isValidHall(hall) ? hall : null };
}

export function isHallFullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /locked|already full|is full/i.test(message);
}
