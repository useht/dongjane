import { NAME_MAX_LENGTH } from "./constants.ts";

const STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.normalize("NFC").replace(STRIP, "").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join("").trim();
}

export function normalizeHue(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const hue = Math.round(raw) % 360;
  return hue < 0 ? hue + 360 : hue;
}

export function defaultName(random: () => number = Math.random): string {
  return `동자${10 + Math.floor(random() * 90)}`;
}

export function randomHue(random: () => number = Math.random): number {
  return Math.floor(random() * 360);
}
