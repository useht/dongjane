import { BOW_MAX_TIMES } from "./constants.ts";
import { isValidWorld } from "./world.ts";
import { SEAT_COUNT, type Zone, isZone } from "./layout.ts";

export const MSG = {
  move: "move",
  sit: "sit",
  stand: "stand",
  bow: "bow",
  relocate: "relocate",
  zone: "zone",
  zoneFull: "zoneFull",
} as const;

export interface MoveMessage {
  x: number;
  z: number;
  seq?: number;
}
export interface SitMessage {
  zone: Zone;
  seatId: number;
}
export interface ZoneMessage {
  zone: Zone;
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
  zone: ZoneMessage;
}

// Sent to a visitor whose requested zone had no room left.
export interface ZoneFullMessage {
  zone: Zone;
}

export interface RelocateMessage {
  world: number;
}

export interface JoinOptions {
  hue?: number;
  zone?: Zone;
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
  if (!isRecord(payload) || !isZone(payload.zone) || !finite(payload.seatId)) return null;
  const id = payload.seatId;
  if (!Number.isInteger(id) || id < 0 || id >= SEAT_COUNT) return null;
  return { zone: payload.zone, seatId: id };
}

export function parseZone(payload: unknown): ZoneMessage | null {
  if (!isRecord(payload) || !isZone(payload.zone)) return null;
  return { zone: payload.zone };
}

export function parseZoneFull(payload: unknown): ZoneFullMessage | null {
  return parseZone(payload);
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
