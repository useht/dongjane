import { readFileSync } from "node:fs";
import { type BufferGeometry, Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { extractMonkParts, monkRig } from "../src/game/monk-assets.ts";
import { PART_NAMES, type PartName } from "../src/game/monk-model.ts";

const COPIES: Record<PartName, number> = {
  head: 1,
  face: 1,
  hair: 1,
  skirt: 1,
  torso: 1,
  trim: 1,
  sleeveUpper: 2,
  sleeveLower: 2,
  hand: 2,
  foot: 2,
  leg: 2,
};
const ROBE_PARTS: PartName[] = ["skirt", "torso", "sleeveUpper", "sleeveLower"];

function readGlb(): ArrayBuffer {
  const file = readFileSync(new URL("../assets/monk/monk.glb", import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

async function loadParts(): Promise<Record<PartName, BufferGeometry>> {
  const gltf = await new GLTFLoader().parseAsync(readGlb(), "");
  return extractMonkParts(gltf.scene);
}

function bounds(geometry: BufferGeometry): Box3 {
  return new Box3().setFromBufferAttribute(geometry.getAttribute("position") as never);
}

// The chin is the lowest point of the jaw: the lowest head vertex in front of the neck stub (toward -Z).
function chinY(head: BufferGeometry): number {
  const position = head.getAttribute("position");
  let lowest = Infinity;
  for (let i = 0; i < position.count; i += 1) {
    if (position.getZ(i) < -0.07) lowest = Math.min(lowest, position.getY(i));
  }
  return lowest;
}

function triangles(geometry: BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
}

describe("monk assets", () => {
  it("contains every part the rig binds", async () => {
    const parts = await loadParts();
    for (const name of PART_NAMES) expect(parts[name], name).toBeDefined();
  });

  it("gives every part positions, normals and vertex colours", async () => {
    const parts = await loadParts();
    for (const name of PART_NAMES) {
      const geometry = parts[name];
      const count = geometry.getAttribute("position").count;
      expect(count, name).toBeGreaterThan(0);
      expect(geometry.getAttribute("normal")?.count, name).toBe(count);
      expect(geometry.getAttribute("color")?.count, name).toBe(count);
    }
  });

  it("keeps the robe white so the per-monk tint shows", async () => {
    const parts = await loadParts();
    for (const name of ROBE_PARTS) {
      const color = (parts[name] as BufferGeometry).getAttribute("color");
      for (let i = 0; i < color.count; i += 1) {
        expect(color.getX(i)).toBeCloseTo(1, 3);
        expect(color.getY(i)).toBeCloseTo(1, 3);
        expect(color.getZ(i)).toBeCloseTo(1, 3);
      }
    }
  });

  it("colours the trim, face and feet instead of leaving them white", async () => {
    const parts = await loadParts();
    for (const name of ["trim", "face", "hair", "foot", "hand", "head"] as const) {
      const color = parts[name].getAttribute("color");
      let allWhite = true;
      for (let i = 0; i < color.count; i += 1) {
        if (color.getX(i) < 0.99 || color.getY(i) < 0.99 || color.getZ(i) < 0.99) allWhite = false;
      }
      expect(allWhite, name).toBe(false);
    }
  });

  it("faces the camera side: the face and hair sit toward -Z", async () => {
    const parts = await loadParts();
    const centre = new Vector3();
    expect(bounds(parts.face).getCenter(centre).z).toBeLessThan(0);
    expect(bounds(parts.hair).getCenter(centre).z).toBeLessThan(0);
    const head = bounds(parts.head);
    expect(-head.min.z).toBeGreaterThan(head.max.z);
  });

  it("hangs the sleeve from its shoulder pivot down to the elbow", async () => {
    const parts = await loadParts();
    const box = bounds(parts.sleeveUpper);
    expect(box.min.y).toBeCloseTo(-monkRig.upperArm, 2);
    expect(box.max.y).toBeGreaterThan(0);
    expect(box.max.y).toBeLessThan(monkRig.upperArm * 0.5);
    const lower = bounds(parts.sleeveLower);
    expect(lower.min.y).toBeLessThan(-monkRig.foreArm * 0.8);
  });

  it("stays mirror-symmetric where one geometry serves both sides", async () => {
    const parts = await loadParts();
    for (const name of ["sleeveUpper", "sleeveLower", "hand", "foot", "leg"] as const) {
      const box = bounds(parts[name]);
      expect(box.min.x, name).toBeCloseTo(-box.max.x, 4);
    }
  });

  it("puts the head above the neck pivot and the feet near the ground", async () => {
    const parts = await loadParts();
    const head = bounds(parts.head);
    expect(head.max.y).toBeCloseTo(monkRig.crownY, 1);
    expect(head.min.y).toBeLessThan(0.02);
    expect(bounds(parts.foot).min.y).toBeCloseTo(-monkRig.footY, 2);
    expect(bounds(parts.skirt).min.y).toBeCloseTo(-monkRig.skirtDrop, 3);
  });

  it("keeps the whole monk within the triangle budget", async () => {
    const parts = await loadParts();
    let total = 0;
    for (const name of PART_NAMES) total += triangles(parts[name]) * COPIES[name];
    expect(total).toBeLessThan(4000);
  });

  it("ships a complete rig description", () => {
    for (const key of [
      "hipStand",
      "hipKneel",
      "skirtDrop",
      "torsoHeight",
      "neckY",
      "shoulderX",
      "shoulderY",
      "upperArm",
      "foreArm",
      "footX",
      "footY",
      "footForward",
      "footKneelZ",
      "footKneelY",
      "footKneelTilt",
      "legTopDrop",
      "legLength",
      "kneelSkirtGrow",
      "kneelSkirtScaleY",
      "cushionTop",
    ] as const) {
      expect(monkRig[key], key).toBeGreaterThan(0);
    }
    expect(monkRig.kneelSkirtLift).toBeGreaterThanOrEqual(0);
  });

  it("keeps the rig pivots consistent with the geometry hung on them", async () => {
    const parts = await loadParts();
    const torso = bounds(parts.torso);
    const head = bounds(parts.head);
    const upper = bounds(parts.sleeveUpper);
    const lower = bounds(parts.sleeveLower);

    // The neck pivot is the top of the torso; the head's neck stub dips just below it into the robe.
    expect(monkRig.neckY).toBeCloseTo(monkRig.torsoHeight, 4);
    expect(torso.max.y).toBeCloseTo(monkRig.neckY, 3);
    expect(monkRig.neckY + head.min.y).toBeLessThanOrEqual(torso.max.y);
    expect(monkRig.neckY + head.min.y).toBeGreaterThan(torso.max.y - 0.05);

    // The shoulder pivot sits a little below the neck, and the sleeve spans one upper arm plus its shoulder cap.
    expect(monkRig.shoulderY).toBeLessThan(monkRig.neckY);
    expect(monkRig.shoulderY).toBeGreaterThan(monkRig.neckY - 0.1);
    const span = upper.max.y - upper.min.y;
    expect(span).toBeGreaterThan(monkRig.upperArm);
    expect(span).toBeLessThan(monkRig.upperArm * 1.4);

    // The forearm sleeve ends just above the wrist pivot where the hand hangs.
    expect(lower.min.y).toBeGreaterThan(-monkRig.foreArm);
    expect(lower.min.y).toBeLessThan(-monkRig.foreArm * 0.8);
  });

  it("keeps the chibi proportions measured from docs/reference/images.jpg (in head heights, H = crown to chin)", async () => {
    const parts = await loadParts();
    const head = bounds(parts.head);
    const foot = bounds(parts.foot);
    const crown = head.max.y;
    const chin = chinY(parts.head);
    const H = crown - chin;
    expect(H, "head height").toBeCloseTo(monkRig.headHeight, 2);

    // Everything below is read off the meshes: head, neck pivot (top of the torso), hip pivot and the sole of the foot.
    const crownWorld = monkRig.hipStand + monkRig.neckY + crown;
    const chinWorld = monkRig.hipStand + monkRig.neckY + chin;
    const soleWorld = monkRig.footY + foot.min.y;
    expect(soleWorld, "sole on the ground").toBeCloseTo(0, 2);

    expect(Math.abs((crownWorld - soleWorld) / H - 3.18), "standing height").toBeLessThanOrEqual(0.05);
    expect(Math.abs((chinWorld - monkRig.hipStand) / H - 0.68), "chin to hip").toBeLessThanOrEqual(0.03);
    expect(Math.abs((monkRig.hipStand - soleWorld) / H - 1.5), "hip to sole").toBeLessThanOrEqual(0.05);
    expect(Math.abs((head.max.x - head.min.x) / H - 0.86), "head width incl. ears").toBeLessThanOrEqual(0.03);
    expect((monkRig.shoulderX * 2) / H, "shoulder joints").toBeLessThan(0.7);

    // Same overall size as the first version of the monk, so cameras, labels and the cushion keep working.
    const kneelingCrown = monkRig.cushionTop + monkRig.hipKneel + monkRig.neckY + crown;
    expect(crownWorld).toBeGreaterThan(1.168 * 0.85);
    expect(crownWorld).toBeLessThan(1.168 * 1.15);
    expect(kneelingCrown).toBeGreaterThan(1.098 * 0.85);
    expect(kneelingCrown).toBeLessThan(1.098 * 1.15);
  });

  it("shows the cream socks: the hem is high above the sole, the foot sits below it and a leg bridges the gap", async () => {
    const parts = await loadParts();
    const H = monkRig.headHeight;
    const skirt = bounds(parts.skirt);
    const foot = bounds(parts.foot);
    const leg = bounds(parts.leg);

    const hem = monkRig.hipStand + skirt.min.y;
    const sole = monkRig.footY + foot.min.y;
    const footTop = monkRig.footY + foot.max.y;
    expect((hem - sole) / H, "sock gap between hem and sole").toBeGreaterThanOrEqual(0.5);
    expect(Math.abs((hem - sole) / H - 0.83), "sock gap between hem and sole").toBeLessThanOrEqual(0.05);
    expect(footTop, "the foot stays below the hem").toBeLessThan(hem);

    // The leg hangs from a pivot inside the skirt and reaches down to the foot, so no gap shows between hem and sole.
    const legTop = monkRig.hipStand - monkRig.legTopDrop + leg.max.y;
    const legBottom = monkRig.hipStand - monkRig.legTopDrop + leg.min.y;
    expect(legTop, "the leg top is hidden inside the skirt").toBeGreaterThan(hem);
    expect(legBottom, "the leg reaches the foot").toBeLessThanOrEqual(footTop);
    expect(monkRig.legLength).toBeCloseTo(monkRig.hipStand - monkRig.legTopDrop - monkRig.footY, 3);
  });

  it("keeps the hair slot free of geometry above the scalp (the head reads as shaved)", async () => {
    const parts = await loadParts();
    const head = bounds(parts.head);
    const hair = bounds(parts.hair);
    expect(hair.max.y, "nothing in the hair slot reaches the crown").toBeLessThan(head.max.y - 0.05);
    expect(hair.min.x).toBeGreaterThanOrEqual(head.min.x);
    expect(hair.max.x).toBeLessThanOrEqual(head.max.x);
    expect(hair.min.z).toBeGreaterThanOrEqual(head.min.z);
    expect(hair.max.z).toBeLessThanOrEqual(head.max.z);
    expect(triangles(parts.hair)).toBeLessThan(20);
  });

  it("keeps the hem off the ground and clear of the cushion, with the toes showing past it", async () => {
    const parts = await loadParts();
    const skirt = bounds(parts.skirt);
    const foot = bounds(parts.foot);

    const hemStanding = monkRig.hipStand + skirt.min.y;
    expect(hemStanding).toBeGreaterThan(0.25);
    expect(hemStanding).toBeLessThan(0.35);
    const hemKneeling = monkRig.cushionTop + monkRig.hipKneel + monkRig.kneelSkirtLift + skirt.min.y * monkRig.kneelSkirtScaleY;
    expect(hemKneeling).toBeGreaterThanOrEqual(monkRig.cushionTop);
    expect(hemKneeling - monkRig.cushionTop, "the kneeling hem rests on the cushion").toBeLessThan(0.02);

    // Kneeling, the foot is turned over behind the hip: its top rests on the cushion, the toes show past the back hem.
    expect(monkRig.footKneelY - foot.max.y).toBeGreaterThanOrEqual(0);
    expect(monkRig.footKneelZ - foot.min.z).toBeGreaterThan(skirt.max.z * (1 + monkRig.kneelSkirtGrow) + 0.02);
  });

  it("fades the scalp tint in smoothly instead of leaving a cap seam", async () => {
    const parts = await loadParts();
    const head = parts.head;
    const color = head.getAttribute("color");
    const position = head.getAttribute("position");
    const index = head.index;
    expect(index).not.toBeNull();

    let crown = 0;
    let crownY = -Infinity;
    let neck = 0;
    let neckY = Infinity;
    for (let i = 0; i < position.count; i += 1) {
      if (position.getY(i) > crownY) [crownY, crown] = [position.getY(i), i];
      if (position.getY(i) < neckY) [neckY, neck] = [position.getY(i), i];
    }
    const channelGap = (a: number, b: number): number =>
      Math.max(Math.abs(color.getX(a) - color.getX(b)), Math.abs(color.getY(a) - color.getY(b)), Math.abs(color.getZ(a) - color.getZ(b)));
    expect(channelGap(crown, neck), "the crown should be a shade darker than the skin").toBeGreaterThan(0.1);
    expect(color.getX(crown)).toBeLessThan(color.getX(neck));

    let steepest = 0;
    const ids = (index as NonNullable<typeof index>).array;
    for (let t = 0; t < ids.length; t += 3) {
      for (let e = 0; e < 3; e += 1) steepest = Math.max(steepest, channelGap(ids[t + e] as number, ids[t + ((e + 1) % 3)] as number));
    }
    expect(steepest, "no neighbouring vertices may jump in colour").toBeLessThan(0.12);
  });

  it("rejects a scene that lacks a part", async () => {
    const gltf = await new GLTFLoader().parseAsync(readGlb(), "");
    const hair = gltf.scene.getObjectByName("hair");
    hair?.removeFromParent();
    expect(() => extractMonkParts(gltf.scene)).toThrow(/hair/);
  });
});
