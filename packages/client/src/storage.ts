import { randomHue, sanitizeName } from "@dongjane/shared";

export interface Profile {
  name: string;
  hue: number;
}

export interface Settings {
  volume: number;
  sound: boolean;
  wind: boolean;
  reduceMotion: boolean;
}

const PROFILE_KEY = "dongjane:profile";
const SETTINGS_KEY = "dongjane:settings";

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
  const { name, hue } = data as Record<string, unknown>;
  const clean = sanitizeName(name);
  if (clean === "" || typeof hue !== "number" || !Number.isFinite(hue)) return null;
  return { name: clean, hue: ((Math.round(hue) % 360) + 360) % 360 };
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
  return { volume: 0.7, sound: true, wind: true, reduceMotion: prefersReduced };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  const data = readJson(SETTINGS_KEY);
  if (typeof data !== "object" || data === null) return base;
  const raw = data as Record<string, unknown>;
  return {
    volume: typeof raw.volume === "number" && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : base.volume,
    sound: typeof raw.sound === "boolean" ? raw.sound : base.sound,
    wind: typeof raw.wind === "boolean" ? raw.wind : base.wind,
    reduceMotion: typeof raw.reduceMotion === "boolean" ? raw.reduceMotion : base.reduceMotion,
  };
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings);
}
