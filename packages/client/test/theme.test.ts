import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brandMarkSvg } from "../scripts/brand-mark.ts";
import { themePlugin } from "../vite.config.ts";
import { BACKGROUND_COLOR, BRAND_COLOR, THEME, cssVariables, withAlpha } from "../src/theme.ts";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
const LAYOUT_VARIABLE = /^--(safe|hud)-/;

function literals(source: string): string[] {
  return source.match(COLOR_LITERAL) ?? [];
}

describe("theme tokens", () => {
  it("spells every colour as #rrggbb", () => {
    for (const [group, tokens] of Object.entries(THEME)) {
      for (const [key, value] of Object.entries(tokens)) {
        expect(value, `${group}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("exposes every ui token as a kebab-cased CSS variable", () => {
    const css = cssVariables();
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--wood-soft:#2b1b10");
    expect(css).toContain("--gold-deep:");
    expect(css).toContain("--font:");
    for (const key of Object.keys(THEME.ui)) {
      expect(css).toContain(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${THEME.ui[key as keyof typeof THEME.ui]}`);
    }
  });

  it("blends a token into a canvas colour", () => {
    expect(withAlpha("#22140a", 0.62)).toBe("rgba(34, 20, 10, 0.62)");
  });
});

describe("theme in CSS and HTML", () => {
  it("keeps colour literals out of style.css, index.html and vite.config.ts", () => {
    for (const file of ["src/style.css", "index.html", "vite.config.ts"]) {
      expect(literals(read(file)), file).toEqual([]);
    }
  });

  it("only declares layout variables in style.css", () => {
    const declared = [...read("src/style.css").matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) expect(name).toMatch(LAYOUT_VARIABLE);
  });

  it("defines every variable that style.css reads", () => {
    const defined = new Set([...cssVariables().matchAll(/(--[a-z-]+):/g)].map((match) => match[1] as string));
    const used = new Set([...read("src/style.css").matchAll(/var\((--[a-z-]+)/g)].map((match) => match[1] as string));
    for (const name of used) {
      expect(defined.has(name) || LAYOUT_VARIABLE.test(name), name).toBe(true);
    }
  });

  it("injects the variables and the theme-color meta into the document head", () => {
    const tags = themePlugin().transformIndexHtml as () => Array<{ tag: string; attrs?: Record<string, string>; children?: string }>;
    const injected = tags();
    expect(injected.find((tag) => tag.tag === "style")?.children).toBe(cssVariables());
    expect(injected.find((tag) => tag.tag === "meta")?.attrs).toEqual({ name: "theme-color", content: BRAND_COLOR });
    expect(BRAND_COLOR).toBe(THEME.ui.ink);
    expect(BACKGROUND_COLOR).toBe(THEME.ui.wood);
  });
});

describe("brand mark", () => {
  it("matches the committed favicon", () => {
    expect(read("public/favicon.svg")).toBe(brandMarkSvg(1));
  });

  it("paints with every brand token and no other colour", () => {
    const svg = brandMarkSvg(1);
    for (const color of Object.values(THEME.brand)) expect(svg).toContain(color);
    const used = new Set(svg.match(/#[0-9a-f]{6}/g));
    expect([...used].sort()).toEqual([...new Set(Object.values(THEME.brand))].sort());
  });

  it("shrinks the artwork for the maskable icon without touching the background", () => {
    expect(brandMarkSvg(0.78)).toContain("scale(0.78)");
    expect(brandMarkSvg(0.78)).toContain('<rect width="512" height="512" fill="url(#glow)"/>');
  });
});
