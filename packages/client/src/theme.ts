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
    lotus: "#f2b5bd",
    ink: "#2a1a10",
    jade: "#5fb89f",
    ember: "#78341c",
  },
  scene: {
    background: "#1c120b",
    fog: "#2a1a10",
    hemiSky: "#ffe2b4",
    hemiGround: "#6b4a2a",
    sun: "#ffd29a",
    candle: "#ffb066",
    envTop: "#fff1d2",
    envMid: "#b98a52",
    envLow: "#2e1c10",
    envLamp: "#fff3db",
    envCandle: "#ffcf95",
    paperGlow: "#c79a55",
    muralGlow: "#2a1c0c",
    goldGlow: "#4a2a00",
    lotusGlow: "#3a1020",
    dust: "#fff0c8",
    beam: "#ffe2a0",
    beamTint: "#fff0c8",
    selfRing: "#ffd27a",
    nameSelf: "#ffd27a",
    nameOther: "#f4e3c0",
    nameText: "#fff4dc",
    nameBack: "#22140a",
    flameCore: "#fff6c8",
    flameMid: "#ffbe5a",
    flameEdge: "#ff8c28",
    skyTop: "#35508f",
    skyMid: "#a77fa6",
    skyLow: "#f2a77a",
    skyHorizon: "#ffd9a0",
    skyCloud: "#ffecdc",
    sunDisc: "#fffadc",
    sunHalo: "#ffdc96",
  },
  material: {
    plaster: "#eadcb9",
    plasterShade: "#d9c59a",
    woodDark: "#4a2d1a",
    woodMid: "#6b4326",
    woodCeiling: "#33200f",
    lacquer: "#9a2f20",
    lacquerDeep: "#7a2418",
    stone: "#8b8070",
    brass: "#8a6428",
    gold: "#d9ad48",
    wax: "#f6ecd8",
    wick: "#2b1a12",
    paper: "#f7e6bd",
    dancheongGreen: "#2f7d6b",
    dancheongRed: "#c43d2d",
    dancheongBlue: "#2c5d9c",
    dancheongYellow: "#e6b43c",
    dancheongWhite: "#f4e7c4",
    tile: "#4b4a48",
    lanternCoral: "#ff8a5a",
    lanternAmber: "#ffc15a",
    lanternRose: "#ff7a8a",
    lanternCream: "#ffd88a",
    lanternWood: "#4a2c18",
    cushion: "#b87a22",
    cushionTop: "#d89a2c",
    cushionStitch: "#8a3f1d",
    cushionPetal: "#f1c35a",
    floorWood: "#a8743f",
    floorGroove: "#35200f",
    muralGround: "#9a2f20",
    muralLine: "#e9c15a",
    muralInk: "#2b1a12",
    muralHalo: "#fff0b4",
    trunk: "#4a3020",
    pine: "#2f5d3a",
    maple: "#d8602f",
    ginkgo: "#e3a23a",
    leafGreen: "#4f8040",
    leafDeep: "#3d6b3a",
    leafRed: "#c2432b",
    ground: "#5b7640",
    buddhaGold: "#e2b441",
    buddhaGoldDeep: "#b98427",
    buddhaGoldPale: "#f3d77f",
    buddhaHair: "#3c4a8a",
    buddhaUrna: "#d23a3a",
    buddhaRobe: "#c13b2e",
    petal: "#f0a6b8",
    petalDeep: "#d9728f",
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
