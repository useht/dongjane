import { AVENUE, BONFIRE_BACK_Z, BONFIRE_FIRE, BONFIRE_PIT, BONFIRE_PIT_HALF, BONFIRE_PLACE_PITCH, BONFIRE_ROOMS, type Bounds, SEAT_TOPS, SLOT_B1 } from "@dongjane/shared";
import { THEME } from "../../theme.ts";
import type { KitCamera, KitLook, KitPiece, KitSpec } from "./kit.ts";
import { box } from "./walled.ts";

const { venue: c } = THEME;

const FIRE = BONFIRE_FIRE;
const FLOOR_Y = 0.02;
const LANE_Y = 0.03;
const ASH_LIFT = 0.012;
const BASE = -0.3;
const ASH_RING = 0.6;
const LANTERN_TOP = 2.6;

// A place on a log, authored at the origin facing -z: one piece of the trunk, as long as the places are apart, so that the four places
// of a log make one log. Its top is where a seated monk rests.
export const LOG_PLACE = { length: BONFIRE_PLACE_PITCH, radius: 0.2 } as const;

// The hillside rises to the south and the west of the clearing, up to four metres at the corner, so the clearing is cut into it and
// held back by a dry-stone wall. Each stretch of wall is as high as the ground behind it (the heights of world.glb's ground there)
// and a hand more, so the wall is never lower than the hill that it holds.
const SOUTH_FROM = SLOT_B1.minX;
const SOUTH_TOPS = [4.35, 4.46, 4.36, 4.01, 3.43, 2.76, 2.13, 1.61, 1.18, 0.79] as const;
const WEST_ENDS = [49, 50.1, 51.2, 52.3, 53.4, BONFIRE_BACK_Z] as const;
const WEST_TOPS = [1.78, 2.07, 2.4, 2.77, 3.19, 3.63] as const;
const TURN_WALL_TOP = 1.6;
const WALL_DEPTH = 1.2;
const WALL_STAGGER = 0.15;

// Whole numbers in, a number from 0 to 1 out, the same on every machine: the stones are not all alike, and the model must not change
// between builds.
const noise = (index: number, salt: number): number => (((Math.imul(index + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0) % 1000) / 1000;
const round = (value: number): number => Math.round(value * 1000) / 1000;

function floors(): KitPiece[] {
  const r = BONFIRE_ROOMS;
  const earth = (area: Bounds, y: number): KitPiece => ({ shape: "floor", area, y, step: 1.2, pattern: "checker", paint: [c.earth, c.earthAlt] });
  const ash = (area: Bounds): KitPiece => ({ shape: "floor", area, y: FLOOR_Y + ASH_LIFT, step: 1, pattern: "plain", paint: c.ash });
  const { minX, maxX, minZ, maxZ } = BONFIRE_PIT;
  return [
    earth(r.lane, LANE_Y),
    earth(r.turn, LANE_Y),
    earth(r.west, FLOOR_Y),
    earth(r.north, FLOOR_Y),
    earth(r.south, FLOOR_Y),
    earth(r.east, FLOOR_Y),
    // Trodden ash round the pit, a stride wide.
    ash({ minX: minX - ASH_RING, maxX: maxX + ASH_RING, minZ: minZ - ASH_RING, maxZ: minZ }),
    ash({ minX: minX - ASH_RING, maxX: maxX + ASH_RING, minZ: maxZ, maxZ: maxZ + ASH_RING }),
    ash({ minX: minX - ASH_RING, maxX: minX, minZ, maxZ }),
    ash({ minX: maxX, maxX: maxX + ASH_RING, minZ, maxZ }),
  ];
}

// The ring of stones round the pit, sixteen, packed shoulder to shoulder inside its edge.
function ring(): KitPiece[] {
  const half = BONFIRE_PIT_HALF - 0.28;
  const perSide = 4;
  const spacing = (2 * half) / perSide;
  const stones: KitPiece[] = [];
  const stone = (x: number, z: number): void => {
    const index = stones.length;
    const radii = [0.2 + noise(index, 1) * 0.07, 0.14 + noise(index, 2) * 0.06, 0.2 + noise(index, 3) * 0.06] as const;
    stones.push({ shape: "sphere", at: [round(x), round(radii[1] * 0.8), round(z)], radii, sides: 6, paint: index % 3 === 0 ? [c.rockDark, c.rockLight] : [c.rockDark, c.rock] });
  };
  for (let i = 0; i < perSide; i += 1) {
    stone(FIRE.x - half + i * spacing, FIRE.z - half);
    stone(FIRE.x + half, FIRE.z - half + i * spacing);
    stone(FIRE.x + half - i * spacing, FIRE.z + half);
    stone(FIRE.x - half, FIRE.z + half - i * spacing);
  }
  return stones;
}

// What burns: a bed of ash, two logs lying across it and branches leant together over them.
function fuel(): KitPiece[] {
  const inner = BONFIRE_PIT_HALF - 0.15;
  const stick = (dx: number, dz: number): KitPiece => ({
    shape: "cylinder",
    from: [round(FIRE.x + dx), 0.12, round(FIRE.z + dz)],
    to: [round(FIRE.x + dx * 0.15), 1, round(FIRE.z + dz * 0.15)],
    radius: 0.08,
    radiusTo: 0.045,
    sides: 5,
    paint: c.char,
    flat: true,
  });
  return [
    box([FIRE.x - inner, BASE, FIRE.z - inner], [FIRE.x + inner, 0.1, FIRE.z + inner], c.ash, ["-y"]),
    { shape: "cylinder", from: [FIRE.x - 0.65, 0.2, FIRE.z + 0.15], to: [FIRE.x + 0.65, 0.2, FIRE.z + 0.15], radius: 0.11, sides: 6, paint: c.char },
    { shape: "cylinder", from: [FIRE.x - 0.1, 0.33, FIRE.z - 0.65], to: [FIRE.x - 0.1, 0.33, FIRE.z + 0.65], radius: 0.1, sides: 6, paint: c.char },
    stick(0.5, 0),
    stick(0.25, 0.43),
    stick(-0.25, 0.43),
    stick(-0.5, 0),
    stick(-0.25, -0.43),
    stick(0.25, -0.43),
  ];
}

// The flames and the coals under them, which give off light themselves: a tall tongue with two lower ones leaning away from it and a
// pale core.
function flames(): KitPiece[] {
  const tongue = (dx: number, dz: number, lean: number, top: number, radius: number, paint: readonly [string, string]): KitPiece => ({
    shape: "cylinder",
    from: [round(FIRE.x + dx), 0.16, round(FIRE.z + dz)],
    to: [round(FIRE.x + dx + lean), top, round(FIRE.z + dz)],
    radius,
    radiusTo: 0,
    sides: 6,
    paint,
    flat: true,
  });
  return [
    { shape: "cylinder", from: [FIRE.x, 0.1, FIRE.z], to: [FIRE.x, 0.16, FIRE.z], radius: 0.7, sides: 8, paint: c.ember, flat: true },
    tongue(0, 0, 0, 1.55, 0.5, [c.ember, c.flame]),
    tongue(0.24, -0.12, 0.1, 1.15, 0.28, [c.ember, c.flame]),
    tongue(-0.2, 0.15, -0.1, 1.25, 0.26, [c.ember, c.flame]),
    tongue(0, 0, 0, 1, 0.26, [c.flame, c.flameCore]),
  ];
}

// The dry-stone wall that holds the hill back: along the south edge of the clearing, a metre of wall to each of ten stretches, and along
// its west edge, then round the corner of the lane's turn. Alternate stretches stand a hand proud, so the wall is not one flat face.
function retainingWall(): KitPiece[] {
  const pieces: KitPiece[] = [];
  const stone = (min: readonly [number, number], max: readonly [number, number], top: number, index: number): void => {
    pieces.push(box([min[0], BASE, min[1]], [max[0], top, max[1]], [c.rockDark, index % 2 === 0 ? c.rock : c.rockLight], ["-y"]));
  };
  const front = BONFIRE_BACK_Z + 0.1;
  SOUTH_TOPS.forEach((top, index) => {
    const x = SOUTH_FROM + index;
    stone([x, front + (index % 2) * WALL_STAGGER], [x + 1, SLOT_B1.maxZ], top, index);
  });
  const edge = SLOT_B1.minX - 0.1;
  const outer = SLOT_B1.minX - WALL_DEPTH - 0.1;
  stone([outer, BONFIRE_BACK_Z], [SLOT_B1.minX, SLOT_B1.maxZ], SOUTH_TOPS[0], 1);
  let from = BONFIRE_ROOMS.turn.maxZ + 1.5;
  WEST_ENDS.forEach((end, index) => {
    stone([outer, from], [edge - (index % 2) * WALL_STAGGER, end], WEST_TOPS[index] as number, index);
    from = end;
  });
  const turn = BONFIRE_ROOMS.turn;
  stone([turn.minX - 0.3, turn.maxZ + 0.1], [edge, turn.maxZ + 1.5], TURN_WALL_TOP, 0);
  return pieces;
}

// A stone lantern on the corner of the wall by the gate, lit; it marks where the lane enters the clearing.
function lantern(): { shell: KitPiece[]; glow: KitPiece } {
  const x = BONFIRE_ROOMS.turn.maxX - 0.5;
  const z = BONFIRE_ROOMS.turn.maxZ + 0.8;
  return {
    shell: [
      box([x - 0.2, TURN_WALL_TOP, z - 0.2], [x + 0.2, TURN_WALL_TOP + 0.12, z + 0.2], c.rockLight),
      box([x - 0.09, TURN_WALL_TOP + 0.12, z - 0.09], [x + 0.09, TURN_WALL_TOP + 0.6, z + 0.09], c.rock),
      box([x - 0.27, LANTERN_TOP - 0.1, z - 0.27], [x + 0.27, LANTERN_TOP, z + 0.27], c.rockLight),
    ],
    glow: box([x - 0.16, TURN_WALL_TOP + 0.6, z - 0.16], [x + 0.16, LANTERN_TOP - 0.1, z + 0.16], c.windowGlow),
  };
}

// Boulders along the open sides, outside the clearing: the east edge, where the ground is level with it, and the north, where the
// lane's two neighbours leave the clearing open.
function boulders(): KitPiece[] {
  const spots: Array<[number, number, number]> = [
    [4, 43, 0.5],
    [4.2, 47.6, 0.45],
    [3.9, 52, 0.62],
    [3.8, 55.2, 0.5],
    [-6.3, 41, 0.5],
    [-2.8, 40.8, 0.4],
    [1.6, 41, 0.55],
  ];
  return spots.map(([x, z, size], index): KitPiece => ({
    shape: "sphere",
    at: [x, round(size * 0.5), z],
    radii: [round(size * (0.9 + noise(index, 4) * 0.25)), round(size * 0.7), round(size * (0.85 + noise(index, 5) * 0.3))],
    sides: 8,
    paint: [c.rockDark, index % 2 === 0 ? c.rock : c.rockLight],
  }));
}

// The trunk piece a visitor sits on, authored at the origin facing -z.
function trunk(): KitPiece[] {
  const half = LOG_PLACE.length / 2;
  const middle = SEAT_TOPS.bonfire - LOG_PLACE.radius;
  return [{ shape: "cylinder", from: [-half, middle, 0], to: [half, middle, 0], radius: LOG_PLACE.radius, sides: 12, paint: c.logBark }];
}

const LOOK: KitLook = {
  hemisphere: { sky: c.hemiSky, ground: c.hemiGround, intensity: 0.25 },
  lamps: [
    { at: [FIRE.x, 1.1, FIRE.z], color: c.lampFire, intensity: 14, distance: 10, flicker: 0.18 },
    { at: [FIRE.x, 2.6, FIRE.z - 1], color: c.lampFire, intensity: 6, distance: 9, flicker: 0.12 },
  ],
  // Under the open sky: the air and fog of a fire are the weather's, not the kit's.
  air: c.air,
  fog: { near: 30, far: 80 },
};

// In the open the camera has the whole clearing and the ground north of it, where the lane comes in; the hill behind the fire is its
// backdrop. It never goes south of the wall, where the hillside is.
const CAMERA: KitCamera = {
  bounds: { minX: SLOT_B1.minX - 1, maxX: SLOT_B1.maxX + 1, minY: 0.8, maxY: 10, minZ: SLOT_B1.minZ - 3.5, maxZ: BONFIRE_BACK_Z - 1.5 },
  limits: { minDistance: 2.4, maxDistance: 14, minPitch: 0.2, maxPitch: 1.3 },
  view: { yaw: Math.PI, pitch: 0.7, distance: 9 },
};

// The bonfire: a clearing cut into the hillside with a fire in a ring of stones, five logs round it and a lane in from the avenue.
export function bonfireKit(): KitSpec {
  const lamp = lantern();
  const rooms = BONFIRE_ROOMS;
  return {
    id: "bonfire",
    meshes: {
      floor: floors(),
      shell: [...ring(), ...fuel(), ...retainingWall(), ...lamp.shell, ...boulders()],
      glow: [...flames(), lamp.glow],
      seat: trunk(),
    },
    pads: [
      { minX: SLOT_B1.minX, maxX: SLOT_B1.maxX + 0.6, minZ: SLOT_B1.minZ - 0.6, maxZ: BONFIRE_BACK_Z },
      { minX: rooms.lane.minX - 0.4, maxX: rooms.lane.maxX + 0.4, minZ: AVENUE.maxZ - 1, maxZ: rooms.turn.maxZ },
    ],
    look: LOOK,
    camera: CAMERA,
  };
}
