import { CHANT_EVERY_MS, CHANT_MS } from "./constants.ts";

export interface ChantSchedule {
  label: string;
  startsAt: number;
  durationMs: number;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function chantLabel(startsAt: number): string {
  const kst = new Date(startsAt + KST_OFFSET_MS);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} 예불`;
}

export function chantAt(
  now: number,
  everyMs: number = CHANT_EVERY_MS,
  durationMs: number = CHANT_MS,
): ChantSchedule {
  let startsAt = Math.floor(now / everyMs) * everyMs;
  if (now >= startsAt + durationMs) startsAt += everyMs;
  return { label: chantLabel(startsAt), startsAt, durationMs };
}

export function chantEndsAt(chant: { startsAt: number; durationMs: number }): number {
  return chant.startsAt + chant.durationMs;
}

export function chantPhase(
  chant: { startsAt: number; durationMs: number },
  now: number,
): "upcoming" | "active" | "ended" {
  if (now < chant.startsAt) return "upcoming";
  return now < chantEndsAt(chant) ? "active" : "ended";
}
