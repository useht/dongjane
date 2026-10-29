import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUSHION_SPOTS, HALL_FRONT_Z, HALL_HALF_WIDTH } from "@dongjane/shared";
import { BUDDHA_MESHES, BUDGET, HALL_MESHES, HALL_PROTOTYPES, MONK_PARTS, TEXTURED, type MonkPart } from "../src/assets/contract.ts";
import { HALL_LAYOUT } from "../src/game/hall-layout.ts";
import { MONK_RIG, PART_COPIES } from "../src/game/monk-rig.ts";
import { THEME } from "../src/theme.ts";
import { type Glb, type GlbNode, colors, loadGlb, rootNodes } from "./glb.ts";

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
    expect(MONK_RIG.HIP_STAND + MONK_RIG.NECK_Y + head.max[1], "a standing head stays under its nameplate").toBeLessThan(MONK_RIG.NAME_HEIGHT);

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
  for (const node of nodes.filter((candidate) => !textured.includes(candidate.name))) {
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

describe("buddha.glb", () => {
  const glb = loadGlb(new URL("buddha.glb", MODELS));
  const nodes = expectContract(glb, BUDDHA_MESHES);
  const mesh = byName(nodes);

  it("stays inside its size budget", () => {
    expect(nodes.reduce((sum, node) => sum + node.triangles, 0)).toBeLessThanOrEqual(BUDGET.buddha.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.buddha.bytes);
  });

  it("is centred on the altar line, so the group can be placed at BUDDHA_Z", () => {
    for (const node of nodes) {
      expect(Math.abs((node.positions.min[0] + node.positions.max[0]) / 2), node.name).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("sits on its lotus, facing +Z into the hall", () => {
    const figure = mesh("figure").positions;
    const lotus = mesh("lotus").positions;
    expect(Math.abs(lotus.max[1])).toBeLessThanOrEqual(0.3);
    expect(lotus.min[1]).toBeLessThan(0);
    expect(figure.min[1]).toBeGreaterThanOrEqual(lotus.min[1]);
    expect(figure.max[1] - figure.min[1]).toBeGreaterThan(2.5);
    expect(figure.max[2]).toBeGreaterThan(-figure.min[2]);
  });

  it("puts the halo and the glow behind the figure", () => {
    expect(mesh("halo").positions.max[2]).toBeLessThan(0);
    expect(mesh("glow").positions.max[2]).toBeLessThan(0);
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, { figure: "buddhaGold", halo: "buddhaGoldPale", lotus: "petal" });
  });
});

describe("hall.glb", () => {
  const glb = loadGlb(new URL("hall.glb", MODELS));
  const nodes = expectContract(glb, HALL_MESHES);
  const mesh = byName(nodes);
  const { BACK_Z, HEIGHT } = HALL_LAYOUT;
  const near = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);

  it("stays inside its size budget, counting every cushion the game draws", () => {
    const prototypes: readonly string[] = HALL_PROTOTYPES;
    const triangles = nodes.reduce((sum, node) => sum + node.triangles * (prototypes.includes(node.name) ? CUSHION_SPOTS.length : 1), 0);
    expect(triangles).toBeLessThanOrEqual(BUDGET.hall.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.hall.bytes);
  });

  it("lays the floor over exactly the room the server lets players walk in", () => {
    const { min, max } = mesh("floor").positions;
    near(min[0], -HALL_HALF_WIDTH);
    near(max[0], HALL_HALF_WIDTH);
    near(min[2], BACK_Z);
    near(max[2], HALL_FRONT_Z);
    near(min[1], 0);
    near(max[1], 0);
  });

  it("hangs the mural across the whole back wall", () => {
    const { min, max } = mesh("backdrop").positions;
    near(min[0], -HALL_HALF_WIDTH);
    near(max[0], HALL_HALF_WIDTH);
    near(min[1], 0);
    near(max[1], HEIGHT);
    near(min[2], BACK_Z);
  });

  it("keeps everything indoors under the roof", () => {
    for (const name of ["structure", "beams", "paper", "lanterns"]) {
      expect(mesh(name).positions.max[1], name).toBeLessThanOrEqual(HEIGHT + 0.05);
      expect(mesh(name).positions.min[1], name).toBeGreaterThanOrEqual(-0.05);
    }
  });

  it("authors the cushion prototypes at the origin, ready to be instanced", () => {
    for (const name of HALL_PROTOTYPES) {
      const { min, max } = mesh(name).positions;
      expect(Math.abs((min[0] + max[0]) / 2), name).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs((min[2] + max[2]) / 2), name).toBeLessThanOrEqual(TOLERANCE);
      expect(min[1], name).toBeGreaterThanOrEqual(-0.01);
      expect(max[1], name).toBeLessThan(0.3);
    }
  });

  it("paints vertices in linear light, never as sRGB", () => {
    expectLinearColors(glb, nodes, {
      structure: "lacquer",
      beams: "dancheongGreen",
      lanterns: "lanternCoral",
      paper: "paper",
      cushionBody: "cushion",
      outdoor: "pine",
    });
  });
});

describe("the model set", () => {
  it("fits the total byte budget", () => {
    const total = readdirSync(MODELS)
      .filter((file) => file.endsWith(".glb"))
      .reduce((sum, file) => sum + statSync(new URL(file, MODELS)).size, 0);
    expect(total).toBeLessThanOrEqual(BUDGET.totalBytes);
  });
});
