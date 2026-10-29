import { BOW_MAX_TIMES } from "./constants.ts";
import { isValidWorld } from "./world.ts";
import { MAT_COUNT } from "./layout.ts";

export const MSG = {
  move: "move",
  sit: "sit",
  stand: "stand",
  bow: "bow",
  relocate: "relocate",
} as const;

export interface MoveMessage {
  x: number;
  z: number;
}
export interface SitMessage {
  matId: number;
}
export type StandMessage = Record<string, never>;
export interface BowMessage {
  times: 1 | 2 | 3;
}
export interface ClientToServerMessages {
  move: MoveMessage;
  sit: SitMessage;
  stand: StandMessage;
  bow: BowMessage;
}

export interface RelocateMessage {
  world: number;
}

export interface JoinOptions {
  hue?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseMove(payload: unknown): MoveMessage | null {
  if (!isRecord(payload) || !finite(payload.x) || !finite(payload.z)) return null;
  return { x: payload.x, z: payload.z };
}

export function parseSit(payload: unknown): SitMessage | null {
  if (!isRecord(payload) || !finite(payload.matId)) return null;
  const id = payload.matId;
  if (!Number.isInteger(id) || id < 0 || id >= MAT_COUNT) return null;
  return { matId: id };
}

export function parseBow(payload: unknown): BowMessage | null {
  if (!isRecord(payload) || !finite(payload.times)) return null;
  const times = payload.times;
  if (!Number.isInteger(times) || times < 1 || times > BOW_MAX_TIMES) return null;
  return { times: times as 1 | 2 | 3 };
}

export function parseRelocate(payload: unknown): RelocateMessage | null {
  if (!isRecord(payload) || !isValidWorld(payload.world)) return null;
  return { world: payload.world };
}
