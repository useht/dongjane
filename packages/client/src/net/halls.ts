import { HALLS_PATH, type HallInfo, type HallListResponse, isValidHall, pickHall } from "@dongjane/shared";
import { withBackoff } from "./retry.ts";

export class HallsUnavailableError extends Error {
  constructor(message = "halls unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HallsUnavailableError";
  }
}

export async function fetchHalls(
  base: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = 6000,
): Promise<HallInfo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${base}${HALLS_PATH}`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new HallsUnavailableError(`halls request failed with ${response.status}`);
    const body = (await response.json()) as Partial<HallListResponse>;
    if (!Array.isArray(body.halls)) throw new HallsUnavailableError("malformed hall list");
    return body.halls.filter((info): info is HallInfo => isValidHall(info?.hall));
  } catch (error) {
    if (error instanceof HallsUnavailableError) throw error;
    throw new HallsUnavailableError("could not reach the server", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export class HallsNotReadyError extends HallsUnavailableError {
  constructor() {
    super("no hall room exists yet");
    this.name = "HallsNotReadyError";
  }
}

// Covers a cold start: the page can load before the game server is listening or has created its hall rooms.
export const HALLS_RETRY_DELAYS_MS: readonly number[] = [300, 600, 1200, 2000, 3000];

export interface LoadHallsOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  onRetry?: (failures: number) => void;
}

export function loadHalls(base: string, options: LoadHallsOptions = {}): Promise<HallInfo[]> {
  return withBackoff(
    async () => {
      const halls = await fetchHalls(base, options.fetchFn, options.timeoutMs);
      if (!halls.some((info) => info.roomId !== null)) throw new HallsNotReadyError();
      return halls;
    },
    {
      delaysMs: options.delaysMs ?? HALLS_RETRY_DELAYS_MS,
      sleep: options.sleep,
      isCancelled: options.isCancelled,
      onRetry: options.onRetry,
    },
  );
}

export interface HallChoice {
  hall: number;
  roomId: string;
  fellBack: boolean;
}

export function chooseHall(halls: readonly HallInfo[], requested: number | null): HallChoice | null {
  const wanted = requested === null ? undefined : halls.find((info) => info.hall === requested);
  if (wanted && wanted.roomId !== null && !wanted.full) {
    return { hall: wanted.hall, roomId: wanted.roomId, fellBack: false };
  }
  const best = pickHall(halls);
  if (best === null) return null;
  const info = halls.find((entry) => entry.hall === best);
  if (!info || info.roomId === null) return null;
  return { hall: info.hall, roomId: info.roomId, fellBack: requested !== null };
}
