import {
  HALLS_PATH,
  SEAT_PATH,
  type HallInfo,
  type HallListResponse,
  type SeatRequest,
  type SeatResponse,
  isValidHall,
  parseHallParam,
} from "@dongjane/shared";
import { withBackoff } from "./retry.ts";

export class HallsUnavailableError extends Error {
  constructor(message = "halls unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HallsUnavailableError";
  }
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

async function request(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new HallsUnavailableError(`request failed with ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof HallsUnavailableError) throw error;
    throw new HallsUnavailableError("could not reach the server", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHalls(
  base: string,
  fetchFn: typeof fetch = defaultFetch,
  timeoutMs = 6000,
  onServerTime?: (serverTime: number) => void,
): Promise<HallInfo[]> {
  const body = (await request(`${base}${HALLS_PATH}`, {}, fetchFn, timeoutMs)) as Partial<HallListResponse> | null;
  if (!Array.isArray(body?.halls)) throw new HallsUnavailableError("malformed hall list");
  if (typeof body.serverTime === "number") onServerTime?.(body.serverTime);
  return body.halls.filter((info): info is HallInfo => isValidHall(info?.hall));
}

// Covers a cold start: the page can load before the game server is listening.
export const SEAT_RETRY_DELAYS_MS: readonly number[] = [300, 600, 1200, 2000, 3000];

export interface RequestSeatOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  onRetry?: (failures: number) => void;
}

export function requestSeat(base: string, requested: number | null, options: RequestSeatOptions = {}): Promise<SeatResponse> {
  const payload: SeatRequest = { hall: requested };
  return withBackoff(
    async () => {
      const body = (await request(
        `${base}${SEAT_PATH}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
        options.fetchFn ?? defaultFetch,
        options.timeoutMs ?? 6000,
      )) as Partial<SeatResponse> | null;
      if (!isValidHall(body?.hall) || typeof body.roomId !== "string" || body.roomId === "") {
        throw new HallsUnavailableError("malformed seat");
      }
      return { hall: body.hall, roomId: body.roomId, fellBack: body.fellBack === true };
    },
    {
      delaysMs: options.delaysMs ?? SEAT_RETRY_DELAYS_MS,
      sleep: options.sleep,
      isCancelled: options.isCancelled,
      onRetry: options.onRetry,
    },
  );
}

export type HallEntryCheck =
  | { ok: true; hall: number }
  | { ok: false; reason: "invalid" | "current" | "missing" | "full"; hall: number | null };

export function checkHallEntry(halls: readonly HallInfo[], current: number, typed: string): HallEntryCheck {
  const hall = parseHallParam(typed.trim());
  if (hall === null) return { ok: false, reason: "invalid", hall };
  if (hall === current) return { ok: false, reason: "current", hall };
  const info = halls.find((entry) => entry.hall === hall);
  if (!info) return { ok: false, reason: "missing", hall };
  if (info.full) return { ok: false, reason: "full", hall };
  return { ok: true, hall };
}
