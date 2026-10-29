import { readFileSync } from "node:fs";
import { type BufferGeometry, Box3, Color, type Object3D, SRGBColorSpace, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { extractMonkParts, monkRig } from "../src/game/monk-assets.ts";
import { MonkAvatar, PART_NAMES, ROBE_PARTS as MODEL_ROBE_PARTS, type PartName, robeColor } from "../src/game/monk-model.ts";

const COPIES: Record<PartName, number> = {
  head: 1,
  face: 1,
  hair: 1,
  pelvis: 1,
  torso: 1,
  trim: 1,
  sleeveUpper: 2,
  sleeveLower: 2,
  hand: 2,
  foot: 2,
  leg: 2,
  trousers: 2,
};
// The jacket (torso, sleeves) and the trousers (pelvis seat, trouser legs) are the tinted garment.
const JACKET_PARTS: PartName[] = ["torso", "sleeveUpper", "sleeveLower"];
const TROUSER_PARTS: PartName[] = ["pelvis", "trousers"];
const ROBE_PARTS: PartName[] = [...JACKET_PARTS, ...TROUSER_PARTS];

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

function posedAvatar(mode: string): MonkAvatar {
  const avatar = new MonkAvatar("test", 0, false);
  avatar.setMode(mode, 0);
  avatar.animate(0.016, 1000, 0, true);
  return avatar;
}

function nodeOf(avatar: MonkAvatar, part: PartName, copy: number): Object3D {
  const binding = avatar.bindings.find((b) => b.part === part && b.copy === copy);
  if (!binding) throw new Error(`no ${part} binding ${copy}`);
  return binding.node;
}

function worldVertices(node: Object3D, geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position as never, i).applyMatrix4(node.matrixWorld));
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

  it("tints exactly the jacket and the trousers per monk", () => {
    expect([...MODEL_ROBE_PARTS].sort()).toEqual([...ROBE_PARTS].sort());
  });

  it("bakes the jacket and the trousers as ash grey (the 동자승 outfit), the jacket lighter than the trousers", async () => {
    const parts = await loadParts();
    const mean = (geometry: BufferGeometry): Color => {
      const color = geometry.getAttribute("color");
      const sum = new Color(0, 0, 0);
      for (let i = 0; i < color.count; i += 1) {
        // Every vertex is the same flat shade: the garment carries no pattern of its own, the tint does the rest.
        expect(color.getX(i)).toBeCloseTo(color.getX(0), 3);
        expect(color.getY(i)).toBeCloseTo(color.getY(0), 3);
        expect(color.getZ(i)).toBeCloseTo(color.getZ(0), 3);
        sum.r += color.getX(i);
        sum.g += color.getY(i);
        sum.b += color.getZ(i);
      }
      return sum.multiplyScalar(1 / color.count);
    };
    for (const name of ROBE_PARTS) {
      const base = mean(parts[name]);
      const hsl = base.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
      expect(hsl.s, `${name} is grey, not coloured`).toBeLessThan(0.1);
      expect(hsl.l, `${name} is neither white nor black`).toBeGreaterThan(0.35);
      expect(hsl.l, `${name} is neither white nor black`).toBeLessThan(0.7);
    }
    const lightness = (name: PartName): number => mean(parts[name]).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).l;
    for (const name of JACKET_PARTS) expect(lightness(name), `${name} matches the jacket`).toBeCloseTo(lightness("torso"), 3);
    for (const name of TROUSER_PARTS) expect(lightness(name), `${name} matches the trousers`).toBeCloseTo(lightness("trousers"), 3);
    expect(lightness("torso"), "the jacket is the lighter grey").toBeGreaterThan(lightness("trousers") + 0.04);
  });

  it("gives every monk its hue as a muted tint on the grey: clearly different colours, still a grey 승복", async () => {
    const parts = await loadParts();
    const shownOf = (part: PartName, hue: number): Color => {
      const color = parts[part].getAttribute("color");
      return new Color(color.getX(0), color.getY(0), color.getZ(0)).multiply(robeColor(hue, new Color()));
    };
    const hues: number[] = [];
    for (let hue = 0; hue < 360; hue += 30) hues.push(hue);
    for (const part of ["torso", "trousers"] as const) {
      const shown = hues.map((hue) => shownOf(part, hue));
      shown.forEach((color, i) => {
        const hsl = color.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
        expect(hsl.s, `${part} saturation at hue ${hues[i]}: tinted, not grey`).toBeGreaterThan(0.12);
        expect(hsl.s, `${part} saturation at hue ${hues[i]}: muted, not a bright robe`).toBeLessThan(0.35);
        expect(hsl.l, `${part} lightness at hue ${hues[i]}`).toBeGreaterThan(0.3);
        expect(hsl.l, `${part} lightness at hue ${hues[i]}`).toBeLessThan(0.65);
      });
      // Monks whose hues are 60 degrees apart (the spread of the identity colours) differ clearly in the colour the player sees.
      shown.forEach((color, i) => {
        const other = shown[(i + 2) % shown.length] as Color;
        const a = color.clone().convertLinearToSRGB();
        const b = other.clone().convertLinearToSRGB();
        const seen = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
        expect(seen, `${part}: hue ${hues[i]} and ${hues[(i + 2) % hues.length]} look different`).toBeGreaterThan(0.07);
      });
    }
    expect(robeColor(-210, new Color()).getHex(), "hues wrap around").toBe(robeColor(150, new Color()).getHex());
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
    for (const name of ["sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers", "pelvis", "torso"] as const) {
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
    expect(bounds(parts.torso).min.y, "the jacket hem hangs jacketDrop below the hip pivot").toBeCloseTo(-monkRig.jacketDrop, 3);
    expect(bounds(parts.pelvis).min.y, "the seat of the trousers reaches pelvisDrop below the hip pivot").toBeCloseTo(-monkRig.pelvisDrop, 3);
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
      "jacketDrop",
      "pelvisDrop",
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
      "kneelPelvisGrow",
      "kneelPelvisScaleY",
      "cushionTop",
      "robeTintSaturation",
      "robeTintLightness",
    ] as const) {
      expect(monkRig[key], key).toBeGreaterThan(0);
    }
    expect(monkRig.kneelPelvisLift).toBeGreaterThanOrEqual(0);
    expect(monkRig.robeTintSaturation).toBeLessThanOrEqual(1);
    expect(monkRig.robeTintLightness).toBeLessThanOrEqual(1);
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

    // The shoulder pivot sits below the neck (the shoulders slope), and the sleeve spans one upper arm plus its shoulder cap.
    expect(monkRig.shoulderY).toBeLessThan(monkRig.neckY);
    expect(monkRig.shoulderY).toBeGreaterThan(monkRig.neckY - 0.15);
    const span = upper.max.y - upper.min.y;
    expect(span).toBeGreaterThan(monkRig.upperArm);
    expect(span).toBeLessThan(monkRig.upperArm * 1.4);

    // The forearm sleeve ends just above the wrist pivot where the hand hangs.
    expect(lower.min.y).toBeGreaterThan(-monkRig.foreArm);
    expect(lower.min.y).toBeLessThan(-monkRig.foreArm * 0.8);
  });

  it("is 4 heads tall (4등신), laid out like docs/reference/img.jpg (in head heights, H = crown to chin)", async () => {
    const parts = await loadParts();
    const head = bounds(parts.head);
    const foot = bounds(parts.foot);
    const crown = head.max.y;
    const chin = chinY(parts.head);
    const H = crown - chin;
    expect(H, "head height").toBeCloseTo(monkRig.headHeight, 2);
    expect(H, "head height in scene units").toBeCloseTo(0.33, 2);

    // Everything below is read off the meshes: head, neck pivot (top of the torso), hip pivot and the sole of the foot.
    const crownWorld = monkRig.hipStand + monkRig.neckY + crown;
    const chinWorld = monkRig.hipStand + monkRig.neckY + chin;
    const soleWorld = monkRig.footY + foot.min.y;
    expect(soleWorld, "sole on the ground").toBeCloseTo(0, 2);

    expect(Math.abs((crownWorld - soleWorld) / H - 4), "standing height: 4 heads").toBeLessThanOrEqual(0.05);
    expect(Math.abs((chinWorld - soleWorld) / H - 3), "chin height: 3 heads").toBeLessThanOrEqual(0.05);
    expect(Math.abs((chinWorld - monkRig.hipStand) / H - 1.25), "chin to hip").toBeLessThanOrEqual(0.03);
    expect(Math.abs((monkRig.hipStand - soleWorld) / H - 1.75), "hip to sole").toBeLessThanOrEqual(0.05);
    expect(Math.abs((head.max.x - head.min.x) / H - 0.94), "head width incl. ears").toBeLessThanOrEqual(0.03);
    expect((monkRig.shoulderX * 2) / H, "shoulder joints").toBeLessThan(0.7);

    // The arm: shoulder joint, elbow and fingertip, measured with the arm hanging straight down.
    const upper = -bounds(parts.sleeveUpper).min.y;
    const shoulderWorld = monkRig.hipStand + monkRig.shoulderY;
    const fingertipWorld = shoulderWorld - upper - monkRig.foreArm + bounds(parts.hand).min.y;
    const reach = shoulderWorld - fingertipWorld;
    expect(Math.abs((chinWorld - shoulderWorld) / H - 0.45), "chin to shoulder joint").toBeLessThanOrEqual(0.03);
    expect(Math.abs((shoulderWorld - soleWorld) / H - 2.55), "shoulder joint height").toBeLessThanOrEqual(0.03);
    expect(Math.abs((fingertipWorld - soleWorld) / H - 1.58), "fingertip height").toBeLessThanOrEqual(0.04);
    expect(Math.abs(upper / H - 0.35), "upper arm").toBeLessThanOrEqual(0.03);
    expect(Math.abs(monkRig.foreArm / H - 0.31), "forearm").toBeLessThanOrEqual(0.03);
    expect(Math.abs(reach / H - 0.97), "shoulder to fingertip").toBeLessThanOrEqual(0.03);
    expect(Math.abs(upper / reach - 0.36), "elbow along the arm, from the shoulder").toBeLessThanOrEqual(0.03);

    // The head keeps its size; the body is 4 heads (1.32 standing). Kneeling, the seat of the trousers (pelvisDrop below the hip)
    // rests on the cushion, so the hip drops to cushion + pelvisDrop and the crown to about 0.81 of the standing crown (1.068).
    const kneelingCrown = monkRig.cushionTop + monkRig.hipKneel + monkRig.neckY + crown;
    expect(Math.abs(crownWorld - 1.32), "standing crown").toBeLessThanOrEqual(0.03);
    expect(Math.abs(kneelingCrown - 1.068), "kneeling crown").toBeLessThanOrEqual(0.03);
    expect(monkRig.hipKneel - monkRig.pelvisDrop * monkRig.kneelPelvisScaleY, "the seat rests on the cushion").toBeLessThan(0.02);
  });

  it("dresses the 동자승 in a hip-length jacket over baggy trousers gathered above the ankle, the foot showing below the cuff", async () => {
    const parts = await loadParts();
    const H = monkRig.headHeight;
    const jacket = bounds(parts.torso);
    const pelvis = bounds(parts.pelvis);
    const trousers = bounds(parts.trousers);
    const foot = bounds(parts.foot);
    const leg = bounds(parts.leg);

    const sole = monkRig.footY + foot.min.y;
    const footTop = monkRig.footY + foot.max.y;
    const hem = monkRig.hipStand + jacket.min.y;
    const crotch = monkRig.hipStand + pelvis.min.y;
    const legPivot = monkRig.hipStand - monkRig.legTopDrop;
    const cuff = legPivot + trousers.min.y;

    // The jacket ends just below the hip (not a robe down to the shins), the crotch hangs lower, and the cuff is just above the ankle.
    expect(Math.abs((hem - sole) / H - 1.49), "jacket hem above the sole (1.49 H, just below the hip at 1.75 H)").toBeLessThanOrEqual(0.04);
    expect(hem, "the hem is below the hip pivot").toBeLessThan(monkRig.hipStand);
    expect(monkRig.hipStand - hem, "the hem is only just below the hip pivot").toBeLessThan(0.3 * H);
    expect(crotch, "the crotch hangs below the jacket hem").toBeLessThan(hem);
    expect(Math.abs((crotch - sole) / H - 1.18), "crotch above the sole").toBeLessThanOrEqual(0.04);
    expect(Math.abs((cuff - sole) / H - 0.335), "trouser cuff above the sole").toBeLessThanOrEqual(0.04);
    expect(footTop, "the foot shows below the cuff").toBeLessThan(cuff);
    expect((cuff - footTop) / H, "the cuff clears the foot by a visible band of ankle").toBeGreaterThan(0.045);

    // The leg hangs from a pivot inside the trouser leg and reaches down to the foot, so no gap shows between cuff and foot.
    const legTop = legPivot + leg.max.y;
    const legBottom = legPivot + leg.min.y;
    expect(legTop, "the leg top is hidden inside the trousers").toBeGreaterThan(cuff);
    expect(legBottom, "the leg reaches the foot").toBeLessThanOrEqual(footTop);
    expect(monkRig.legLength).toBeCloseTo(monkRig.hipStand - monkRig.legTopDrop - monkRig.footY, 3);

    // The trouser leg hangs from the same pivot and tops out inside the seat, so the two join without a gap.
    expect(legPivot + trousers.max.y, "the trouser leg reaches up into the seat").toBeGreaterThan(monkRig.hipStand + pelvis.min.y);
    expect(legPivot + trousers.max.y, "the trouser leg reaches up into the seat").toBeLessThan(monkRig.hipStand + pelvis.max.y);
  });

  it("makes the trousers wide at the thigh, gathered at the ankle", async () => {
    const parts = await loadParts();
    const trousers = bounds(parts.trousers);
    const leg = bounds(parts.leg);
    const position = parts.trousers.getAttribute("position");
    let cuffRadius = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (position.getY(i) < trousers.min.y + 0.004) cuffRadius = Math.max(cuffRadius, Math.abs(position.getX(i)));
    }
    // The bare leg's radius is read off the lowest part of the leg (below the sock's folded cuff, which bulges out higher up).
    const legPosition = parts.leg.getAttribute("position");
    let legRadius = 0;
    for (let i = 0; i < legPosition.count; i += 1) {
      if (legPosition.getY(i) < leg.min.y + 0.05) legRadius = Math.max(legRadius, Math.abs(legPosition.getX(i)));
    }
    expect(trousers.max.x / legRadius, "baggy: the thigh is 1.5 to 1.8 times the bare leg's radius").toBeGreaterThan(1.4);
    expect(trousers.max.x / legRadius, "baggy: the thigh is 1.5 to 1.8 times the bare leg's radius").toBeLessThan(1.9);
    expect(cuffRadius, "the cuff hugs the ankle").toBeLessThan(legRadius * 1.2);
    expect(trousers.max.x / cuffRadius, "the leg is gathered in below the knee").toBeGreaterThan(1.3);
  });

  it("lets the arms hang straight when standing: no crease at the elbow, the fingertips at 1.58 H", async () => {
    const parts = await loadParts();
    const H = monkRig.headHeight;
    const avatar = posedAvatar("stand");
    for (const side of [0, 1]) {
      const shoulder = new Vector3().setFromMatrixPosition(nodeOf(avatar, "sleeveUpper", side).matrixWorld);
      const elbow = new Vector3().setFromMatrixPosition(nodeOf(avatar, "sleeveLower", side).matrixWorld);
      const wrist = new Vector3().setFromMatrixPosition(nodeOf(avatar, "hand", side).matrixWorld);
      const bend = elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow));
      expect(bend, `elbow bend of arm ${side}`).toBeLessThan(0.15);
      expect(Math.abs(elbow.x - shoulder.x), "the upper arm hangs vertically").toBeLessThan(0.01);
      const tip = Math.min(...worldVertices(nodeOf(avatar, "hand", side), parts.hand).map((v) => v.y));
      expect(Math.abs(tip / H - 1.58), `fingertip height of arm ${side}`).toBeLessThanOrEqual(0.04);
    }
  });

  it("brings the praying hands together under the chin, in front of the robe", async () => {
    const parts = await loadParts();
    const chin = chinY(parts.head);
    const avatar = posedAvatar("kneel");
    const chinWorld = monkRig.cushionTop + monkRig.hipKneel + monkRig.neckY + chin;
    const tips: Vector3[] = [];
    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;
      const points = worldVertices(nodeOf(avatar, "hand", side), parts.hand);
      expect(Math.max(...points.map((v) => v.y)), `hand ${side} stays below the chin`).toBeLessThan(chinWorld);
      expect(Math.max(...points.map((v) => v.z)), `hand ${side} stays in front of the chest`).toBeLessThan(-0.05);
      expect(Math.min(...points.map((v) => sign * v.x)), `hand ${side} does not cross the middle`).toBeGreaterThan(-0.012);
      tips.push(points.reduce((top, v) => (v.y > top.y ? v : top)));
    }
    expect(Math.abs((tips[0] as Vector3).x - (tips[1] as Vector3).x), "the fingertips meet").toBeLessThan(0.06);
    for (const side of [0, 1]) {
      const palm = new Vector3(0, 0, 1).transformDirection(nodeOf(avatar, "hand", side).matrixWorld);
      expect(Math.abs(palm.x), `the palm of hand ${side} faces the other hand`).toBeGreaterThan(0.9);
    }
  });

  it("draws the face with eyes, nose and mouth only: no blush on the cheeks", async () => {
    const parts = await loadParts();
    const color = parts.face.getAttribute("color");
    const shades = new Set<string>();
    for (let i = 0; i < color.count; i += 1) shades.add([color.getX(i), color.getY(i), color.getZ(i)].map((c) => c.toFixed(2)).join(","));
    expect(shades.size, "eye, nose and mouth shades").toBe(3);
    const box = bounds(parts.face);
    expect(box.max.x - box.min.x, "the face features stay between the eyes").toBeLessThan(0.18);
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

  it("keeps the jacket and trousers off the ground and clear of the cushion, with the toes showing past the seat", async () => {
    const parts = await loadParts();
    const pelvis = bounds(parts.pelvis);
    const jacket = bounds(parts.torso);
    const foot = bounds(parts.foot);

    const hemStanding = monkRig.hipStand + jacket.min.y;
    expect(hemStanding).toBeGreaterThan(0.4);
    expect(hemStanding).toBeLessThan(0.55);
    const seatKneeling = monkRig.cushionTop + monkRig.hipKneel + monkRig.kneelPelvisLift + pelvis.min.y * monkRig.kneelPelvisScaleY;
    expect(seatKneeling).toBeGreaterThanOrEqual(monkRig.cushionTop);
    expect(seatKneeling - monkRig.cushionTop, "the kneeling seat rests on the cushion").toBeLessThan(0.02);
    const hemKneeling = monkRig.cushionTop + monkRig.hipKneel + jacket.min.y;
    expect(hemKneeling - monkRig.cushionTop, "the jacket hem stays above the spread seat").toBeGreaterThan(0.05);

    // Kneeling, the foot is turned over behind the hip: its top rests on the cushion, the toes show past the back of the seat.
    expect(monkRig.footKneelY - foot.max.y).toBeGreaterThanOrEqual(0);
    expect(monkRig.footKneelZ - foot.min.z).toBeGreaterThan(pelvis.max.z * (1 + monkRig.kneelPelvisGrow) + 0.02);
  });

  it("folds the trousers behind the knees when kneeling without sinking into the cushion", async () => {
    const parts = await loadParts();
    const avatar = posedAvatar("kneel");
    const lowest = (part: PartName): number => {
      let low = Infinity;
      for (let copy = 0; copy < COPIES[part]; copy += 1) {
        low = Math.min(low, ...worldVertices(nodeOf(avatar, part, copy), parts[part]).map((v) => v.y));
      }
      return low;
    };
    for (const part of ["pelvis", "trousers", "leg", "foot"] as const) {
      expect(lowest(part), `${part} rests on the cushion, not in it`).toBeGreaterThanOrEqual(monkRig.cushionTop - 0.002);
      expect(lowest(part) - monkRig.cushionTop, `${part} sits right on the cushion`).toBeLessThan(0.03);
    }
    const jacketHem = Math.min(...worldVertices(nodeOf(avatar, "torso", 0), parts.torso).map((v) => v.y));
    expect(jacketHem, "the jacket hangs clear above the cushion").toBeGreaterThan(monkRig.cushionTop + 0.05);

    // The trouser cuff folds back with the foot: behind the knee (toward +Z, the back), not out in front of the monk.
    for (const side of [0, 1]) {
      const cuffZ = Math.max(...worldVertices(nodeOf(avatar, "trousers", side), parts.trousers).map((v) => v.z));
      expect(cuffZ, `trouser leg ${side} folds back`).toBeGreaterThan(0.1);
    }
  });

  it("makes the trouser cuff follow the foot while walking", async () => {
    const parts = await loadParts();
    const avatar = new MonkAvatar("walker", 0, false);
    avatar.setMode("walk", 0);
    for (let i = 0; i < 40; i += 1) avatar.animate(0.05, 50 * (i + 1), 3, true);
    for (const side of [0, 1]) {
      const footNode = nodeOf(avatar, "foot", side);
      const foot = new Vector3().setFromMatrixPosition(footNode.matrixWorld);
      const cuff = worldVertices(nodeOf(avatar, "trousers", side), parts.trousers).reduce((low, v) => (v.y < low.y ? v : low));
      expect(Math.hypot(cuff.x - foot.x, cuff.z - foot.z), `the cuff of leg ${side} stays above its foot`).toBeLessThan(0.08);
      expect(cuff.y, `the cuff of leg ${side} stays above the foot`).toBeGreaterThan(foot.y);
    }
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
