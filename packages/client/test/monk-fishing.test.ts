import { readFileSync } from "node:fs";
import { type BufferGeometry, Group, type InstancedMesh, Matrix4, type Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { ITEM_NONE, ITEM_ROD, SEA_LINE_X, yawFromDirection } from "@dongjane/shared";
import { type MonkAssets, extractMonkParts, monkRig } from "../src/game/monk-assets.ts";
import { ROD, ROD_POSE, buildItemGeometries } from "../src/game/monk-items.ts";
import { ITEM_PART_NAMES, MonkAvatar, MonkPool, type PartName } from "../src/game/monk-model.ts";
import { PoseBlend } from "../src/game/pose.ts";

const FACING_SEA = yawFromDirection(1, 0);
const AT_ORIGIN = { x: 0, z: 0, yaw: 0 };

function nodeOf(avatar: MonkAvatar, part: PartName, copy = 0): Object3D {
  const binding = avatar.bindings.find((b) => b.part === part && b.copy === copy);
  if (!binding) throw new Error(`no ${part} binding ${copy}`);
  return binding.node;
}

function positionOf(node: Object3D): Vector3 {
  return new Vector3().setFromMatrixPosition(node.matrixWorld);
}

function rodTipOf(avatar: MonkAvatar): Vector3 {
  return ROD.tip.clone().applyMatrix4(nodeOf(avatar, "hand", 0).matrixWorld);
}

function worldVertices(node: Object3D, geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position as never, i).applyMatrix4(node.matrixWorld));
}

interface Angler {
  bite?: boolean;
  x?: number;
  z?: number;
  yaw?: number;
  since?: number;
}

function newAngler(options: Angler = {}): MonkAvatar {
  const avatar = new MonkAvatar("angler", 0, false);
  avatar.item = ITEM_ROD;
  avatar.bite = options.bite ?? false;
  avatar.setMode("fish", options.since ?? 0);
  avatar.place(options.x ?? 17.6, options.z ?? 3, options.yaw ?? FACING_SEA);
  return avatar;
}

// A monk who has been fishing for a while, with reduced motion so the pose is exact and steady.
function steadyAngler(options: Angler = {}): MonkAvatar {
  const avatar = newAngler(options);
  avatar.animate(0.016, 5000, 0, true);
  return avatar;
}

async function loadAssets(): Promise<MonkAssets> {
  const file = readFileSync(new URL("../assets/monk/monk.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, "");
  return { parts: { ...extractMonkParts(gltf.scene), ...buildItemGeometries() }, rig: monkRig };
}

describe("the fishing pose", () => {
  it("blends in while the monk fishes and out again when the line comes in", () => {
    const pose = new PoseBlend();
    pose.update("fish", 0.05, true);
    expect(pose.fish).toBeGreaterThan(0);
    expect(pose.fish).toBeLessThan(1);
    for (let i = 0; i < 60; i += 1) pose.update("fish", 0.05, true);
    expect(pose.fish).toBeGreaterThan(0.99);
    pose.update("stand", 0.05, false);
    expect(pose.fish).toBe(0);
    pose.update("fish", 0.05, false);
    expect(pose.fish).toBe(1);
  });

  it("holds the rod in front of the chest: both hands forward, between the hip and the shoulder, near the middle", () => {
    const avatar = steadyAngler(AT_ORIGIN);
    const shoulderY = monkRig.hipStand + monkRig.shoulderY;
    for (const side of [0, 1]) {
      const hand = positionOf(nodeOf(avatar, "hand", side));
      expect(hand.z, `hand ${side} reaches forward`).toBeLessThan(-0.15);
      expect(hand.y, `hand ${side} stays below the shoulder`).toBeLessThan(shoulderY);
      expect(hand.y, `hand ${side} stays above the hip`).toBeGreaterThan(monkRig.hipStand);
      expect(Math.abs(hand.x), `hand ${side} is near the middle of the chest`).toBeLessThan(0.06);
    }
  });

  it("leans the monk back a little against the pull of the rod", () => {
    const standing = new MonkAvatar("standing", 0, false);
    standing.animate(0.016, 1000, 0, true);
    expect(positionOf(nodeOf(steadyAngler(AT_ORIGIN), "head")).z).toBeGreaterThan(positionOf(nodeOf(standing, "head")).z);
  });

  it("jerks the rod while a fish bites, and with reduced motion holds it in a steady lean instead", () => {
    const spread = (bite: boolean): number => {
      const avatar = newAngler({ ...AT_ORIGIN, bite });
      const heights: number[] = [];
      for (let step = 0; step < 240; step += 1) {
        avatar.animate(0.016, 5000 + step * 16, 0, false);
        if (step >= 120) heights.push(rodTipOf(avatar).y);
      }
      return Math.max(...heights) - Math.min(...heights);
    };
    expect(spread(true)).toBeGreaterThan(spread(false) * 3);
    expect(spread(true)).toBeGreaterThan(0.05);

    const calm = rodTipOf(steadyAngler({ ...AT_ORIGIN, bite: false }));
    const leaning = steadyAngler({ ...AT_ORIGIN, bite: true });
    const first = rodTipOf(leaning);
    leaning.animate(0.37, 6000, 0, true);
    expect(rodTipOf(leaning).distanceTo(first), "no jerking").toBeLessThan(1e-9);
    expect(first.distanceTo(calm), "but the rod does lean").toBeGreaterThan(0.01);
  });
});

describe("the rod", () => {
  it("is one of the parts the rig binds, and every item part has geometry", () => {
    expect(ITEM_PART_NAMES).toEqual(expect.arrayContaining(["rod", "fishLine", "bobber"]));
    const geometries = buildItemGeometries();
    for (const name of ITEM_PART_NAMES) {
      const geometry = geometries[name];
      const count = geometry.getAttribute("position").count;
      expect(count, name).toBeGreaterThan(0);
      expect(geometry.getAttribute("normal")?.count, name).toBe(count);
      expect(geometry.getAttribute("color")?.count, name).toBe(count);
    }
  });

  it("rises from the lead hand toward the sea at the planned angle and clears the monk's head", () => {
    const avatar = steadyAngler(AT_ORIGIN);
    const hand = nodeOf(avatar, "hand", 0);
    const grip = ROD.grip.clone().applyMatrix4(hand.matrixWorld);
    const tip = rodTipOf(avatar);
    const direction = tip.clone().sub(grip).normalize();

    expect(Math.asin(direction.y), "the elevation").toBeCloseTo(ROD_POSE.elevation, 2);
    expect(Math.abs(direction.x), "straight ahead").toBeLessThan(0.01);
    expect(direction.z, "forward is -z").toBeLessThan(0);
    expect(tip.y, "the tip is above the crown").toBeGreaterThan(monkRig.hipStand + monkRig.neckY + monkRig.crownY);
    expect(grip.distanceTo(positionOf(hand)), "the grip is in the hand").toBeLessThan(0.1);
  });

  it("is modelled along that line, from a thick butt in the hand to a thin tip", () => {
    const avatar = steadyAngler(AT_ORIGIN);
    const hand = nodeOf(avatar, "hand", 0);
    const origin = positionOf(hand);
    const vertices = worldVertices(hand, buildItemGeometries().rod);
    const farthest = vertices.reduce((far, v) => (v.distanceTo(origin) > far.distanceTo(origin) ? v : far));
    expect(farthest.distanceTo(rodTipOf(avatar)), "the longest reach of the model is the tip").toBeLessThan(0.02);
    expect(Math.max(...vertices.map((v) => v.y)), "the tip stands high above the ground").toBeGreaterThan(1.4);
  });

  it("is shown only to a monk holding it, and the line and float only while a line is out", async () => {
    const pool = new MonkPool(new Group(), await loadAssets(), 4);
    const shown = (name: string): boolean => {
      const matrix = new Matrix4();
      (pool.group.getObjectByName(`monk-${name}`) as InstancedMesh).getMatrixAt(0, matrix);
      return matrix.determinant() !== 0;
    };
    const state = (): boolean[] => [shown("rod"), shown("fishLine"), shown("bobber")];

    const monk = steadyAngler();
    pool.add(monk);
    pool.flush();
    expect(state(), "fishing").toEqual([true, true, true]);

    monk.setMode("stand", 6000);
    monk.animate(0.016, 6000, 0, true);
    pool.flush();
    expect(state(), "standing with the rod, nothing is cast").toEqual([true, false, false]);

    monk.setMode("fish", 7000);
    monk.item = ITEM_NONE;
    monk.animate(0.016, 7000, 0, true);
    pool.flush();
    expect(state(), "without the rod").toEqual([false, false, false]);
    pool.dispose();
  });
});

describe("the line and the float", () => {
  it("lands the float on the water past the waterline, level with the monk along the shore", () => {
    const float = positionOf(nodeOf(steadyAngler({ x: 17.6, z: 3.5 }), "bobber"));
    expect(float.x, "past the waterline").toBeGreaterThan(SEA_LINE_X + 1);
    expect(float.x, "not far out").toBeLessThan(SEA_LINE_X + 3);
    expect(float.z).toBeCloseTo(3.5, 3);
    expect(Math.abs(float.y), "on the water").toBeLessThan(0.05);
  });

  it("stretches the line from the rod tip to the float", () => {
    const avatar = steadyAngler({ x: 16.9, z: -4 });
    const tip = rodTipOf(avatar);
    const float = positionOf(nodeOf(avatar, "bobber"));
    const line = nodeOf(avatar, "fishLine");
    const fromTip = new Vector3(0, -0.5, 0).applyMatrix4(line.matrixWorld);
    const toFloat = new Vector3(0, 0.5, 0).applyMatrix4(line.matrixWorld);
    expect(fromTip.distanceTo(tip), "the line starts at the tip").toBeLessThan(1e-3);
    expect(toFloat.distanceTo(float), "the line ends at the float").toBeLessThan(1e-3);
    expect(tip.y, "the line runs down to the water").toBeGreaterThan(float.y);
  });

  it("keeps the float where it is whichever way the monk is turned", () => {
    const facing = positionOf(nodeOf(steadyAngler({ x: 17.2, z: 1 }), "bobber"));
    const turned = positionOf(nodeOf(steadyAngler({ x: 17.2, z: 1, yaw: FACING_SEA + 0.6 }), "bobber"));
    expect(turned.distanceTo(facing)).toBeLessThan(1e-6);
  });

  it("dips the float when a fish takes the bait", () => {
    const calm = positionOf(nodeOf(steadyAngler(), "bobber")).y;
    const biting = positionOf(nodeOf(steadyAngler({ bite: true }), "bobber")).y;
    expect(calm - biting).toBeGreaterThan(0.03);
  });

  it("throws the float out from the rod in an arc, and it settles on the water", () => {
    const avatar = newAngler({ since: 5000 });
    avatar.animate(0.016, 5080, 0, false);
    const early = positionOf(nodeOf(avatar, "bobber"));
    avatar.animate(0.016, 7000, 0, false);
    const settled = positionOf(nodeOf(avatar, "bobber"));
    expect(early.x, "still on its way out").toBeLessThan(settled.x - 0.5);
    expect(early.y, "above the water in flight").toBeGreaterThan(settled.y + 0.2);
    expect(settled.x).toBeGreaterThan(SEA_LINE_X + 1);
    expect(Math.abs(settled.y), "back on the water").toBeLessThan(0.05);
  });
});
