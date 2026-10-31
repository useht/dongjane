import { AVENUE, VENUES } from "@dongjane/shared";
import { THEME } from "../../theme.ts";
import type { KitPiece, KitSpec } from "./kit.ts";

const { venue: c } = THEME;

export const STREET_Y = 0.03;
const KERB_WIDTH = 0.25;
const KERB_HEIGHT = 0.12;
const POST_SPACING = 8;
const POST_HEIGHT = 3.2;

// The stretches of the avenue's south edge where a venue's apron meets it: the kerb is open there.
export function apronGaps(): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  for (const venue of VENUES) {
    if (venue.id === "street") continue;
    for (const area of venue.areas) if (Math.abs(area.minZ - AVENUE.maxZ) < 1e-6) gaps.push([area.minX, area.maxX]);
  }
  return gaps.sort((a, b) => a[0] - b[0]);
}

function kerbs(gaps: ReadonlyArray<[number, number]>): KitPiece[] {
  const pieces: KitPiece[] = [];
  let from: number = AVENUE.minX;
  const kerb = (a: number, b: number): void => {
    if (b - a > 0.05) pieces.push({ shape: "box", min: [a, STREET_Y, AVENUE.maxZ - KERB_WIDTH], max: [b, STREET_Y + KERB_HEIGHT, AVENUE.maxZ], paint: c.kerb });
  };
  for (const [a, b] of gaps) {
    kerb(from, a);
    from = b;
  }
  kerb(from, AVENUE.maxX);
  return pieces;
}

function posts(gaps: ReadonlyArray<[number, number]>): { shell: KitPiece[]; glow: KitPiece[] } {
  const shell: KitPiece[] = [];
  const glow: KitPiece[] = [];
  const z = AVENUE.maxZ - KERB_WIDTH - 0.15;
  for (let x = AVENUE.minX + 2; x < AVENUE.maxX - 1; x += POST_SPACING) {
    if (gaps.some(([a, b]) => x > a - 0.8 && x < b + 0.8)) continue;
    shell.push({ shape: "box", min: [x - 0.14, STREET_Y, z - 0.14], max: [x + 0.14, STREET_Y + 0.35, z + 0.14], paint: c.lampPost });
    shell.push({ shape: "cylinder", from: [x, STREET_Y + 0.3, z], to: [x, POST_HEIGHT, z], radius: 0.07, radiusTo: 0.05, sides: 8, paint: c.lampPost });
    shell.push({ shape: "cylinder", from: [x, POST_HEIGHT, z], to: [x, POST_HEIGHT + 0.08, z], radius: 0.16, sides: 8, paint: c.lampPost });
    glow.push({ shape: "sphere", at: [x, POST_HEIGHT + 0.3, z], radii: [0.2, 0.26, 0.2], sides: 10, paint: c.lampGlobe });
  }
  return { shell, glow };
}

// The avenue along the plaza's south edge, which the venues south of it open onto: paving, a kerb along its far side and lamp posts.
export function streetKit(): KitSpec {
  const gaps = apronGaps();
  const lamps = posts(gaps);
  return {
    id: "street",
    meshes: {
      floor: [{ shape: "floor", area: AVENUE, y: STREET_Y, step: 1, pattern: "checker", paint: [c.street, c.streetAlt] }],
      shell: [...kerbs(gaps), ...lamps.shell],
      glow: lamps.glow,
    },
    pads: [AVENUE],
  };
}
