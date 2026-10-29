import { randomHue } from "@dongjane/shared";

export interface Profile {
  hue: number;
}

export interface Settings {
  ambientVolume: number;
  effectVolume: number;
  sound: boolean;
  wind: boolean;
  reduceMotion: boolean;
}

export interface QuestProgress {
  day: number;
  counts: Record<string, number>;
}

const PROFILE_KEY = "dongjane:profile";
const SETTINGS_KEY = "dongjane:settings";
const QUESTS_KEY = "dongjane:quests";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the session still works
  }
}

export function loadProfile(): Profile | null {
  const data = readJson(PROFILE_KEY);
  if (typeof data !== "object" || data === null) return null;
  const { hue } = data as Record<string, unknown>;
  if (typeof hue !== "number" || !Number.isFinite(hue)) return null;
  return { hue: ((Math.round(hue) % 360) + 360) % 360 };
}

export function saveProfile(profile: Profile): void {
  writeJson(PROFILE_KEY, profile);
}

export function newHue(): number {
  return randomHue();
}

export function defaultSettings(): Settings {
  const prefersReduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { ambientVolume: 0.7, effectVolume: 0.7, sound: true, wind: true, reduceMotion: prefersReduced };
}

function volumeOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  const data = readJson(SETTINGS_KEY);
  if (typeof data !== "object" || data === null) return base;
  const raw = data as Record<string, unknown>;
  const legacyVolume = volumeOr(raw.volume, base.ambientVolume);
  return {
    ambientVolume: volumeOr(raw.ambientVolume, legacyVolume),
    effectVolume: volumeOr(raw.effectVolume, legacyVolume),
    sound: typeof raw.sound === "boolean" ? raw.sound : base.sound,
    wind: typeof raw.wind === "boolean" ? raw.wind : base.wind,
    reduceMotion: typeof raw.reduceMotion === "boolean" ? raw.reduceMotion : base.reduceMotion,
  };
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings);
}

export function loadQuestProgress(): QuestProgress | null {
  const data = readJson(QUESTS_KEY);
  if (typeof data !== "object" || data === null) return null;
  const { day, counts } = data as Record<string, unknown>;
  if (typeof day !== "number" || !Number.isInteger(day) || typeof counts !== "object" || counts === null) return null;
  const clean: Record<string, number> = {};
  for (const [id, value] of Object.entries(counts)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) clean[id] = Math.floor(value);
  }
  return { day, counts: clean };
}

export function saveQuestProgress(progress: QuestProgress): void {
  writeJson(QUESTS_KEY, progress);
}
