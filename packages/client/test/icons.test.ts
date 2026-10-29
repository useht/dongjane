import { describe, expect, it } from "vitest";
import { ICON_NAMES, iconMarkup } from "../src/ui/icons.ts";

describe("ui icons", () => {
  it("registers the eight hud icons", () => {
    expect([...ICON_NAMES].sort()).toEqual(["close", "gear", "hall", "link", "people", "sit", "soundOff", "soundOn"]);
  });

  it("draws every icon as a 24px stroke that follows the text colour", () => {
    for (const name of ICON_NAMES) {
      const svg = iconMarkup(name);
      expect(svg, name).toContain('viewBox="0 0 24 24"');
      expect(svg, name).toContain('stroke="currentColor"');
      expect(svg, name).toMatch(/<(path|circle)\b/);
      expect(svg, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|hsl/);
    }
  });

  it("sizes the icon on request", () => {
    expect(iconMarkup("hall", 16)).toContain('width="16" height="16"');
  });
});
