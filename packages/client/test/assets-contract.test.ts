import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Bounds, COURT_AREA, DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_SEATS, DHARMA_SEAT_SIZE, GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_Z, PLATFORM, PLAZA, SEAT_YAWS, STEPS, WORLD_BOUNDS, dharmaToWorld, worldToDharma } from "@dongjane/shared";
import { BORROWS_STONE, BUDDHA, BUDDHA_EXTRAS, BUDDHA_MESHES, BUDGET, DHARMA_MESHES, DHARMA_PROTOTYPES, GATBAWI_MESHES, TEXTURED, VENUE_MESHES, VENUE_PROTOTYPES, WORLD_MESHES, WORLD_PROTOTYPES } from "../src/assets/contract.ts";
import { ALTAR, BUDDHA_AT, BUDDHA_HEIGHT, DHARMA, DHARMA_DOOR, DHARMA_SHELL, WALL_OPENINGS, WINDOW_BAND, type WindowWall } from "../src/game/dharma-layout.ts";
import { GATBAWI_STATUE } from "../src/game/landscape-layout.ts";
import { CANOPY, PADS, SCREEN, STAGE, STAGE_YAW, lanternSpots, screenCorners, stageToWorld } from "../src/game/venue-layout.ts";
import { THEME } from "../src/theme.ts";
import { type Glb, type GlbNode, colors, imageBytes, jpegSize, loadGlb, positions, rootNodes } from "./glb.ts";

const MODELS = new URL("../src/assets/models/", import.meta.url);
const TOLERANCE = 0.03;
const COLOR_TOLERANCE = 0.004;

const textured: readonly string[] = TEXTURED;
const borrowsStone: readonly string[] = BORROWS_STONE;

type MaterialToken = keyof typeof THEME.material;

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Same conversion as srgb_to_linear in blender/common.py.
function linearOf(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return [r as number, g as number, b as number];
}

function vertexCount(glb: Glb, name: string, target: readonly number[]): number {
  const { values, size, count } = colors(glb, name);
  let found = 0;
  for (let i = 0; i < count; i += 1) {
    if (target.every((channel, c) => Math.abs((values[i * size + c] as number) - channel) <= COLOR_TOLERANCE)) found += 1;
  }
  return found;
}

function expectContract(glb: Glb, names: readonly string[]): GlbNode[] {
  expect(glb.version).toBe(2);
  const nodes = rootNodes(glb);
  expect(nodes.map((node) => node.name).sort()).toEqual([...names].sort());
  for (const node of nodes) {
    expect(node.identity, `${node.name} is a root node with an identity transform`).toBe(true);
    expect(node.primitives, `${node.name} primitives`).toBe(1);
    expect(node.attributes, node.name).toEqual(expect.arrayContaining(["POSITION", "NORMAL"]));
    if (textured.includes(node.name)) {
      expect(node.attributes, node.name).toContain("TEXCOORD_0");
      expect(node.hasTexture, `${node.name} carries a texture`).toBe(true);
    } else if (borrowsStone.includes(node.name)) {
      expect(node.attributes, node.name).toEqual(expect.arrayContaining(["TEXCOORD_0", "COLOR_0"]));
      expect(node.hasTexture, `${node.name} borrows the world's rock picture and carries none`).toBe(false);
    } else {
      expect(node.attributes, node.name).toContain("COLOR_0");
      expect(node.hasTexture, `${node.name} is vertex coloured`).toBe(false);
    }
  }
  const { json } = glb;
  for (const primitive of json.meshes?.flatMap((mesh) => mesh.primitives) ?? []) {
    expect(primitive.mode ?? 4).toBe(4);
  }
  expect(json.skins ?? []).toEqual([]);
  expect(json.animations ?? []).toEqual([]);
  expect(json.cameras ?? []).toEqual([]);
  expect(json.extensionsUsed ?? []).toEqual([]);
  expect(json.extensionsRequired ?? []).toEqual([]);
  for (const node of json.nodes ?? []) {
    expect(node.extensions, `${node.name} extensions`).toBeUndefined();
    expect(node.skin).toBeUndefined();
    expect(node.camera).toBeUndefined();
  }
  for (const image of json.images ?? []) expect(image.mimeType).toBe("image/jpeg");
  return nodes;
}

function byName(nodes: readonly GlbNode[]): (name: string) => GlbNode {
  return (name) => {
    const found = nodes.find((node) => node.name === name);
    if (!found) throw new Error(`missing ${name}`);
    return found;
  };
}

// A token a mesh is built from must show up as its linear value and never as its sRGB spelling.
function expectLinearColors(glb: Glb, nodes: readonly GlbNode[], signatures: Readonly<Record<string, MaterialToken>>): void {
  for (const node of nodes) {
    const { values } = colors(glb, node.name);
    expect(Math.min(...values), `${node.name} darkest`).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values), `${node.name} brightest`).toBeLessThanOrEqual(1 + 1e-6);
  }
  for (const [name, token] of Object.entries(signatures)) {
    const hex = THEME.material[token as MaterialToken];
    const linear = linearOf(hex);
    const srgb = channels(hex).map((channel) => channel / 255);
    expect(Math.max(...linear.map((channel, c) => Math.abs(channel - (srgb[c] as number)))), `${token} tells linear from sRGB`).toBeGreaterThan(0.05);
    expect(vertexCount(glb, name, linear), `${name} carries ${token} in linear light`).toBeGreaterThan(0);
    expect(vertexCount(glb, name, srgb), `${name} never carries ${token} as sRGB`).toBe(0);
  }
}

// Stone and straw are photographs times the colours painted into the vertices, so no token appears
// exactly. What can be told is how bright a vertex gets: the token in linear light, not as sRGB.
function expectCeiling(glb: Glb, name: string, token: MaterialToken): void {
  const hex = THEME.material[token];
  const linear = linearOf(hex);
  const srgb = channels(hex).map((channel) => channel / 255);
  expect(Math.max(...linear.map((channel, c) => Math.abs(channel - (srgb[c] as number)))), `${token} tells linear from sRGB`).toBeGreaterThan(0.05);
  const { values, size, count } = colors(glb, name);
  const brightest = linear.map((_, c) => {
    let top = 0;
    for (let i = 0; i < count; i += 1) top = Math.max(top, values[i * size + c] as number);
    return top;
  });
  brightest.forEach((top, c) => {
    expect(top, `${name} channel ${c} stays under ${token} in linear light`).toBeLessThanOrEqual((linear[c] as number) + COLOR_TOLERANCE);
  });
  const reach = Math.max(...brightest.map((top, c) => top / (linear[c] as number)));
  expect(reach, `${name} gets as bright as ${token}`).toBeGreaterThan(0.75);
}

// Where each wall stands in the room's frame: x for the east and west walls, z for the front one.
const WALL_PLANES: Readonly<Record<WindowWall, number>> = { front: DHARMA.frontZ, east: DHARMA.halfWidth, west: -DHARMA.halfWidth };
// The shell's plaster stands this far outside the room's wall plus its own thickness (GAP in blender/shell.py).
const SHELL_OUT = 0.02 + DHARMA_SHELL.wall;
const SHELL_PLANES: Readonly<Record<WindowWall, number>> = {
  front: DHARMA.frontZ + SHELL_OUT,
  east: DHARMA.halfWidth + SHELL_OUT,
  west: -DHARMA.halfWidth - SHELL_OUT,
};

// World positions as the room sees them: the room's frame is the world's turned a quarter turn about DHARMA_ORIGIN.
type Where = (x: number, z: number) => { x: number; z: number };
const IN_ROOM: Where = worldToDharma;
const AS_IS: Where = (x, z) => ({ x, z });

// A box of the room's frame (door on +z) as the world holds it, for checks that read world positions.
function roomBoundsInWorld(room: Bounds): Bounds {
  const [a, b] = [dharmaToWorld(room.minX, room.minZ), dharmaToWorld(room.maxX, room.maxZ)];
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

// What the shell's base covers, in the room's frame: the walls plus a plinth, running out to the porch in front.
const FOOTPRINT: Bounds = {
  minX: -DHARMA.halfWidth - DHARMA_SHELL.plinth,
  maxX: DHARMA.halfWidth + DHARMA_SHELL.plinth,
  minZ: DHARMA.backZ - DHARMA_SHELL.plinth,
  maxZ: DHARMA_SHELL.porchZ,
};

// The extent of `name` in the room's frame, from a glb that holds it in the world's.
function roomExtent(glb: Glb, name: string, keep: (x: number, y: number, z: number) => boolean = () => true): Bounds & { minY: number; maxY: number } {
  const { values, count } = positions(glb, name);
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < count; i += 1) {
    const { x, z } = IN_ROOM(values[i * 3] as number, values[i * 3 + 2] as number);
    const y = values[i * 3 + 1] as number;
    if (!keep(x, y, z)) continue;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
    box.minZ = Math.min(box.minZ, z);
    box.maxZ = Math.max(box.maxZ, z);
  }
  return box;
}

// The vertices of `name` on one wall's plane, as [along, y]: along is x on the front wall and z on the side walls, in the room's frame.
function onWall(glb: Glb, name: string, wall: WindowWall, planes: Readonly<Record<WindowWall, number>>, where: Where): [number, number][] {
  const { values, count } = positions(glb, name);
  const found: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const { x, z } = where(values[i * 3] as number, values[i * 3 + 2] as number);
    const y = values[i * 3 + 1] as number;
    const [across, along] = wall === "front" ? [z, x] : [x, z];
    if (Math.abs(across - planes[wall]) <= 0.01) found.push([along, y]);
  }
  return found;
}

// Nothing of the wall is left inside any of its openings, and the wall stops at their edges: the window is a hole, not a picture.
function expectCut(points: readonly (readonly [number, number])[], wall: WindowWall, label: string): void {
  const shrink = 0.12;
  for (const opening of WALL_OPENINGS.filter((each) => each.wall === wall)) {
    const where = `${label} ${wall} wall at ${opening.along}`;
    const inside = points.filter(([along, y]) => Math.abs(along - opening.along) < opening.width / 2 - shrink && y > WINDOW_BAND.low + shrink && y < WINDOW_BAND.high - shrink);
    expect(inside, `${where} is open`).toEqual([]);
    const edges = points.filter(([along, y]) => Math.abs(Math.abs(along - opening.along) - opening.width / 2) <= 0.01 && y >= WINDOW_BAND.low - 0.01 && y <= WINDOW_BAND.high + 0.01);
    expect(edges.length, `${where} has edges`).toBeGreaterThan(0);
  }
}

describe("gatbawi.glb", () => {
  const glb = loadGlb(new URL("gatbawi.glb", MODELS));
  const nodes = expectContract(glb, GATBAWI_MESHES);
  const mesh = byName(nodes);

  it("stays inside its size budget", () => {
    expect(nodes.reduce((sum, node) => sum + node.triangles, 0)).toBeLessThanOrEqual(BUDGET.gatbawi.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.gatbawi.bytes);
  });

  it("stores no picture: the hat stone and the pedestal wear the rock picture world.glb holds", () => {
    expect(glb.json.images ?? []).toEqual([]);
    expect(glb.json.textures ?? []).toEqual([]);
    expect(BORROWS_STONE).toEqual(["hatStone", "pedestal"]);
  });

  it("is centred on the pedestal's foot, so the group can stand at GATBAWI_Z", () => {
    for (const node of nodes) {
      expect(Math.abs((node.positions.min[0] + node.positions.max[0]) / 2), node.name).toBeLessThanOrEqual(0.08);
    }
    expect(Math.abs(mesh("pedestal").positions.min[1])).toBeLessThanOrEqual(TOLERANCE);
  });

  it("tops the pedestal where the scanned statue sits, and draws the hat stone a metre in radius on its own underside", () => {
    expect(Math.abs(mesh("pedestal").positions.max[1] - GATBAWI_STATUE.seatY)).toBeLessThanOrEqual(TOLERANCE);
    const hat = mesh("hatStone").positions;
    expect(hat.min[1]).toBeGreaterThanOrEqual(-0.06);
    expect(hat.min[1]).toBeLessThanOrEqual(0);
    expect(hat.max[1]).toBeLessThan(0.4);
    for (const axis of [0, 2] as const) {
      expect(hat.max[axis] - hat.min[axis], "the hat stone is drawn about two metres across").toBeGreaterThan(1.7);
      expect(hat.max[axis] - hat.min[axis]).toBeLessThan(2.3);
    }
  });

  it("lays the offerings on the platform in front of the pedestal", () => {
    const offerings = mesh("offerings").positions;
    expect(offerings.min[2]).toBeGreaterThanOrEqual(mesh("pedestal").positions.max[2] - 0.1);
    expect(offerings.min[1]).toBeGreaterThanOrEqual(-TOLERANCE);
    expect(offerings.max[1]).toBeLessThan(1.2);
  });

  it("fits on the platform it stands on", () => {
    // The hat stone is drawn at the origin, to be scaled and lifted onto the statue's head: the statue's own test places it.
    const extent = nodes.filter((node) => node.name !== "hatStone").reduce(
      (all, node) => ({
        minZ: Math.min(all.minZ, node.positions.min[2]),
        maxZ: Math.max(all.maxZ, node.positions.max[2]),
        halfX: Math.max(all.halfX, node.positions.max[0], -node.positions.min[0]),
      }),
      { minZ: Infinity, maxZ: -Infinity, halfX: 0 },
    );
    expect(GATBAWI_Z + extent.maxZ).toBeLessThanOrEqual(PLATFORM.maxZ);
    expect(GATBAWI_Z + extent.minZ).toBeGreaterThanOrEqual(PLATFORM.minZ - 0.8);
    expect(extent.halfX).toBeLessThanOrEqual(3.8);
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, { offerings: "woodDark" });
    for (const name of ["hatStone", "pedestal"]) expectCeiling(glb, name, "granite");
  });
});

describe("buddha.glb", () => {
  const glb = loadGlb(new URL("buddha.glb", MODELS));
  const nodes = expectContract(glb, BUDDHA_MESHES);
  const buddha = byName(nodes)("buddha");
  const { min, max } = buddha.positions;
  const headTop = buddha.extras.headTop as number[];
  const headRadius = buddha.extras.headRadius as number;

  it("stays inside its size budget", () => {
    expect(buddha.triangles).toBeLessThanOrEqual(BUDDHA.maxTriangles);
    expect(buddha.triangles).toBeLessThanOrEqual(BUDGET.buddha.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.buddha.bytes);
  });

  it("is one metre tall, with its base on the origin and its face toward +Z", () => {
    expect(Math.abs(max[1] - min[1] - BUDDHA.height)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(min[1])).toBeLessThanOrEqual(0.005);
    expect(Math.abs((min[0] + max[0]) / 2)).toBeLessThanOrEqual(0.05);
    expect(max[2], "the knees are in front").toBeGreaterThan(-min[2]);
  });

  it("says where its head is: the crown inside its bounding box and a head radius that fits a head", () => {
    expect(Object.keys(buddha.extras).sort()).toEqual([...BUDDHA_EXTRAS].sort());
    expect(headTop).toHaveLength(3);
    headTop.forEach((value, axis) => {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual((min[axis] as number) - 1e-3);
      expect(value).toBeLessThanOrEqual((max[axis] as number) + 1e-3);
    });
    expect(headTop[1], "the crown is the top").toBeGreaterThan(0.95 * BUDDHA.height);
    expect(headRadius).toBeGreaterThan(0.04);
    expect(headRadius).toBeLessThan(0.12);
  });

  it("carries one picture of its light and shade, of the size the build bakes, and no vertex colour", () => {
    expect(buddha.attributes).not.toContain("COLOR_0");
    expect(glb.json.images ?? []).toHaveLength(1);
    expect(jpegSize(glb, 0)).toEqual({ width: BUDDHA.textureSize, height: BUDDHA.textureSize });
  });
});

describe("Gatbawi's statue, the scanned Buddha on the pedestal", () => {
  const gatbawi = loadGlb(new URL("gatbawi.glb", MODELS));
  const nodes = rootNodes(gatbawi);
  const buddha = byName(rootNodes(loadGlb(new URL("buddha.glb", MODELS))))("buddha");
  const { height, seatY, seatZ, hatHeads, hatSink } = GATBAWI_STATUE;
  const headTop = buddha.extras.headTop as number[];
  const headRadius = buddha.extras.headRadius as number;
  const hat = byName(nodes)("hatStone").positions;
  const hatRadius = hatHeads * headRadius * height;
  // Where the hat stone's underside is set, in the group's own metres (the platform's top is y = 0).
  const hatAt = { x: (headTop[0] as number) * height, y: seatY + ((headTop[1] as number) - hatSink * headRadius) * height, z: seatZ + (headTop[2] as number) * height };

  it("stands about three and a half metres tall on a pedestal whose top tier it fits on", () => {
    expect(height).toBeGreaterThanOrEqual(3.2);
    expect(height).toBeLessThanOrEqual(3.8);
    const { values, count } = positions(gatbawi, "pedestal");
    const top = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < count; i += 1) {
      if ((values[i * 3 + 1] as number) < seatY - 0.02) continue;
      top.minX = Math.min(top.minX, values[i * 3] as number);
      top.maxX = Math.max(top.maxX, values[i * 3] as number);
      top.minZ = Math.min(top.minZ, values[i * 3 + 2] as number);
      top.maxZ = Math.max(top.maxZ, values[i * 3 + 2] as number);
    }
    expect(buddha.positions.min[0] * height).toBeGreaterThanOrEqual(top.minX);
    expect(buddha.positions.max[0] * height).toBeLessThanOrEqual(top.maxX);
    expect(seatZ + buddha.positions.min[2] * height).toBeGreaterThanOrEqual(top.minZ);
    expect(seatZ + buddha.positions.max[2] * height).toBeLessThanOrEqual(top.maxZ);
  });

  it("wears the hat stone over its head, wider than the head and not far above it, on the platform", () => {
    expect(hatRadius).toBeGreaterThan(headRadius * height);
    expect(hatRadius).toBeLessThan(1.2);
    const crown = seatY + (headTop[1] as number) * height;
    expect(hatAt.y).toBeLessThan(crown);
    expect(hatAt.y).toBeGreaterThan(crown - 0.5);
    const top = hatAt.y + hat.max[1] * hatRadius;
    expect(top).toBeGreaterThan(crown);
    expect(top).toBeLessThan(crown + 0.6);
    expect(GATBAWI_Z + hatAt.z + hat.max[2] * hatRadius).toBeLessThanOrEqual(PLATFORM.maxZ);
    expect(GATBAWI_Z + hatAt.z + hat.min[2] * hatRadius).toBeGreaterThanOrEqual(PLATFORM.minZ);
  });
});

describe("world.glb", () => {
  const glb = loadGlb(new URL("world.glb", MODELS));
  const nodes = expectContract(glb, WORLD_MESHES);
  const mesh = byName(nodes);
  const near = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);

  it("stays inside its size budget, counting every mat the game draws", () => {
    const prototypes: readonly string[] = WORLD_PROTOTYPES;
    const triangles = nodes.reduce((sum, node) => sum + node.triangles * (prototypes.includes(node.name) ? GATBAWI_SEATS.length : 1), 0);
    expect(triangles).toBeLessThanOrEqual(BUDGET.world.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.world.bytes);
  });

  it("is level under the plaza and rolls on into hills far away", () => {
    const { min, max } = mesh("ground").positions;
    // The only ground below the paving is the pit the 법당 stands in.
    expect(min[1]).toBeGreaterThanOrEqual(-0.13);
    expect(min[1]).toBeLessThanOrEqual(-0.1);
    expect(max[1]).toBeGreaterThan(10);
    for (const edge of [min[0], min[2], -max[0], -max[2]]) expect(edge).toBeLessThan(-60);
  });

  it("builds the platform, the steps and the plaza paving at the heights and depths the server uses", () => {
    const { min, max } = mesh("steps").positions;
    near(max[1], PLATFORM.topY);
    near(min[1], 0);
    expect(min[2]).toBeLessThanOrEqual(PLATFORM.minZ);
    expect(max[2]).toBeGreaterThanOrEqual(PLAZA.maxZ);
    expect(min[0]).toBeLessThanOrEqual(WORLD_BOUNDS.minX);
    expect(max[0]).toBeGreaterThanOrEqual(WORLD_BOUNDS.maxX);
    expect(STEPS.minZ).toBe(PLATFORM.maxZ);
    expect(STEPS.maxZ).toBe(PLAZA.minZ);
  });

  it("keeps trees and boulders out of the area players walk in", () => {
    const footprint = roomBoundsInWorld(FOOTPRINT);
    for (const name of ["pine", "maple", "rocks"]) {
      const { values, count } = positions(glb, name);
      let inside = 0;
      for (let i = 0; i < count; i += 1) {
        const x = values[i * 3] as number;
        const y = values[i * 3 + 1] as number;
        const z = values[i * 3 + 2] as number;
        if (y <= 0.3) continue;
        for (const area of [WORLD_BOUNDS, COURT_AREA, footprint]) {
          if (x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ) inside += 1;
        }
      }
      expect(inside, `${name} vertices above the paving inside the walkable area, the court or the 법당's footprint`).toBe(0);
    }
  });

  it("stands the 법당's shell round its room, the porch running out to the court and the roof high over the walkers", () => {
    const base = roomExtent(glb, "dharmaBase");
    const walls = mesh("dharmaWalls").positions;
    const front = roomExtent(glb, "dharmaFront");
    const roof = roomExtent(glb, "dharmaRoof");
    const { halfWidth, backZ, frontZ } = DHARMA;
    // All of these are read in the room's frame: the world holds the same shell turned a quarter turn.
    near(base.minX, -halfWidth - DHARMA_SHELL.plinth);
    near(base.maxX, halfWidth + DHARMA_SHELL.plinth);
    near(base.minZ, backZ - DHARMA_SHELL.plinth);
    near(base.maxZ, worldToDharma(COURT_AREA.minX, DHARMA_ORIGIN.z).z);
    near(base.minY, -0.1);
    expect(base.maxY).toBeGreaterThanOrEqual(DHARMA_SHELL.baseHeight);
    near(walls.min[1], DHARMA_SHELL.baseHeight);
    expect(front.minZ).toBeGreaterThanOrEqual(frontZ - 0.05);
    expect(front.maxZ).toBeLessThanOrEqual(worldToDharma(COURT_AREA.minX, DHARMA_ORIGIN.z).z + 1);
    near(roof.minY, DHARMA_SHELL.beamTop);
    expect(roof.maxY).toBeGreaterThan(DHARMA_SHELL.beamTop + DHARMA_SHELL.rise);
    expect(roof.minX).toBeLessThanOrEqual(-halfWidth - DHARMA_SHELL.eave);
    expect(roof.maxX).toBeGreaterThanOrEqual(halfWidth + DHARMA_SHELL.eave);
    expect(roof.minZ).toBeLessThanOrEqual(backZ - DHARMA_SHELL.eave);
    expect(roof.maxZ).toBeGreaterThanOrEqual(frontZ + DHARMA_SHELL.eave);
    for (const name of ["dharmaBase", "dharmaWalls", "dharmaFront"]) expect(mesh(name).positions.max[0], `${name} stays off the plaza`).toBeLessThan(WORLD_BOUNDS.minX);
  });

  it("turns the 법당 so its front wall, porch and doorway face +x toward the plaza and Gatbawi, and its back faces -x", () => {
    const front = mesh("dharmaFront").positions;
    const base = mesh("dharmaBase").positions;
    expect(front.min[0], "the front wall stands on the +x side of the room's middle").toBeGreaterThanOrEqual(DHARMA_ORIGIN.x + DHARMA.frontZ - 0.05);
    near(base.max[0], COURT_AREA.minX);
    expect(base.min[0], "the back is the westernmost part").toBeLessThan(DHARMA_ORIGIN.x + DHARMA.backZ);
    near((base.min[2] + base.max[2]) / 2, DHARMA_ORIGIN.z);
  });

  it("hangs the signboard over the middle of the doorway: centred on the door, above the lintel, proud of the front wall's outer face", () => {
    const outer = SHELL_PLANES.front;
    // Between the lintel and the top of the plaster, and nothing but the board stands out of the wall there.
    const plaque = roomExtent(glb, "dharmaFront", (x, y, z) => Math.abs(x) < 1.5 && y > DHARMA_DOOR.height + 0.4 && y < DHARMA.wallHeight && z > outer + 0.05);
    expect(Number.isFinite(plaque.minX), "the signboard is there").toBe(true);
    near((plaque.minX + plaque.maxX) / 2, 0);
    expect(plaque.maxX - plaque.minX, "wider than a window, narrower than the doorway").toBeGreaterThan(2);
    expect(plaque.maxX - plaque.minX).toBeLessThan(2 * DHARMA_DOOR.halfWidth);
    expect(plaque.minY, "above the doorway").toBeGreaterThan(DHARMA_DOOR.height);
    expect(plaque.maxY, "under the top of the wall").toBeLessThan(DHARMA.wallHeight - 0.2);
    expect(plaque.minZ, "proud of the plaster").toBeGreaterThan(outer);
  });

  it("leaves the doorway open: nothing of the shell stands in it, with a jamb on either side", () => {
    const edge = DHARMA_DOOR.halfWidth;
    const frontFace = DHARMA.frontZ - 0.05;
    for (const name of ["dharmaWalls", "dharmaFront"]) {
      const { values, count } = positions(glb, name);
      let left = 0;
      let right = 0;
      for (let i = 0; i < count; i += 1) {
        const { x: across, z } = IN_ROOM(values[i * 3] as number, values[i * 3 + 2] as number);
        const y = values[i * 3 + 1] as number;
        if (z < frontFace || z > DHARMA_SHELL.porchZ) continue;
        if (Math.abs(across) < edge - 0.02 && y > DHARMA_SHELL.baseHeight + 0.05 && y < DHARMA_DOOR.height - 0.02) {
          throw new Error(`${name} vertex ${i} stands in the doorway at ${across.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
        }
        if (Math.abs(across + edge) <= 0.02) left += 1;
        if (Math.abs(across - edge) <= 0.02) right += 1;
      }
      if (name === "dharmaFront") {
        expect(left, "left jamb").toBeGreaterThan(0);
        expect(right, "right jamb").toBeGreaterThan(0);
      }
    }
  });

  it("cuts each window through the plaster, in the front wall and the two side walls", () => {
    const parts: Readonly<Record<WindowWall, string>> = { front: "dharmaFront", east: "dharmaWalls", west: "dharmaWalls" };
    for (const wall of ["front", "east", "west"] as const) {
      expectCut(onWall(glb, parts[wall], wall, SHELL_PLANES, IN_ROOM), wall, "shell");
    }
  });

  it("holds the ground level under the stage and round the 법당, sunk a hand below its floor and level across the court", () => {
    const { values, count } = positions(glb, "ground");
    const cos = Math.cos(STAGE_YAW);
    const sin = Math.sin(STAGE_YAW);
    const { halfWidth, backZ, frontZ } = DHARMA;
    const footprint = roomBoundsInWorld(FOOTPRINT);
    let onStageChecked = 0;
    let underRoom = 0;
    let underCourt = 0;
    for (let i = 0; i < count; i += 1) {
      const x = values[i * 3] as number;
      const y = values[i * 3 + 1] as number;
      const z = values[i * 3 + 2] as number;
      const where = `ground vertex ${i} at ${x.toFixed(1)}, ${z.toFixed(1)}`;
      const across = Math.abs((x - STAGE.x) * cos - (z - STAGE.z) * sin);
      const along = Math.abs((x - STAGE.x) * sin + (z - STAGE.z) * cos);
      if (across <= STAGE.width / 2 + PADS.stageMargin && along <= STAGE.depth / 2 + PADS.stageMargin) {
        onStageChecked += 1;
        expect(Math.abs(y), where).toBeLessThanOrEqual(0.01);
      }
      const nearTemple = x >= footprint.minX - PADS.dharmaMargin && x <= footprint.maxX + PADS.dharmaMargin && z >= footprint.minZ - PADS.dharmaMargin && z <= footprint.maxZ + PADS.dharmaMargin;
      if (nearTemple) {
        expect(y, `${where} never rises through the plinth`).toBeLessThanOrEqual(0.01);
        expect(y, `${where} is sunk no deeper than a hand`).toBeGreaterThanOrEqual(-0.13);
        const outsidePlinth = x < footprint.minX - 0.01 || x > footprint.maxX + 0.01 || z < footprint.minZ - 0.01 || z > footprint.maxZ + 0.01;
        if (outsidePlinth) expect(Math.abs(y), `${where} is level beyond the plinth`).toBeLessThanOrEqual(0.01);
      }
      const inside = IN_ROOM(x, z);
      const underFloor = Math.abs(inside.x) <= halfWidth - 0.1 && inside.z >= backZ + 0.1 && inside.z <= frontZ - 0.1;
      if (underFloor) {
        underRoom += 1;
        expect(y, `${where} lies under the floor`).toBeLessThanOrEqual(-0.1);
      }
      if (x >= COURT_AREA.minX && x <= COURT_AREA.maxX && z >= COURT_AREA.minZ && z <= COURT_AREA.maxZ) {
        underCourt += 1;
        expect(Math.abs(y), `${where} in the court`).toBeLessThanOrEqual(0.01);
      }
    }
    expect(onStageChecked).toBeGreaterThan(40);
    expect(underRoom).toBeGreaterThan(40);
    expect(underCourt).toBeGreaterThan(40);
  });

  it("authors one mat prototype at the origin, the size the mats are laid out for", () => {
    for (const name of WORLD_PROTOTYPES) {
      const { min, max } = mesh(name).positions;
      near((min[0] + max[0]) / 2, 0);
      near((min[2] + max[2]) / 2, 0);
      near(max[0] - min[0], GATBAWI_SEAT_SIZE.x);
      near(max[2] - min[2], GATBAWI_SEAT_SIZE.z);
      expect(min[1], name).toBeGreaterThanOrEqual(-0.01);
      expect(max[1], name).toBeLessThanOrEqual(0.05);
    }
  });

  it("leaves every mat on the plaza paving, clear of the steps and of each other", () => {
    expect(GATBAWI_SEATS).toHaveLength(50);
    for (const a of GATBAWI_SEATS) {
      expect(a.z - GATBAWI_SEAT_SIZE.z / 2, `mat ${a.id} front`).toBeGreaterThanOrEqual(PLAZA.minZ);
      expect(a.z + GATBAWI_SEAT_SIZE.z / 2, `mat ${a.id} back`).toBeLessThanOrEqual(PLAZA.maxZ);
      expect(a.x - GATBAWI_SEAT_SIZE.x / 2, `mat ${a.id} left`).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX);
      expect(a.x + GATBAWI_SEAT_SIZE.x / 2, `mat ${a.id} right`).toBeLessThanOrEqual(WORLD_BOUNDS.maxX);
      for (const b of GATBAWI_SEATS.filter((other) => other.id > a.id)) {
        const apart = Math.abs(a.x - b.x) >= GATBAWI_SEAT_SIZE.x || Math.abs(a.z - b.z) >= GATBAWI_SEAT_SIZE.z;
        expect(apart, `mats ${a.id} and ${b.id} do not overlap`).toBe(true);
      }
    }
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, { pine: "pine", maple: "maple", ground: "moss", mat: "strawBorder", dharmaWalls: "wallPlaster", dharmaFront: "wallPlaster", dharmaRoof: "tileGray" });
    expectCeiling(glb, "steps", "paving");
    expectCeiling(glb, "rocks", "granite");
    expectCeiling(glb, "mat", "straw");
    expectCeiling(glb, "dharmaBase", "granite");
  });
});

describe("venue.glb", () => {
  const glb = loadGlb(new URL("venue.glb", MODELS));
  const nodes = expectContract(glb, VENUE_MESHES);
  const mesh = byName(nodes);
  const near = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);

  it("stays inside its size budget, counting every lantern the game hangs", () => {
    const prototypes: readonly string[] = VENUE_PROTOTYPES;
    const triangles = nodes.reduce((sum, node) => sum + node.triangles * (prototypes.includes(node.name) ? lanternSpots().length : 1), 0);
    expect(triangles).toBeLessThanOrEqual(BUDGET.venue.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.venue.bytes);
  });

  it("puts the deck where the layout says, turned toward the mats and clear of the walkable area", () => {
    const { min, max } = mesh("stage").positions;
    expect(min[1]).toBeGreaterThanOrEqual(-0.01);
    near(max[1], STAGE.height + 1.9);
    for (const u of [-1, 1]) {
      for (const v of [-1, 1]) {
        const corner = stageToWorld((u * STAGE.width) / 2, (v * STAGE.depth) / 2);
        expect(corner.x).toBeGreaterThanOrEqual(min[0] - 0.05);
        expect(corner.x).toBeLessThanOrEqual(max[0] + 0.05);
        expect(corner.z).toBeGreaterThanOrEqual(min[2] - 0.05);
        expect(corner.z).toBeLessThanOrEqual(max[2] + 0.05);
      }
    }
    expect(max[2]).toBeLessThan(WORLD_BOUNDS.minZ);
  });

  it("draws the screen as one quad on the corners the game projects the video onto", () => {
    const { values, count } = positions(glb, "screen");
    expect(count).toBe(4);
    const wanted = screenCorners();
    for (const corner of wanted) {
      const gaps = Array.from({ length: count }, (_, i) => Math.hypot((values[i * 3] as number) - corner.x, (values[i * 3 + 1] as number) - corner.y, (values[i * 3 + 2] as number) - corner.z));
      expect(Math.min(...gaps)).toBeLessThanOrEqual(TOLERANCE);
    }
    near(Math.hypot(wanted[1].x - wanted[0].x, wanted[1].z - wanted[0].z), SCREEN.width);
    near(wanted[3].y - wanted[0].y, SCREEN.height);
  });

  it("raises one pole at every place the layout names, as tall as the canopy", () => {
    const { values, count } = positions(glb, "poles");
    for (const [x, z] of CANOPY.poles) {
      let found = false;
      for (let i = 0; i < count && !found; i += 1) {
        found = Math.abs((values[i * 3] as number) - x) <= 0.12 && Math.abs((values[i * 3 + 2] as number) - z) <= 0.12 && (values[i * 3 + 1] as number) >= CANOPY.height - 0.1;
      }
      expect(found, `a pole top at ${x}, ${z}`).toBe(true);
    }
  });

  it("authors one lantern with its hook at the origin, hanging below it", () => {
    for (const name of VENUE_PROTOTYPES) {
      const { min, max } = mesh(name).positions;
      near((min[0] + max[0]) / 2, 0);
      near((min[2] + max[2]) / 2, 0);
      expect(max[1], name).toBeLessThanOrEqual(0.01);
      expect(min[1], name).toBeGreaterThanOrEqual(-0.5);
      expect(max[0] - min[0], name).toBeLessThanOrEqual(0.5);
    }
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, { stage: "woodMid", truss: "steelDark", poles: "sash", screen: "screenBezel", lantern: "paper" });
  });
});

describe("dharma.glb", () => {
  const glb = loadGlb(new URL("dharma.glb", MODELS));
  const nodes = expectContract(glb, DHARMA_MESHES);
  const mesh = byName(nodes);
  const near = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
  // The glb is authored around the middle of the floor in the room's own frame; the game puts that middle at DHARMA_ORIGIN
  // and turns the frame a quarter turn, so the walkable floor is read back into the room's frame.
  const corners = [worldToDharma(DHARMA_BOUNDS.minX, DHARMA_BOUNDS.minZ), worldToDharma(DHARMA_BOUNDS.maxX, DHARMA_BOUNDS.maxZ)];
  const room = { minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)), minZ: Math.min(...corners.map((c) => c.z)), maxZ: Math.max(...corners.map((c) => c.z)) };

  it("stays inside its size budget, counting every seat the game lays out", () => {
    const prototypes: readonly string[] = DHARMA_PROTOTYPES;
    const triangles = nodes.reduce((sum, node) => sum + node.triangles * (prototypes.includes(node.name) ? DHARMA_SEATS.length : 1), 0);
    expect(triangles).toBeLessThanOrEqual(BUDGET.dharma.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.dharma.bytes);
  });

  it("builds the room the layout describes, with the walkable floor inside its walls", () => {
    const floor = mesh("floor").positions;
    near(floor.min[0], -DHARMA.halfWidth);
    near(floor.max[0], DHARMA.halfWidth);
    near(floor.min[2], DHARMA.backZ);
    near(floor.max[2], DHARMA.frontZ);
    expect(room.minX).toBeGreaterThan(-DHARMA.halfWidth);
    expect(room.maxX).toBeLessThan(DHARMA.halfWidth);
    expect(room.minZ).toBeGreaterThan(DHARMA.backZ);
    expect(room.maxZ).toBeLessThan(DHARMA.frontZ);
    near(mesh("ceiling").positions.max[1], DHARMA.ceilingHeight);
    near(mesh("structure").positions.max[1], DHARMA.ceilingHeight);
    expect(mesh("ceiling").positions.min[1], "the ceiling starts above the walls' foot").toBeGreaterThan(DHARMA.wallHeight - 1);
  });

  it("seats the Buddha on the altar, its lotus resting on the altar's top and inside its footprint", () => {
    const lotus = mesh("lotus").positions;
    near(lotus.min[1], ALTAR.topY);
    expect(lotus.min[0]).toBeGreaterThanOrEqual(-ALTAR.halfWidth);
    expect(lotus.max[0]).toBeLessThanOrEqual(ALTAR.halfWidth);
    expect(lotus.min[2]).toBeGreaterThanOrEqual(ALTAR.minZ - 0.05);
    expect(lotus.max[2]).toBeLessThanOrEqual(ALTAR.maxZ + 0.05);
    near((lotus.min[0] + lotus.max[0]) / 2, BUDDHA_AT.x);
    near((lotus.min[2] + lotus.max[2]) / 2, BUDDHA_AT.z);
    expect(BUDDHA_AT.y, "his base stands on the lotus, above the altar").toBeGreaterThan(ALTAR.topY);
    expect(BUDDHA_AT.y).toBeLessThan(lotus.max[1]);
    expect(room.minZ, "visitors stop short of the altar").toBeGreaterThan(ALTAR.maxZ);
  });

  it("fits the scanned Buddha on its lotus and under the ceiling, the halo and glow behind his head", () => {
    const scan = byName(rootNodes(loadGlb(new URL("buddha.glb", MODELS))))("buddha");
    const lotus = mesh("lotus").positions;
    const headTop = scan.extras.headTop as number[];
    const headRadius = scan.extras.headRadius as number;
    const width = Math.max(scan.positions.max[0], -scan.positions.min[0]) * BUDDHA_HEIGHT;
    expect(BUDDHA_AT.x - width).toBeGreaterThanOrEqual(lotus.min[0]);
    expect(BUDDHA_AT.x + width).toBeLessThanOrEqual(lotus.max[0]);
    expect(BUDDHA_AT.y + BUDDHA_HEIGHT).toBeLessThan(DHARMA.ceilingHeight - 1);
    const headY = BUDDHA_AT.y + ((headTop[1] as number) - headRadius) * BUDDHA_HEIGHT;
    const behind = BUDDHA_AT.z + scan.positions.min[2] * BUDDHA_HEIGHT;
    for (const name of ["halo", "glow"]) {
      const { min, max } = mesh(name).positions;
      expect(max[2], `${name} stands behind the Buddha's back`).toBeLessThan(behind);
      expect(min[1], `${name} reaches below his head`).toBeLessThan(headY);
      expect(max[1], `${name} reaches above his head`).toBeGreaterThan(headY + headRadius * BUDDHA_HEIGHT);
      near((min[0] + max[0]) / 2, BUDDHA_AT.x + (headTop[0] as number) * BUDDHA_HEIGHT);
    }
  });

  it("keeps the seats clear of the altar and inside the room, each facing the Buddha", () => {
    const buddha = dharmaToWorld(BUDDHA_AT.x, BUDDHA_AT.z);
    // The way a monk on a seat looks (yaw 0 looks toward -z), and the way the room's back wall lies from its middle, both in the world's frame.
    const facing = { x: -Math.sin(SEAT_YAWS.dharma), z: -Math.cos(SEAT_YAWS.dharma) };
    const towardAltar = dharmaToWorld(0, -1);
    expect(facing.x).toBeCloseTo(towardAltar.x - DHARMA_ORIGIN.x, 6);
    expect(facing.z).toBeCloseTo(towardAltar.z - DHARMA_ORIGIN.z, 6);
    for (const spot of DHARMA_SEATS) {
      const { x, z } = worldToDharma(spot.x, spot.z);
      expect(z - DHARMA_SEAT_SIZE.z / 2, `seat ${spot.id}`).toBeGreaterThan(ALTAR.maxZ);
      expect(z + DHARMA_SEAT_SIZE.z / 2, `seat ${spot.id}`).toBeLessThanOrEqual(room.maxZ);
      expect(Math.abs(x) + DHARMA_SEAT_SIZE.x / 2, `seat ${spot.id}`).toBeLessThanOrEqual(room.maxX);
      const ahead = (buddha.x - spot.x) * facing.x + (buddha.z - spot.z) * facing.z;
      expect(ahead, `the Buddha is in front of seat ${spot.id}`).toBeGreaterThan(1);
    }
  });

  it("has no door in the front wall: the doorway is open and nothing of the room stands in it", () => {
    const edge = DHARMA_DOOR.halfWidth;
    for (const name of ["structure", "ceiling"]) {
      const { values, count } = positions(glb, name);
      for (let i = 0; i < count; i += 1) {
        const x = values[i * 3] as number;
        const y = values[i * 3 + 1] as number;
        const z = values[i * 3 + 2] as number;
        const inDoorway = Math.abs(x) < edge - 0.02 && y > 0.05 && y < DHARMA_DOOR.height - 0.02 && z > DHARMA.frontZ - 0.1;
        expect(inDoorway, `${name} vertex ${i} at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
      }
    }
  });

  it("cuts each window through the room's wall at the same place as the shell's, in the front wall and the two side walls", () => {
    for (const wall of ["front", "east", "west"] as const) {
      expectCut(onWall(glb, "structure", wall, WALL_PLANES, AS_IS), wall, "room");
    }
  });

  it("authors one seat at the origin, as wide as the layout makes room for", () => {
    const { min, max } = mesh("seat").positions;
    near((min[0] + max[0]) / 2, 0);
    near((min[2] + max[2]) / 2, 0);
    near(max[0] - min[0], DHARMA_SEAT_SIZE.x);
    near(max[2] - min[2], DHARMA_SEAT_SIZE.z);
    expect(min[1]).toBeGreaterThanOrEqual(-0.01);
    expect(max[1]).toBeLessThanOrEqual(0.25);
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, { structure: "dancheongBlue", mural: "muralInk", seat: "seatStitch" });
  });
});

describe("the model set", () => {
  // The glbs the game loads before its first frame; dharma.glb is fetched after it and has a budget of its own.
  const EAGER = ["buddha.glb", "gatbawi.glb", "venue.glb", "world.glb"];
  const LAZY = ["dharma.glb"];
  // main.ts loads the Korean monk beside the models above, before the first frame: it counts too, though main's own script builds it.
  const MONK = new URL("../assets/monk/monk.glb", import.meta.url);

  it("fits the total byte budget, counted in the files' actual sizes and with the monk", () => {
    const total = EAGER.reduce((sum, file) => sum + statSync(new URL(file, MODELS)).size, statSync(MONK).size);
    expect(total).toBeLessThanOrEqual(BUDGET.totalBytes);
  });

  it("keeps the monk inside his own byte budget", () => {
    expect(statSync(MONK).size).toBeLessThanOrEqual(BUDGET.monk.bytes);
  });

  it("stores no picture twice among the files the first frame loads", () => {
    const seen = new Map<string, string>();
    for (const file of EAGER) {
      for (const [index, bytes] of imageBytes(loadGlb(new URL(file, MODELS))).entries()) {
        const hash = createHash("sha256").update(bytes).digest("hex");
        expect(seen.get(hash), `${file} image ${index} is already in ${seen.get(hash)}`).toBeUndefined();
        seen.set(hash, file);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("has no glb the game does not load", () => {
    expect(readdirSync(MODELS).filter((file) => file.endsWith(".glb")).sort()).toEqual([...EAGER, ...LAZY].sort());
  });
});
