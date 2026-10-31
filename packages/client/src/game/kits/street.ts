import { AVENUE, VENUES } from "@dongjane/shared";
import { THEME } from "../../theme.ts";
import type { KitPiece, KitSpec, Vec3 } from "./kit.ts";

const { venue: c } = THEME;

export const STREET_Y = 0.03;
const KERB_WIDTH = 0.25;
const KERB_HEIGHT = 0.12;
const POST_SPACING = 8;
const POST_HEIGHT = 3.2;
// The globe's middle sits this far over the top of the post.
const GLOBE_RISE = 0.3;

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

// Where each lamp's globe hangs: along the avenue's south edge, every POST_SPACING metres, but never in front of a venue's apron.
function lampSpots(gaps: ReadonlyArray<[number, number]>): Vec3[] {
  const spots: Vec3[] = [];
  const z = AVENUE.maxZ - KERB_WIDTH - 0.15;
  for (let x = AVENUE.minX + 2; x < AVENUE.maxX - 1; x += POST_SPACING) {
    if (gaps.some(([a, b]) => x > a - 0.8 && x < b + 0.8)) continue;
    spots.push([x, POST_HEIGHT + GLOBE_RISE, z]);
  }
  return spots;
}

function posts(spots: readonly Vec3[]): { shell: KitPiece[]; lamps: KitPiece[] } {
  const shell: KitPiece[] = [];
  const lamps: KitPiece[] = [];
  for (const [x, y, z] of spots) {
    shell.push({ shape: "box", min: [x - 0.14, STREET_Y, z - 0.14], max: [x + 0.14, STREET_Y + 0.35, z + 0.14], paint: c.lampPost });
    shell.push({ shape: "cylinder", from: [x, STREET_Y + 0.3, z], to: [x, POST_HEIGHT, z], radius: 0.07, radiusTo: 0.05, sides: 8, paint: c.lampPost });
    shell.push({ shape: "cylinder", from: [x, POST_HEIGHT, z], to: [x, POST_HEIGHT + 0.08, z], radius: 0.16, sides: 8, paint: c.lampPost });
    lamps.push({ shape: "sphere", at: [x, y, z], radii: [0.2, 0.26, 0.2], sides: 10, paint: c.lampGlobe });
  }
  return { shell, lamps };
}

// The avenue along the plaza's south edge, which the venues south of it open onto: paving, a kerb along its far side and lamp posts
// whose globes light up at night.
export function streetKit(): KitSpec {
  const gaps = apronGaps();
  const spots = lampSpots(gaps);
  const lamps = posts(spots);
  return {
    id: "street",
    meshes: {
      floor: [{ shape: "floor", area: AVENUE, y: STREET_Y, step: 1, pattern: "checker", paint: [c.street, c.streetAlt] }],
      shell: [...kerbs(gaps), ...lamps.shell],
      lamps: lamps.lamps,
    },
    nightLamps: { spots, groundY: STREET_Y },
    pads: [AVENUE],
  };
}
