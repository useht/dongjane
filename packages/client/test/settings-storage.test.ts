import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "../src/storage.ts";

function stubSettings(saved: unknown): void {
  const store = new Map<string, string>([["dongjane:settings", JSON.stringify(saved)]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
}

describe("loadSettings volumes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries a legacy single volume over to both channels", () => {
    stubSettings({ volume: 0.4 });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0.4);
    expect(settings.effectVolume).toBe(0.4);
  });

  it("turns a legacy sound-off switch into zero volume on both channels", () => {
    stubSettings({ volume: 0.4, sound: false });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0);
    expect(settings.effectVolume).toBe(0);
  });

  it("turns a legacy wind-off switch into zero background volume only", () => {
    stubSettings({ ambientVolume: 0.5, effectVolume: 0.5, wind: false });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0);
    expect(settings.effectVolume).toBe(0.5);
  });

  it("keeps separate background and effect volumes", () => {
    stubSettings({ ambientVolume: 0.2, effectVolume: 0.9 });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0.2);
    expect(settings.effectVolume).toBe(0.9);
  });

  it("prefers the new fields over a legacy volume", () => {
    stubSettings({ volume: 0.4, ambientVolume: 0.1 });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0.1);
    expect(settings.effectVolume).toBe(0.4);
  });

  it("clamps out-of-range volumes", () => {
    stubSettings({ ambientVolume: -3, effectVolume: 7 });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0);
    expect(settings.effectVolume).toBe(1);
  });

  it("falls back to the default for invalid volumes", () => {
    stubSettings({ ambientVolume: "loud", effectVolume: null });
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(0.7);
    expect(settings.effectVolume).toBe(0.7);
  });
});
