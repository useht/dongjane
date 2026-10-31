import { AVENUE, BATHHOUSE_POOL, BATHHOUSE_ROOMS, SEAT_TOPS, SLOT_A1, SLOT_WALL } from "@dongjane/shared";
import { THEME } from "../../theme.ts";
import type { KitCamera, KitLook, KitPiece, KitSpec, Vec3 } from "./kit.ts";
import { band, box, framedWindow, walls } from "./walled.ts";

const { venue: c } = THEME;

const { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 } = SLOT_A1;
const FLOOR_Y = 0.02;
const WALL_TOP = 3.4;
const WALL_BASE = -0.3;
const EAVE = 0.5;
const RIDGE = 5.3;
const CHIMNEY_TOP = 6.2;
const CHIMNEY_CAP = 0.25;
const MIDDLE_X = (X0 + X1) / 2;
const MIDDLE_Z = (Z0 + Z1) / 2;
const POOL_RIM = 0.18;
const RIM_TOP = 0.28;
const WATER_Y = 0.14;
const POOL_FLOOR = -0.02;

// The mat a visitor kneels on is 0.85 wide and 0.95 deep, its top at the seat's height.
export const REST_MAT = { width: 0.85, depth: 0.95 } as const;

const WALLS = { base: WALL_BASE, top: WALL_TOP, lintel: 2.6 };

// Framed windows, lit from inside the way a bathhouse is at dusk.
function windows(): { frames: KitPiece[]; panes: KitPiece[] } {
  const frames: KitPiece[] = [];
  const panes: KitPiece[] = [];
  const style = { y0: 1.5, y1: 2.6, frame: c.doorWood };
  const add = (axis: "x" | "z", wall: number, along: number, width: number): void => {
    const window = framedWindow(axis, wall, along, width, style, c.windowGlow);
    frames.push(...window.frames);
    panes.push(window.pane);
  };
  // North wall either side of the door, south wall, then east and west.
  for (const x of [MIDDLE_X - 4.8, MIDDLE_X - 3, MIDDLE_X + 3, MIDDLE_X + 4.8]) add("z", Z0 + SLOT_WALL / 2, x, 1.2);
  for (const x of [MIDDLE_X - 4.5, MIDDLE_X, MIDDLE_X + 4.5]) add("z", Z1 - SLOT_WALL / 2, x, 1.4);
  for (const z of [MIDDLE_Z - 3.5, MIDDLE_Z, MIDDLE_Z + 3.5]) add("x", X1 - SLOT_WALL / 2, z, 1.4);
  for (const z of [MIDDLE_Z - 2.5, MIDDLE_Z + 2.5]) add("x", X0 + SLOT_WALL / 2, z, 1.4);
  return { frames, panes };
}

// The sign over the door: a dark board with a lit strip along it.
function sign(): { board: KitPiece; strip: KitPiece } {
  return {
    board: box([MIDDLE_X - 2.2, 2.7, Z0 - 0.12], [MIDDLE_X + 2.2, 3.3, Z0], c.doorWood),
    strip: box([MIDDLE_X - 2, 2.85, Z0 - 0.16], [MIDDLE_X + 2, 3.15, Z0 - 0.1], c.windowGlow),
  };
}

// Lane ropes: a red and white rope between the lanes along the whole pool, floating at the water.
function ropes(): KitPiece[] {
  const pieces: KitPiece[] = [];
  const lanes = 4;
  const lane = (BATHHOUSE_POOL.maxX - BATHHOUSE_POOL.minX) / lanes;
  const start = BATHHOUSE_POOL.minZ + 0.4;
  const end = BATHHOUSE_POOL.maxZ - 0.4;
  const pieceLength = 1;
  const count = Math.round((end - start) / pieceLength);
  for (let k = 1; k < lanes; k += 1) {
    const x = BATHHOUSE_POOL.minX + lane * k;
    for (let i = 0; i < count; i += 1) {
      const a = start + ((end - start) * i) / count;
      const b = start + ((end - start) * (i + 1)) / count;
      pieces.push({ shape: "cylinder", from: [x, WATER_Y + 0.02, a], to: [x, WATER_Y + 0.02, b], radius: 0.035, sides: 6, paint: i % 2 === 0 ? c.ropeRed : c.ropeWhite });
    }
  }
  return pieces;
}

function poolRim(): KitPiece[] {
  const p = BATHHOUSE_POOL;
  return [
    box([p.minX, FLOOR_Y, p.minZ], [p.maxX, RIM_TOP, p.minZ + POOL_RIM], c.poolRim),
    box([p.minX, FLOOR_Y, p.maxZ - POOL_RIM], [p.maxX, RIM_TOP, p.maxZ], c.poolRim),
    box([p.minX, FLOOR_Y, p.minZ + POOL_RIM], [p.minX + POOL_RIM, RIM_TOP, p.maxZ - POOL_RIM], c.poolRim),
    box([p.maxX - POOL_RIM, FLOOR_Y, p.minZ + POOL_RIM], [p.maxX, RIM_TOP, p.maxZ - POOL_RIM], c.poolRim),
  ];
}

// A dark line along the middle of every lane, on the pool's bottom.
function laneLines(): KitPiece[] {
  const p = BATHHOUSE_POOL;
  const lane = (p.maxX - p.minX) / 4;
  return [0, 1, 2, 3].map((k) => {
    const x = p.minX + lane * (k + 0.5);
    return { shape: "floor", area: { minX: x - 0.06, maxX: x + 0.06, minZ: p.minZ + POOL_RIM + 0.3, maxZ: p.maxZ - POOL_RIM - 0.3 }, y: POOL_FLOOR + 0.006, step: 1, pattern: "plain", paint: c.waterDeep };
  });
}

function floors(): KitPiece[] {
  const r = BATHHOUSE_ROOMS;
  const p = BATHHOUSE_POOL;
  return [
    { shape: "floor", area: r.apron, y: 0.03, step: 1, pattern: "checker", paint: [c.street, c.streetAlt] },
    { shape: "floor", area: r.door, y: 0.03, step: 1.2, pattern: "plain", paint: c.entryStone },
    { shape: "floor", area: r.entry, y: FLOOR_Y, step: 0.8, pattern: "checker", paint: [c.entryStone, c.streetAlt] },
    { shape: "floor", area: r.westDeck, y: FLOOR_Y, step: 0.55, pattern: "checker", paint: [c.tileWhite, c.tileBlue] },
    { shape: "floor", area: r.southDeck, y: FLOOR_Y, step: 0.5, pattern: "checker", paint: [c.tileWhite, c.tileBlue] },
    { shape: "floor", area: r.restRoom, y: FLOOR_Y, step: 0.35, pattern: "boards", along: "x", paint: [c.woodWarm, c.woodWarmDark] },
    { shape: "floor", area: p, y: POOL_FLOOR, step: 0.5, pattern: "checker", paint: [c.tileWhite, c.tileBlue] },
    ...laneLines(),
  ];
}

function roof(): KitPiece[] {
  const from: Vec3 = [X0 - EAVE, WALL_TOP, Z0 - EAVE];
  const to: Vec3 = [X1 + EAVE, WALL_TOP, Z1 + EAVE];
  const chimney: Vec3 = [MIDDLE_X + 4.6, 0, Z1 - 2.8];
  return [
    { shape: "gable", from, to, ridge: RIDGE, along: "x", paint: [c.slate, c.slateEdge] },
    box([from[0], RIDGE - 0.06, MIDDLE_Z - 0.18], [to[0], RIDGE + 0.1, MIDDLE_Z + 0.18], c.slateEdge),
    { shape: "cylinder", from: [chimney[0], 3.6, chimney[2]], to: [chimney[0], CHIMNEY_TOP, chimney[2]], radius: 0.5, radiusTo: 0.42, sides: 10, paint: [c.brickDark, c.brick] },
    { shape: "cylinder", from: [chimney[0], CHIMNEY_TOP, chimney[2]], to: [chimney[0], CHIMNEY_TOP + CHIMNEY_CAP, chimney[2]], radius: 0.56, sides: 10, paint: c.brickDark },
  ];
}

// The mat, authored at the origin facing -z: a bordered rug with a lighter middle, its top at the seat's height.
function mat(): KitPiece[] {
  const half = REST_MAT.width / 2;
  const deep = REST_MAT.depth / 2;
  const top = SEAT_TOPS.bathhouse;
  return [
    box([-half, FLOOR_Y, -deep], [half, top - 0.012, deep], c.matBorder),
    box([-half + 0.06, top - 0.012, -deep + 0.06], [half - 0.06, top, deep - 0.06], c.matCream, ["-x", "+x", "-z", "+z", "-y"]),
  ];
}

const LOOK: KitLook = {
  hemisphere: { sky: c.hemiSky, ground: c.hemiGround, intensity: 1.1 },
  lamps: [
    { at: [MIDDLE_X - 3, 3.0, MIDDLE_Z + 1], color: c.lampCool, intensity: 9, distance: 11 },
    { at: [MIDDLE_X + 3.6, 3.0, MIDDLE_Z + 0.5], color: c.lampWarm, intensity: 9, distance: 11 },
  ],
  air: c.air,
  fog: { near: 22, far: 52 },
};

const CAMERA: KitCamera = {
  bounds: { minX: X0 + SLOT_WALL, maxX: X1 - SLOT_WALL, minY: 0.5, maxY: 9.5, minZ: Z0 + SLOT_WALL, maxZ: Z1 - SLOT_WALL },
  limits: { minDistance: 2.2, maxDistance: 14, minPitch: 0.16, maxPitch: 1.3 },
  view: { yaw: Math.PI, pitch: 0.75, distance: 9 },
  keepOut: { minX: X0 - EAVE, maxX: X1 + EAVE, minY: -1, maxY: CHIMNEY_TOP + CHIMNEY_CAP + 0.15, minZ: Z0 - EAVE, maxZ: Z1 + EAVE },
};

// The bathhouse: plaster walls with a lit window every few steps, a slate roof with a chimney, a pool with lane ropes on the west side
// and the rest room of wooden boards and mats on the east side.
export function bathhouseKit(): KitSpec {
  const { frames, panes } = windows();
  const board = sign();
  const apron = BATHHOUSE_ROOMS.apron;
  return {
    id: "bathhouse",
    meshes: {
      floor: floors(),
      shell: [...walls(SLOT_A1, WALLS, c.plaster), ...band(SLOT_A1, WALL_BASE, 0.6, 0.04, c.plasterShade, true), ...band(SLOT_A1, WALL_TOP - 0.25, WALL_TOP, 0.05, c.doorWood, false), ...frames, board.board, ...poolRim(), ...ropes()],
      roof: roof(),
      glow: [...panes, board.strip],
      water: [{ shape: "floor", area: { minX: BATHHOUSE_POOL.minX + POOL_RIM, maxX: BATHHOUSE_POOL.maxX - POOL_RIM, minZ: BATHHOUSE_POOL.minZ + POOL_RIM, maxZ: BATHHOUSE_POOL.maxZ - POOL_RIM }, y: WATER_Y, step: 3, pattern: "fade", along: "z", paint: [c.water, c.waterDeep] }],
      seat: mat(),
    },
    pads: [
      { minX: X0 - 0.8, maxX: X1 + 0.8, minZ: Z0 - 0.8, maxZ: Z1 + 0.8 },
      { minX: apron.minX - 0.4, maxX: apron.maxX + 0.4, minZ: AVENUE.maxZ - 1, maxZ: apron.maxZ },
    ],
    look: LOOK,
    camera: CAMERA,
  };
}
