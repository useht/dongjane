import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DHARMA_BOUNDS, DHARMA_SEATS, DHARMA_SEAT_SIZE, GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_Z, PLATFORM, PLAZA, STEPS, WORLD_BOUNDS } from "@dongjane/shared";
import { BUDGET, DHARMA_MESHES, DHARMA_PROTOTYPES, GATBAWI_MESHES, MONK_PARTS, TEXTURED, VENUE_MESHES, VENUE_PROTOTYPES, WORLD_MESHES, WORLD_PROTOTYPES, type MonkPart } from "../src/assets/contract.ts";
import { ALTAR, BUDDHA_AT, DHARMA, DHARMA_DOOR } from "../src/game/dharma-layout.ts";
import { MONK_RIG, PART_COPIES } from "../src/game/monk-rig.ts";
import { CANOPY, PADS, SCREEN, STAGE, STAGE_YAW, TEMPLE, TEMPLE_DOOR_X, lanternSpots, screenCorners, stageToWorld } from "../src/game/venue-layout.ts";
import { THEME } from "../src/theme.ts";
import { type Glb, type GlbNode, colors, loadGlb, positions, rootNodes } from "./glb.ts";

const MODELS = new URL("../src/assets/models/", import.meta.url);
const TOLERANCE = 0.03;
const COLOR_TOLERANCE = 0.004;

const textured: readonly string[] = TEXTURED;

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

describe("monk.glb", () => {
  const glb = loadGlb(new URL("monk.glb", MODELS));
  const nodes = expectContract(glb, MONK_PARTS);
  const part = (name: MonkPart): GlbNode => {
    const found = nodes.find((node) => node.name === name);
    if (!found) throw new Error(`missing ${name}`);
    return found;
  };

  it("stays inside its size budget, counting the copies the game draws", () => {
    const triangles = nodes.reduce((sum, node) => sum + node.triangles * PART_COPIES[node.name as MonkPart], 0);
    expect(triangles).toBeLessThanOrEqual(BUDGET.monk.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.monk.bytes);
  });

  it("centres every part on its own axis", () => {
    for (const node of nodes) {
      expect(Math.abs((node.positions.min[0] + node.positions.max[0]) / 2), node.name).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("puts each part's origin on its joint pivot", () => {
    const { min: skirtMin, max: skirtMax } = part("skirt").positions;
    expect(Math.abs(skirtMax[1])).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(skirtMin[1] + MONK_RIG.SKIRT_DROP)).toBeLessThanOrEqual(TOLERANCE);

    const torso = part("torso").positions;
    expect(Math.abs(torso.min[1])).toBeLessThanOrEqual(TOLERANCE);
    expect(torso.max[1]).toBeGreaterThanOrEqual(MONK_RIG.NECK_Y - TOLERANCE);

    const head = part("head").positions;
    expect(head.min[1]).toBeGreaterThanOrEqual(-2 * TOLERANCE);
    expect(head.min[1]).toBeLessThanOrEqual(TOLERANCE);
    expect(head.max[1]).toBeGreaterThan(MONK_RIG.NECK_Y);

    const upper = part("sleeveUpper").positions;
    const capRise = MONK_RIG.NECK_Y - MONK_RIG.SHOULDER_Y;
    expect(Math.abs(upper.min[1] + MONK_RIG.UPPER_ARM)).toBeLessThanOrEqual(TOLERANCE);
    expect(upper.max[1], "the shoulder cap rises to about the neck line").toBeGreaterThanOrEqual(capRise);
    expect(upper.max[1], "the shoulder cap rises to about the neck line").toBeLessThanOrEqual(capRise + 2 * TOLERANCE);

    const lower = part("sleeveLower").positions;
    expect(Math.abs(lower.max[1])).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(lower.min[1] + MONK_RIG.FORE_ARM)).toBeLessThanOrEqual(TOLERANCE);

    const hand = part("hand").positions;
    expect(Math.abs((hand.min[1] + hand.max[1]) / 2)).toBeLessThanOrEqual(TOLERANCE);

    const foot = part("foot").positions;
    expect(Math.abs(foot.min[1] + MONK_RIG.FOOT_Y)).toBeLessThanOrEqual(TOLERANCE);
    expect(foot.min[2]).toBeLessThan(-0.05);
  });

  it("faces -Z, with the face sitting in front of the neck", () => {
    const { min, max } = part("face").positions;
    expect(max[2]).toBeLessThan(0);
    expect(min[2]).toBeGreaterThan(-0.25);
  });

  it("keeps the robe near white so the per-monk tint can multiply it", () => {
    for (const name of ["skirt", "torso", "sleeveUpper", "sleeveLower"] as const) {
      const { values } = colors(glb, name);
      expect(Math.min(...values), `${name} darkest`).toBeGreaterThanOrEqual(0.6);
      expect(Math.max(...values), `${name} brightest`).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, { head: "skin", hand: "skin", face: "brow", trim: "collar", foot: "sandalCord" });
  });
});

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

describe("gatbawi.glb", () => {
  const glb = loadGlb(new URL("gatbawi.glb", MODELS));
  const nodes = expectContract(glb, GATBAWI_MESHES);
  const mesh = byName(nodes);

  it("stays inside its size budget", () => {
    expect(nodes.reduce((sum, node) => sum + node.triangles, 0)).toBeLessThanOrEqual(BUDGET.gatbawi.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.gatbawi.bytes);
  });

  it("is centred on the pedestal's foot, so the group can stand at GATBAWI_Z", () => {
    for (const node of nodes) {
      expect(Math.abs((node.positions.min[0] + node.positions.max[0]) / 2), node.name).toBeLessThanOrEqual(0.08);
    }
    expect(Math.abs(mesh("pedestal").positions.min[1])).toBeLessThanOrEqual(TOLERANCE);
  });

  it("is a four-metre figure on its pedestal, the hat stone on his head, facing +Z", () => {
    const figure = mesh("figure").positions;
    const hat = mesh("hatStone").positions;
    const pedestal = mesh("pedestal").positions;
    expect(figure.min[1]).toBeGreaterThanOrEqual(pedestal.max[1] - 0.1);
    expect(hat.min[1]).toBeGreaterThan(figure.max[1] - 0.4);
    const height = Math.max(...nodes.map((node) => node.positions.max[1]));
    expect(height).toBeGreaterThanOrEqual(3.5);
    expect(height).toBeLessThanOrEqual(4.5);
    expect(figure.max[2]).toBeGreaterThan(-figure.min[2]);
  });

  it("lays the offerings on the platform in front of the pedestal", () => {
    const offerings = mesh("offerings").positions;
    expect(offerings.min[2]).toBeGreaterThanOrEqual(mesh("pedestal").positions.max[2] - 0.1);
    expect(offerings.min[1]).toBeGreaterThanOrEqual(-TOLERANCE);
    expect(offerings.max[1]).toBeLessThan(1.2);
  });

  it("fits on the platform it stands on", () => {
    const extent = nodes.reduce(
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
    for (const name of ["figure", "hatStone", "pedestal"]) expectCeiling(glb, name, "granite");
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
    near(min[1], 0);
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
    for (const name of ["pine", "maple", "rocks"]) {
      const { values, count } = positions(glb, name);
      let inside = 0;
      for (let i = 0; i < count; i += 1) {
        const x = values[i * 3] as number;
        const y = values[i * 3 + 1] as number;
        const z = values[i * 3 + 2] as number;
        if (y > 0.3 && x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ) inside += 1;
      }
      expect(inside, `${name} vertices above the paving inside the walkable area`).toBe(0);
    }
  });

  it("stands the temple inside its footprint with the door in the wall that faces the plaza", () => {
    const temple = mesh("temple").positions;
    // The eaves reach a little past the footprint and the base is sunk a hand into the ground.
    const within = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.25);
    within(temple.min[0], TEMPLE.minX);
    within(temple.max[0], TEMPLE.maxX);
    within(temple.min[2], TEMPLE.minZ);
    within(temple.max[2], TEMPLE.maxZ);
    expect(temple.min[1]).toBeGreaterThanOrEqual(-0.15);
    expect(temple.min[1]).toBeLessThanOrEqual(0);
    expect(temple.max[1]).toBeGreaterThan(TEMPLE.baseHeight + TEMPLE.columnHeight + TEMPLE.rise - 0.5);
    expect(temple.max[0]).toBeLessThan(WORLD_BOUNDS.minX);
    const door = mesh("templeDoor").positions;
    near(door.max[0], TEMPLE_DOOR_X);
    near((door.min[2] + door.max[2]) / 2, TEMPLE.doorZ);
    expect(door.max[2] - door.min[2]).toBeGreaterThanOrEqual(TEMPLE.doorWidth);
    expect(door.max[1] - door.min[1]).toBeGreaterThanOrEqual(TEMPLE.doorHeight);
  });

  it("holds the ground level under the stage and the temple", () => {
    const { values, count } = positions(glb, "ground");
    const cos = Math.cos(STAGE_YAW);
    const sin = Math.sin(STAGE_YAW);
    let checked = 0;
    for (let i = 0; i < count; i += 1) {
      const x = values[i * 3] as number;
      const y = values[i * 3 + 1] as number;
      const z = values[i * 3 + 2] as number;
      const across = Math.abs((x - STAGE.x) * cos - (z - STAGE.z) * sin);
      const along = Math.abs((x - STAGE.x) * sin + (z - STAGE.z) * cos);
      const onStage = across <= STAGE.width / 2 + PADS.stageMargin && along <= STAGE.depth / 2 + PADS.stageMargin;
      const onTemple = x >= TEMPLE.minX - PADS.templeMargin && x <= TEMPLE.maxX + PADS.templeMargin && z >= TEMPLE.minZ - PADS.templeMargin && z <= TEMPLE.maxZ + PADS.templeMargin;
      if (!onStage && !onTemple) continue;
      checked += 1;
      expect(Math.abs(y), `ground vertex ${i} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThanOrEqual(0.01);
    }
    expect(checked).toBeGreaterThan(40);
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
    expectLinearColors(glb, nodes, { pine: "pine", maple: "maple", ground: "moss", mat: "strawBorder" });
    expectCeiling(glb, "steps", "paving");
    expectCeiling(glb, "rocks", "granite");
    expectCeiling(glb, "mat", "straw");
    expectCeiling(glb, "temple", "wallPlaster");
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
    expect(DHARMA_BOUNDS.minX).toBeGreaterThan(-DHARMA.halfWidth);
    expect(DHARMA_BOUNDS.maxX).toBeLessThan(DHARMA.halfWidth);
    expect(DHARMA_BOUNDS.minZ).toBeGreaterThan(DHARMA.backZ);
    expect(DHARMA_BOUNDS.maxZ).toBeLessThan(DHARMA.frontZ);
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
    const buddha = mesh("buddha").positions;
    near((buddha.min[0] + buddha.max[0]) / 2, BUDDHA_AT.x);
    expect(buddha.min[1]).toBeGreaterThanOrEqual(BUDDHA_AT.y - 0.1);
    expect(DHARMA_BOUNDS.minZ, "visitors stop short of the altar").toBeGreaterThan(ALTAR.maxZ);
  });

  it("keeps the seats clear of the altar and inside the room, each facing the Buddha", () => {
    for (const spot of DHARMA_SEATS) {
      expect(spot.z - DHARMA_SEAT_SIZE.z / 2, `seat ${spot.id}`).toBeGreaterThan(ALTAR.maxZ);
      expect(spot.z + DHARMA_SEAT_SIZE.z / 2, `seat ${spot.id}`).toBeLessThanOrEqual(DHARMA_BOUNDS.maxZ);
      expect(Math.abs(spot.x) + DHARMA_SEAT_SIZE.x / 2, `seat ${spot.id}`).toBeLessThanOrEqual(DHARMA_BOUNDS.maxX);
    }
  });

  it("closes the doorway in the front wall with a lattice door at least as wide and tall as the opening", () => {
    const { min, max } = mesh("door").positions;
    near(max[2], DHARMA.frontZ);
    expect(min[0]).toBeLessThanOrEqual(-DHARMA_DOOR.halfWidth);
    expect(max[0]).toBeGreaterThanOrEqual(DHARMA_DOOR.halfWidth);
    near((min[0] + max[0]) / 2, 0);
    expect(max[1]).toBeGreaterThanOrEqual(DHARMA_DOOR.height);
    expect(min[1]).toBeLessThanOrEqual(TOLERANCE);
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
    expectLinearColors(glb, nodes, { structure: "dancheongBlue", door: "pillarRed", mural: "muralInk", seat: "seatStitch" });
  });
});

describe("the model set", () => {
  // The glbs the game loads before its first frame; dharma.glb is fetched after it and has a budget of its own.
  const EAGER = ["gatbawi.glb", "monk.glb", "venue.glb", "world.glb"];
  const LAZY = ["dharma.glb"];

  it("fits the total byte budget, counted in the files' actual sizes", () => {
    const total = EAGER.reduce((sum, file) => sum + statSync(new URL(file, MODELS)).size, 0);
    expect(total).toBeLessThanOrEqual(BUDGET.totalBytes);
  });

  it("has no glb the game does not load", () => {
    expect(readdirSync(MODELS).filter((file) => file.endsWith(".glb")).sort()).toEqual([...EAGER, ...LAZY].sort());
  });
});
