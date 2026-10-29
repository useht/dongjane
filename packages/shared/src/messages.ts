import { BOW_MAX_TIMES } from "./constants.ts";
import { isValidEmote } from "./emote.ts";
import { isValidHall } from "./hall.ts";
import { CUSHION_COUNT } from "./layout.ts";

export const MSG = {
  move: "move",
  sit: "sit",
  stand: "stand",
  bow: "bow",
  emote: "emote",
  jump: "jump",
  relocate: "relocate",
} as const;

export interface MoveMessage {
  x: number;
  z: number;
  seq?: number;
}
export interface SitMessage {
  cushionId: number;
}
export type StandMessage = Record<string, never>;
export interface BowMessage {
  times: 1 | 2 | 3;
}
export interface EmoteMessage {
  id: number;
}
export interface ClientToServerMessages {
  move: MoveMessage;
  sit: SitMessage;
  stand: StandMessage;
  bow: BowMessage;
  emote: EmoteMessage;
  jump: Record<string, never>;
}

export interface RelocateMessage {
  hall: number;
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

const MAX_MOVE_SEQ = 0xffffffff;

export function parseMove(payload: unknown): (MoveMessage & { seq: number }) | null {
  if (!isRecord(payload) || !finite(payload.x) || !finite(payload.z)) return null;
  const seq = payload.seq;
  const valid = typeof seq === "number" && Number.isInteger(seq) && seq >= 0 && seq <= MAX_MOVE_SEQ;
  return { x: payload.x, z: payload.z, seq: valid ? seq : 0 };
}

export function parseSit(payload: unknown): SitMessage | null {
  if (!isRecord(payload) || !finite(payload.cushionId)) return null;
  const id = payload.cushionId;
  if (!Number.isInteger(id) || id < 0 || id >= CUSHION_COUNT) return null;
  return { cushionId: id };
}

export function parseBow(payload: unknown): BowMessage | null {
  if (!isRecord(payload) || !finite(payload.times)) return null;
  const times = payload.times;
  if (!Number.isInteger(times) || times < 1 || times > BOW_MAX_TIMES) return null;
  return { times: times as 1 | 2 | 3 };
}

export function parseEmote(payload: unknown): EmoteMessage | null {
  if (!isRecord(payload) || !isValidEmote(payload.id)) return null;
  return { id: payload.id };
}

export function parseRelocate(payload: unknown): RelocateMessage | null {
  if (!isRecord(payload) || !isValidHall(payload.hall)) return null;
  return { hall: payload.hall };
}
