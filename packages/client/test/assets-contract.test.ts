import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUDGET, MONK_PARTS, TEXTURED, type MonkPart } from "../src/assets/contract.ts";
import { MONK_RIG, PART_COPIES } from "../src/game/monk-rig.ts";
import { type Glb, type GlbNode, colors, loadGlb, rootNodes } from "./glb.ts";

const MODELS = new URL("../src/assets/models/", import.meta.url);
const TOLERANCE = 0.03;

const textured: readonly string[] = TEXTURED;

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
    expect(head.min[1]).toBeGreaterThanOrEqual(-0.05);
    expect(head.min[1]).toBeLessThanOrEqual(TOLERANCE);
    expect(head.max[1]).toBeGreaterThan(0.38);

    const upper = part("sleeveUpper").positions;
    expect(Math.abs(upper.min[1] + MONK_RIG.UPPER_ARM)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(upper.max[1] - 0.09)).toBeLessThanOrEqual(TOLERANCE);

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
});

describe("the model set", () => {
  it("fits the total byte budget", () => {
    const total = readdirSync(MODELS)
      .filter((file) => file.endsWith(".glb"))
      .reduce((sum, file) => sum + statSync(new URL(file, MODELS)).size, 0);
    expect(total).toBeLessThanOrEqual(BUDGET.totalBytes);
  });
});
