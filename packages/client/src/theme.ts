// Single source of every colour in the service. CSS, three.js code, the Blender build and the
// brand icons all read from here; nothing else may spell a colour literal.

export const THEME = {
  ui: {
    wood: "#1c120b",
    woodSoft: "#2b1b10",
    panel: "#26180e",
    cream: "#f4e3c0",
    muted: "#c4ad88",
    gold: "#ffd27a",
    goldDeep: "#d9993a",
    goldPale: "#ffe0a0",
    ink: "#2a1a10",
    jade: "#5fb89f",
    ember: "#78341c",
  },
  scene: {
    sun: "#ffd29a",
    hemiSky: "#cfe3ff",
    hemiGround: "#9a8052",
    skyTop: "#4a8fdc",
    skyMid: "#8ec0ec",
    skyHorizon: "#dfe8ea",
    sunTwilight: "#ff9a5c",
    hemiSkyTwilight: "#ffb48c",
    hemiGroundTwilight: "#4a3a34",
    skyTopTwilight: "#3f4f8f",
    skyMidTwilight: "#c58a8f",
    skyHorizonTwilight: "#f0b08a",
    sunNight: "#7f93c8",
    hemiSkyNight: "#5a70b8",
    hemiGroundNight: "#1a1e30",
    skyTopNight: "#060a1c",
    skyMidNight: "#0e1738",
    skyHorizonNight: "#1a2748",
    overcastDay: "#b9c2cc",
    overcastNight: "#1c2236",
    cloudDay: "#f2f4f8",
    cloudNight: "#2a3248",
    stormDay: "#9aa3b0",
    stormNight: "#1c2230",
    precipDay: "#d8e4f0",
    precipNight: "#4d5a78",
    sunDisc: "#fffadc",
    sunHalo: "#ffdc96",
    moon: "#f4f1e0",
    star: "#e6edff",
    white: "#ffffff",
    envTop: "#8fc0f0",
    envMid: "#e4edf0",
    envLow: "#9a8a64",
    selfRing: "#ffd27a",
  },
  material: {
    granite: "#ece4d4",
    graniteShade: "#8f8676",
    moss: "#7f8f4a",
    paving: "#f2ece0",
    soil: "#7a5a38",
    litter: "#b9692c",
    straw: "#f0dca0",
    strawBorder: "#8a6a3a",
    pot: "#e9e2d2",
    chrysanthemum: "#f3c218",
    chrysanthemumDeep: "#e49a12",
    woodDark: "#4a2d1a",
    woodMid: "#6b4326",
    trunk: "#4a3020",
    pine: "#2f5d3a",
    pineLight: "#4f8a4a",
    maple: "#d8602f",
    leafRed: "#c2432b",
    ginkgo: "#e3a23a",
    leafGreen: "#4f8040",
    skin: "#f3cba2",
    robe: "#ffffff",
    collar: "#f6ecd2",
    sash: "#c99a3a",
    eye: "#2b1a12",
    blush: "#f0948a",
    mouth: "#9a4a3c",
    brow: "#6a3a2a",
    sandal: "#d9c28a",
    sandalCord: "#8a6a3a",
  },
  brand: {
    glowCore: "#ffe2a8",
    glowMid: "#e0974f",
    glowEdge: "#5a2f19",
    robeTop: "#d9702f",
    robeBottom: "#a64a1d",
    skin: "#ffe3c2",
    ear: "#ffd9b3",
    cheek: "#ff9c82",
    collar: "#fff1d6",
    shadow: "#4a2410",
    shine: "#fff6e6",
    mark: "#b5532e",
    line: "#4a2a18",
    mouth: "#7a3a22",
  },
} as const;

export const BRAND_COLOR = THEME.ui.ink;
export const BACKGROUND_COLOR = THEME.ui.wood;
export const FONT_STACK = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif';

const HAIRLINE = "color-mix(in srgb,var(--gold-pale) 18%,transparent)";

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function cssVariables(): string {
  const entries = Object.entries(THEME.ui).map(([key, value]) => `--${kebab(key)}:${value}`);
  entries.push(`--line:${HAIRLINE}`, `--font:${FONT_STACK}`);
  return `:root{${entries.join(";")}}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
