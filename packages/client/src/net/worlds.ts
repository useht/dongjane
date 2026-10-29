import {
  WORLDS_PATH,
  SEAT_PATH,
  type WorldInfo,
  type WorldListResponse,
  type SeatRequest,
  type SeatResponse,
  isValidWorld,
  parseWorldParam,
} from "@dongjane/shared";
import { withBackoff } from "./retry.ts";

export class WorldsUnavailableError extends Error {
  constructor(message = "worlds unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorldsUnavailableError";
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
    if (!response.ok) throw new WorldsUnavailableError(`request failed with ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof WorldsUnavailableError) throw error;
    throw new WorldsUnavailableError("could not reach the server", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWorlds(base: string, fetchFn: typeof fetch = defaultFetch, timeoutMs = 6000): Promise<WorldInfo[]> {
  const body = (await request(`${base}${WORLDS_PATH}`, {}, fetchFn, timeoutMs)) as Partial<WorldListResponse> | null;
  if (!Array.isArray(body?.worlds)) throw new WorldsUnavailableError("malformed world list");
  return body.worlds.filter((info): info is WorldInfo => isValidWorld(info?.world));
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
  const payload: SeatRequest = { world: requested };
  return withBackoff(
    async () => {
      const body = (await request(
        `${base}${SEAT_PATH}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
        options.fetchFn ?? defaultFetch,
        options.timeoutMs ?? 6000,
      )) as Partial<SeatResponse> | null;
      if (!isValidWorld(body?.world) || typeof body.roomId !== "string" || body.roomId === "") {
        throw new WorldsUnavailableError("malformed seat");
      }
      return { world: body.world, roomId: body.roomId, fellBack: body.fellBack === true };
    },
    {
      delaysMs: options.delaysMs ?? SEAT_RETRY_DELAYS_MS,
      sleep: options.sleep,
      isCancelled: options.isCancelled,
      onRetry: options.onRetry,
    },
  );
}

export type WorldEntryCheck =
  | { ok: true; world: number }
  | { ok: false; reason: "invalid" | "current" | "missing" | "full"; world: number | null };

export function checkWorldEntry(worlds: readonly WorldInfo[], current: number, typed: string): WorldEntryCheck {
  const world = parseWorldParam(typed.trim());
  if (world === null) return { ok: false, reason: "invalid", world };
  if (world === current) return { ok: false, reason: "current", world };
  const info = worlds.find((entry) => entry.world === world);
  if (!info) return { ok: false, reason: "missing", world };
  if (info.full) return { ok: false, reason: "full", world };
  return { ok: true, world };
}
