import { AVENUE, BENCH_HIPS_BACK, CHURCH_AISLE, CHURCH_CANDLES, CHURCH_CHAIR, CHURCH_DAIS_FROM, CHURCH_PEWS, CHURCH_PEW_OUT, CHURCH_RACK_SIZE, CHURCH_ROOMS, DOOR_WIDTH, SEAT_TOPS, SLOT_A2, SLOT_WALL } from "@dongjane/shared";
import { THEME } from "../../theme.ts";
import type { KitCamera, KitLook, KitPiece, KitSpec } from "./kit.ts";
import { band, box, framedWindow, walls } from "./walled.ts";

const { venue: c } = THEME;

const { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 } = SLOT_A2;
const MIDDLE_X = (X0 + X1) / 2;
const MIDDLE_Z = (Z0 + Z1) / 2;
const FLOOR_Y = 0.02;
const WALL_TOP = 4.2;
const WALL_BASE = -0.3;
const LINTEL = 2.9;
const EAVE = 0.5;
const RIDGE = 7.4;
const TOWER_HALF = 1.7;
const TOWER_DEPTH = 3.4;
const TOWER_TOP = 8.6;
const TOWER_RIDGE = 10.6;
const CROSS_TOP = TOWER_RIDGE + 1.1;
const DAIS_TOP = 0.32;
const DOOR_HALF = DOOR_WIDTH / 2;
const RUNNER_LIFT = 0.008;
const TRIM_LIFT = 0.014;

// A chair is authored at the origin facing -z, with its seat reaching back from the place, as deep as the layout says; the monk sits
// on it with its hips that far behind the place, so the seat's middle is under them. The seat's top is at the seat's height and the
// back, a hand's breadth thick against the pew behind, rises a little above it.
export const CHAIR = { width: CHURCH_CHAIR.width, depth: CHURCH_CHAIR.depth, behind: BENCH_HIPS_BACK, back: 0.3 } as const;

// The pews are a bench in front of each strip: the back of the pew ahead, 0.72 high, with a ledge for a book on the side of the monk
// behind it and a post at its aisle end. The bench stops short of the post, so no two faces coincide.
const PEW_TOP = 0.72;
const LEDGE = { top: 0.58, thick: 0.04, reach: 0.1, lip: 0.04 } as const;

const WALLS = { base: WALL_BASE, top: WALL_TOP, lintel: LINTEL };
const WINDOW = { y0: 1.3, y1: 3.5, frame: c.pewWoodDark };
const GLASS = [c.glassBlue, c.glassRed, c.glassGold] as const;

// Tall windows of coloured glass, lit from within: three down each side of the nave, one each side of the altar and of the door.
function windows(): { frames: KitPiece[]; panes: KitPiece[] } {
  const frames: KitPiece[] = [];
  const panes: KitPiece[] = [];
  let next = 0;
  const add = (axis: "x" | "z", wall: number, along: number): void => {
    const window = framedWindow(axis, wall, along, 1, WINDOW, GLASS[next % GLASS.length] as string);
    next += 1;
    frames.push(...window.frames);
    panes.push(window.pane);
  };
  for (const x of [MIDDLE_X - 4.2, MIDDLE_X + 4.2]) add("z", Z0 + SLOT_WALL / 2, x);
  for (const z of [MIDDLE_Z - 3.4, MIDDLE_Z - 0.4, MIDDLE_Z + 2.6]) {
    add("x", X0 + SLOT_WALL / 2, z);
    add("x", X1 - SLOT_WALL / 2, z);
  }
  for (const x of [MIDDLE_X - 3.8, MIDDLE_X + 3.8]) add("z", Z1 - SLOT_WALL / 2, x);
  return { frames, panes };
}

// The posts and the beam round the doorway, a hand proud of the wall on both faces.
function doorFrame(): KitPiece[] {
  const out = 0.1;
  const post = 0.14;
  return [
    box([MIDDLE_X - DOOR_HALF - post, FLOOR_Y, Z0 - out], [MIDDLE_X - DOOR_HALF, LINTEL, Z0 + SLOT_WALL + out], c.plaster),
    box([MIDDLE_X + DOOR_HALF, FLOOR_Y, Z0 - out], [MIDDLE_X + DOOR_HALF + post, LINTEL, Z0 + SLOT_WALL + out], c.plaster),
    box([MIDDLE_X - DOOR_HALF - post, LINTEL, Z0 - out], [MIDDLE_X + DOOR_HALF + post, LINTEL + 0.2, Z0 + SLOT_WALL + out], c.plaster),
  ];
}

// The benches: each strip has one in front, and the last row has one in the gap behind it, between the strip and the narthex.
function pews(): KitPiece[] {
  const pieces: KitPiece[] = [];
  const post = 0.1;
  const gap = { minZ: CHURCH_ROOMS.narthex.maxZ, maxZ: Math.min(...CHURCH_PEWS.map((pew) => pew.strip.minZ)) };
  const benches = [
    ...CHURCH_PEWS.map(({ side, bench }) => ({ side, bench })),
    ...(["west", "east"] as const).map((side) => ({
      side,
      bench: { minX: MIDDLE_X + (side === "west" ? -CHURCH_PEW_OUT : CHURCH_AISLE), maxX: MIDDLE_X + (side === "west" ? -CHURCH_AISLE : CHURCH_PEW_OUT), ...gap },
    })),
  ];
  for (const { side, bench } of benches) {
    const west = side === "west";
    const body = west ? { minX: bench.minX, maxX: bench.maxX - post } : { minX: bench.minX + post, maxX: bench.maxX };
    const end = west ? { minX: bench.maxX - post, maxX: bench.maxX } : { minX: bench.minX, maxX: bench.minX + post };
    const board = bench.minZ + LEDGE.reach;
    pieces.push(box([body.minX, FLOOR_Y, board], [body.maxX, PEW_TOP, bench.maxZ], [c.pewWoodDark, c.pewWood]));
    pieces.push(box([body.minX, LEDGE.top - LEDGE.thick, bench.minZ], [body.maxX, LEDGE.top, board], c.pewWood));
    pieces.push(box([body.minX, LEDGE.top, bench.minZ], [body.maxX, LEDGE.top + LEDGE.lip, bench.minZ + LEDGE.thick], c.pewWood));
    pieces.push(box([end.minX, FLOOR_Y, bench.minZ], [end.maxX, 1.05, bench.maxZ], c.pewWoodDark));
  }
  return pieces;
}

function floors(): KitPiece[] {
  const r = CHURCH_ROOMS;
  const nave = { minZ: r.narthex.maxZ, maxZ: r.chancel.minZ };
  const aisle = { minX: MIDDLE_X - CHURCH_AISLE, maxX: MIDDLE_X + CHURCH_AISLE };
  const chancel = { minX: r.chancel.minX, maxX: r.chancel.maxX, minZ: r.chancel.minZ, maxZ: MIDDLE_Z + CHURCH_DAIS_FROM };
  const edge = 0.06;
  const runner = (z0: number, z1: number, lift: number): KitPiece[] => [
    { shape: "floor", area: { ...aisle, minZ: z0, maxZ: z1 }, y: FLOOR_Y + lift, step: 1, pattern: "plain", paint: c.aisleRed },
    { shape: "floor", area: { minX: aisle.minX + 0.1, maxX: aisle.minX + 0.1 + edge, minZ: z0, maxZ: z1 }, y: FLOOR_Y + lift + 0.006, step: 1, pattern: "plain", paint: c.gold },
    { shape: "floor", area: { minX: aisle.maxX - 0.1 - edge, maxX: aisle.maxX - 0.1, minZ: z0, maxZ: z1 }, y: FLOOR_Y + lift + 0.006, step: 1, pattern: "plain", paint: c.gold },
  ];
  return [
    { shape: "floor", area: r.apron, y: 0.03, step: 1, pattern: "checker", paint: [c.street, c.streetAlt] },
    { shape: "floor", area: r.door, y: 0.03, step: 1.2, pattern: "plain", paint: c.entryStone },
    { shape: "floor", area: r.narthex, y: FLOOR_Y, step: 1.1, pattern: "checker", paint: [c.entryStone, c.streetAlt] },
    { shape: "floor", area: { minX: r.chancel.minX, maxX: aisle.minX, ...nave }, y: FLOOR_Y, step: 0.5, pattern: "boards", along: "z", paint: [c.woodWarm, c.woodWarmDark] },
    { shape: "floor", area: { minX: aisle.maxX, maxX: r.chancel.maxX, ...nave }, y: FLOOR_Y, step: 0.5, pattern: "boards", along: "z", paint: [c.woodWarm, c.woodWarmDark] },
    ...runner(nave.minZ, nave.maxZ, 0),
    { shape: "floor", area: chancel, y: FLOOR_Y, step: 1.1, pattern: "checker", paint: [c.altarStone, c.entryStone] },
    ...runner(nave.maxZ, chancel.maxZ, RUNNER_LIFT),
  ];
}

// The dais, the altar with two candles on it, and the cross on the wall behind.
function sanctuary(): { shell: KitPiece[]; glow: KitPiece[] } {
  const front = MIDDLE_Z + CHURCH_DAIS_FROM;
  const altarZ = MIDDLE_Z + 5.4;
  const wall = Z1 - SLOT_WALL;
  const sticks = [-0.8, 0.8].map((u) => MIDDLE_X + u);
  return {
    shell: [
      box([X0 + SLOT_WALL, FLOOR_Y, front], [X1 - SLOT_WALL, DAIS_TOP, wall], c.altarStone),
      box([MIDDLE_X - 1.1, DAIS_TOP, altarZ - 0.4], [MIDDLE_X + 1.1, 1.15, altarZ + 0.4], c.altarCloth),
      box([MIDDLE_X - 1.25, 1.15, altarZ - 0.5], [MIDDLE_X + 1.25, 1.22, altarZ + 0.5], c.pewWood),
      ...sticks.map((x) => box([x - 0.04, 1.22, altarZ - 0.04], [x + 0.04, 1.5, altarZ + 0.04], c.gold)),
      box([MIDDLE_X - 0.1, 1.8, wall - 0.08], [MIDDLE_X + 0.1, 3.9, wall], c.gold),
      box([MIDDLE_X - 0.55, 3.15, wall - 0.08], [MIDDLE_X + 0.55, 3.4, wall], c.gold),
    ],
    glow: sticks.map((x): KitPiece => ({ shape: "cylinder", from: [x, 1.5, altarZ], to: [x, 1.6, altarZ], radius: 0.035, radiusTo: 0, sides: 4, paint: c.flame, flat: true })),
  };
}

// The racks of votive candles in front of the dais: a stand and a tray with four candles, each with its flame.
function racks(): { shell: KitPiece[]; glow: KitPiece[] } {
  const shell: KitPiece[] = [];
  const glow: KitPiece[] = [];
  const { width, depth } = CHURCH_RACK_SIZE;
  for (const rack of CHURCH_CANDLES) {
    const [x0, x1, z0, z1] = [rack.x - width / 2, rack.x + width / 2, rack.z - depth / 2, rack.z + depth / 2];
    shell.push(box([x0, FLOOR_Y, z0], [x1, 0.75, z1], c.pewWoodDark));
    shell.push(box([x0 - 0.04, 0.75, z0 - 0.04], [x1 + 0.04, 0.8, z1 + 0.04], c.pewWood));
    for (const u of [-0.36, -0.12, 0.12, 0.36]) {
      const x = rack.x + u;
      shell.push(box([x - 0.035, 0.8, rack.z - 0.035], [x + 0.035, 1, rack.z + 0.035], c.candleWax, ["-y"]));
      glow.push({ shape: "cylinder", from: [x, 1, rack.z], to: [x, 1.1, rack.z], radius: 0.03, radiusTo: 0, sides: 4, paint: c.flame, flat: true });
    }
  }
  return { shell, glow };
}

// A brick tower over the door, with a slate cap and a cross on it. It stands in the roof's mesh, so it goes with the roof when the camera is inside.
function tower(): KitPiece[] {
  const x0 = MIDDLE_X - TOWER_HALF;
  const x1 = MIDDLE_X + TOWER_HALF;
  const z0 = Z0 - 0.05;
  const z1 = Z0 + TOWER_DEPTH;
  const middleZ = (z0 + z1) / 2;
  return [
    box([x0, WALL_TOP - 0.3, z0], [x1, TOWER_TOP, z1], c.brick),
    box([MIDDLE_X - 0.5, 6.3, z0 - 0.06], [MIDDLE_X + 0.5, 7.9, z0], c.doorWood),
    box([x1, 6.3, middleZ - 0.5], [x1 + 0.06, 7.9, middleZ + 0.5], c.doorWood),
    box([x0 - 0.06, 6.3, middleZ - 0.5], [x0, 7.9, middleZ + 0.5], c.doorWood),
    box([x0 - 0.1, TOWER_TOP - 0.2, z0 - 0.1], [x1 + 0.1, TOWER_TOP, z1 + 0.1], c.plaster),
    { shape: "gable", from: [x0 - 0.2, TOWER_TOP, z0 - 0.2], to: [x1 + 0.2, TOWER_TOP, z1 + 0.2], ridge: TOWER_RIDGE, along: "z", paint: [c.slate, c.slateEdge] },
    box([MIDDLE_X - 0.06, TOWER_RIDGE, middleZ - 0.06], [MIDDLE_X + 0.06, CROSS_TOP, middleZ + 0.06], c.gold),
    box([MIDDLE_X - 0.3, CROSS_TOP - 0.4, middleZ - 0.06], [MIDDLE_X + 0.3, CROSS_TOP - 0.2, middleZ + 0.06], c.gold),
  ];
}

function roof(): KitPiece[] {
  const from = [X0 - EAVE, WALL_TOP, Z0 - EAVE] as const;
  const to = [X1 + EAVE, WALL_TOP, Z1 + EAVE] as const;
  return [
    { shape: "gable", from, to, ridge: RIDGE, along: "z", paint: [c.slate, c.slateEdge] },
    box([MIDDLE_X - 0.15, RIDGE - 0.06, from[2]], [MIDDLE_X + 0.15, RIDGE + 0.08, to[2]], c.slateEdge),
    ...tower(),
  ];
}

// The chair a visitor sits on, authored at the origin facing -z: four legs, a board with a red cushion on it whose top is the seat's
// height, and a low back at the rear edge, where the pew behind stands.
function chair(): KitPiece[] {
  const half = CHAIR.width / 2;
  const top = SEAT_TOPS.church;
  const board = top - 0.04;
  const leg = 0.04;
  const back = 0.025;
  const upright = 0.04;
  const legs = [-half, half - leg].flatMap((x) =>
    [0, CHAIR.depth - leg].map((z) => box([x, FLOOR_Y, z], [x + leg, board, z + leg], c.pewWoodDark)),
  );
  return [
    ...legs,
    box([-half, board, 0], [half, top - 0.012, CHAIR.depth], c.pewWood),
    box([-half + 0.03, top - 0.012, 0.03], [half - 0.03, top, CHAIR.depth - 0.03], c.kneelerRed, ["-x", "+x", "-z", "+z", "-y"]),
    box([-half, board, CHAIR.depth - back], [-half + upright, top + CHAIR.back, CHAIR.depth], c.pewWoodDark),
    box([half - upright, board, CHAIR.depth - back], [half, top + CHAIR.back, CHAIR.depth], c.pewWoodDark),
    box([-half + upright, top + CHAIR.back * 0.4, CHAIR.depth - back], [half - upright, top + CHAIR.back, CHAIR.depth], c.pewWood),
  ];
}

const LOOK: KitLook = {
  hemisphere: { sky: c.hemiSky, ground: c.hemiGround, intensity: 1 },
  lamps: [
    { at: [MIDDLE_X, 3.6, MIDDLE_Z - 1.5], color: c.lampWarm, intensity: 10, distance: 12 },
    { at: [MIDDLE_X, 3.4, MIDDLE_Z + 4.2], color: c.lampWarm, intensity: 8, distance: 9 },
  ],
  air: c.airChurch,
  fog: { near: 20, far: 48 },
};

const CAMERA: KitCamera = {
  bounds: { minX: X0 + SLOT_WALL, maxX: X1 - SLOT_WALL, minY: 0.5, maxY: 10.5, minZ: Z0 + SLOT_WALL, maxZ: Z1 - SLOT_WALL },
  limits: { minDistance: 2.2, maxDistance: 14, minPitch: 0.16, maxPitch: 1.3 },
  view: { yaw: Math.PI, pitch: 0.75, distance: 9 },
  keepOut: { minX: X0 - EAVE, maxX: X1 + EAVE, minY: -1, maxY: CROSS_TOP + 0.15, minZ: Z0 - EAVE, maxZ: Z1 + EAVE },
};

// The church: brick walls with a window of coloured glass every few steps, a slate roof with a tower over the door, five rows of pews
// either side of a red runner, and the altar on its dais behind racks of candles.
export function churchKit(): KitSpec {
  const { frames, panes } = windows();
  const altar = sanctuary();
  const candles = racks();
  const apron = CHURCH_ROOMS.apron;
  return {
    id: "church",
    meshes: {
      floor: floors(),
      shell: [
        ...walls(SLOT_A2, WALLS, c.brick),
        ...band(SLOT_A2, WALL_BASE, 0.7, 0.04, c.brickDark, true),
        ...band(SLOT_A2, WALL_TOP - 0.3, WALL_TOP, 0.05, c.plaster, false),
        ...doorFrame(),
        ...frames,
        ...pews(),
        ...altar.shell,
        ...candles.shell,
      ],
      roof: roof(),
      glow: [...panes, ...altar.glow, ...candles.glow],
      seat: chair(),
    },
    pads: [
      { minX: X0 - 0.8, maxX: X1 + 0.8, minZ: Z0 - 0.8, maxZ: Z1 + 0.8 },
      { minX: apron.minX - 0.4, maxX: apron.maxX + 0.4, minZ: AVENUE.maxZ - 1, maxZ: apron.maxZ },
    ],
    look: LOOK,
    camera: CAMERA,
  };
}
