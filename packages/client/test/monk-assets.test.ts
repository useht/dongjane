import { readFileSync } from "node:fs";
import { type BufferGeometry, Box3, Color, DoubleSide, type Intersection, Matrix3, Mesh, MeshBasicMaterial, type Object3D, Raycaster, SRGBColorSpace, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { BOW_MS, ITEM_ROD, SEAT_TOPS, type SeatPose } from "@dongjane/shared";
import { extractMonkParts, monkRig } from "../src/game/monk-assets.ts";
import { bendFrame, bendPoint } from "../src/game/monk-bend.ts";
import { BODY_PART_NAMES, type BodyPartName, MonkAvatar, ROBE_PARTS as MODEL_ROBE_PARTS, type PartName, robeColor } from "../src/game/monk-model.ts";
import { shownGeometry } from "./bent-geometry.ts";
import { crossingPairs, looseEdges, weld } from "./triangle-crossings.ts";

const COPIES: Record<BodyPartName, number> = {
  head: 1,
  face: 1,
  hair: 1,
  pelvis: 1,
  jacket: 1,
  trim: 1,
  sleeveUpper: 2,
  sleeveLower: 2,
  hand: 2,
  foot: 2,
  leg: 2,
  trousers: 2,
};
// The jacket (the body with its skirt, and the sleeves) and the trousers (pelvis seat, trouser legs) are the tinted garment.
const JACKET_PARTS: BodyPartName[] = ["jacket", "sleeveUpper", "sleeveLower"];
const TROUSER_PARTS: BodyPartName[] = ["pelvis", "trousers"];
const ROBE_PARTS: BodyPartName[] = [...JACKET_PARTS, ...TROUSER_PARTS];

// monk-poses.json, written by build_monk.py: world bounds [min x, y, z, max x, y, z] of one copy of each part, per probed pose.
// The right (second) copy of the arm and leg parts is probed too: a pose is right only if both sides are.
const BOW_PROBED = ["head", "pelvis", "jacket", "sleeveUpper", "sleeveLower", "hand", "foot", "trousers"] as const;
const BOW_PROBED_RIGHT = ["sleeveUpper", "sleeveLower", "hand", "foot", "trousers"] as const;
type BowProbe = { bows: number[] } & Record<(typeof BOW_PROBED)[number] | `${(typeof BOW_PROBED_RIGHT)[number]}Right`, number[][]>;
type WalkProbe = { phases: number[] } & Record<"head" | "jacket" | "sleeveUpper" | "sleeveLower" | "hand" | "foot" | "trousers", number[][]>;
type FishProbe = Record<"head" | "jacket" | "sleeveUpper" | "sleeveLower" | "hand", number[][]>;
// animate() advances the walk phase by dt * min(speed, 3.5) * 4.4 radians, so dt = phase / this puts a fresh walker at that phase.
const FASTEST_PHASE_RATE = 3.5 * 4.4;

function readGlb(): ArrayBuffer {
  const file = readFileSync(new URL("../assets/monk/monk.glb", import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

async function loadParts(): Promise<Record<BodyPartName, BufferGeometry>> {
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

// The vertices of a copy of a part as it is drawn: the jacket and its trim are bent by the shader, so they are bent here the same way.
function shownVertices(avatar: MonkAvatar, parts: Record<BodyPartName, BufferGeometry>, part: BodyPartName, copy: number): Vector3[] {
  return worldVertices(nodeOf(avatar, part, copy), shownGeometry(avatar, part, parts[part]));
}

function bowedAvatar(depth: number, seat?: { pose: SeatPose; top: number }): MonkAvatar {
  const avatar = new MonkAvatar("bower", 0, false);
  if (seat) {
    avatar.seatPose = seat.pose;
    avatar.seatTop = seat.top;
  }
  avatar.setMode("bow", 0);
  if (seat) avatar.place(0, 0, 0);
  avatar.animate(0.016, BOW_MS * 0.32 * depth, 0, true);
  return avatar;
}

// The seats a monk bows on: a cushion (kneeling), the bathhouse floor (cross-legged) and the church bench.
const BOW_SEATS = [
  { pose: "kneel", top: monkRig.seatTop },
  { pose: "cross", top: SEAT_TOPS.bathhouse },
  { pose: "bench", top: SEAT_TOPS.church },
] as const satisfies readonly { pose: SeatPose; top: number }[];

// A copy of BOW_SWEEP in build_monk.py: the back over the hip seen from the side, at every depth of the bow in steps. The outline is
// worked out in the model's own frame (y forward, z up) as that script does; three's (y up, z back) is (-z, y) of it. The rays start
// at `joint` (forward, height) in the upright jacket, which the bend carries along.
const BOW_SWEEP = {
  depths: 20,
  planes: [0, 0.07],
  joint: [0, -0.15],
  rays: [-70, 100],
  jump: 0.03,
  grid: 0.002,
  reach: [0.05, 0.08],
  dent: [0.0135, 0.013],
  span: 0.01,
  turn: 19.5,
  zone: 0.28,
} as const;
const SWEEP_PARTS = ["jacket", "pelvis"] as const;
// A point of the outline in the model's frame (y forward, z up), and the shading normal there (in three's frame: only its turns count).
type OutlinePoint = readonly [number, number, Vector3];

// The shading normal at a hit: the exported vertex normals of its triangle mixed by where the point lies in it.
function shadingNormal(mesh: Mesh, hit: Intersection): Vector3 {
  const normals = mesh.geometry.getAttribute("normal");
  const face = hit.face as NonNullable<Intersection["face"]>;
  const weights = hit.barycoord as Vector3;
  const mixed = new Vector3();
  for (const [index, weight] of [[face.a, weights.x], [face.b, weights.y], [face.c, weights.z]] as const) {
    mixed.addScaledVector(new Vector3().fromBufferAttribute(normals as never, index), weight);
  }
  return mixed.applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
}

// For one ray a degree from the hip joint, from forward over the chest round to the seat: the farthest of the parts' outer faces, and
// its shading normal.
function backOutline(meshes: Mesh[], hip: Vector3, plane: number): (OutlinePoint | null)[] {
  const raycaster = new Raycaster();
  const origin = hip.clone().add(new Vector3(plane, 0, 0));
  const outline: (OutlinePoint | null)[] = [];
  const [low, high] = BOW_SWEEP.rays;
  for (let degree = high; degree >= low; degree -= 1) {
    const out = new Vector3(0, Math.cos((degree * Math.PI) / 180), Math.sin((degree * Math.PI) / 180));
    raycaster.set(origin.clone().add(out), out.clone().negate());
    let far: Intersection | null = null;
    let shading: Vector3 | null = null;
    for (const mesh of meshes) {
      const hit = raycaster.intersectObject(mesh)[0];
      if (!hit?.face) continue;
      const normal = hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
      if (normal.dot(out) > 0 && (far === null || hit.point.distanceTo(origin) > far.point.distanceTo(origin))) {
        far = hit;
        shading = shadingNormal(mesh, hit);
      }
    }
    outline.push(far === null || shading === null ? null : [-far.point.z, far.point.y, shading]);
  }
  return outline;
}

// The outline walked in even steps along its length (the shading normal mixed along with them), and the longest step between two
// neighbouring points before that (infinite where a ray in between found nothing).
function walkOutline(outline: (OutlinePoint | null)[]): { walked: OutlinePoint[]; jump: number } {
  const hits = outline.flatMap((point, i) => (point ? [i] : []));
  const between = outline.slice(hits[0], (hits[hits.length - 1] as number) + 1);
  const run = between.filter((point): point is OutlinePoint => point !== null);
  let jump = 0;
  const walked: OutlinePoint[] = [run[0] as OutlinePoint];
  for (let i = 1; i < run.length; i += 1) {
    const before = run[i - 1] as OutlinePoint;
    const point = run[i] as OutlinePoint;
    jump = Math.max(jump, Math.hypot(point[0] - before[0], point[1] - before[1]));
    for (;;) {
      const at = walked[walked.length - 1] as OutlinePoint;
      const gap = Math.hypot(point[0] - at[0], point[1] - at[1]);
      if (gap < BOW_SWEEP.grid) break;
      const share = BOW_SWEEP.grid / gap;
      walked.push([at[0] + (point[0] - at[0]) * share, at[1] + (point[1] - at[1]) * share, at[2].clone().lerp(point[2], share)]);
    }
  }
  return { walked, jump: run.length < between.length ? Number.POSITIVE_INFINITY : jump };
}

// How far the outline lies inside the chord between the points `reach` each way along it, at its worst, seen from the hip joint (a
// bulge outward is no dent): a concave waist, a step or a crease shows here whatever its angle.
function outlineDent(walked: OutlinePoint[], joint: OutlinePoint, reach: number): number {
  const k = Math.round(reach / BOW_SWEEP.grid);
  let worst = 0;
  for (let i = k; i < walked.length - k; i += 1) {
    const a = walked[i - k] as OutlinePoint;
    const b = walked[i + k] as OutlinePoint;
    const p = walked[i] as OutlinePoint;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let ny = (b[1] - a[1]) / length;
    let nz = -(b[0] - a[0]) / length;
    if (ny * ((a[0] + b[0]) / 2 - joint[0]) + nz * ((a[1] + b[1]) / 2 - joint[1]) < 0) {
      ny = -ny;
      nz = -nz;
    }
    worst = Math.max(worst, -((p[0] - a[0]) * ny + (p[1] - a[1]) * nz));
  }
  return worst;
}

// How far the shading normal turns, in degrees, between two points of the outline BOW_SWEEP.span apart, at its worst within
// BOW_SWEEP.zone of the hip joint: the light can draw a ledge or a seam the shape has not got.
function outlineTurn(walked: OutlinePoint[], joint: OutlinePoint): number {
  const k = Math.round(BOW_SWEEP.span / BOW_SWEEP.grid);
  let worst = 0;
  for (let i = 0; i + k < walked.length; i += 1) {
    const a = walked[i] as OutlinePoint;
    const b = walked[i + k] as OutlinePoint;
    if (Math.max(Math.hypot(a[0] - joint[0], a[1] - joint[1]), Math.hypot(b[0] - joint[0], b[1] - joint[1])) <= BOW_SWEEP.zone) {
      worst = Math.max(worst, (a[2].angleTo(b[2]) * 180) / Math.PI);
    }
  }
  return worst;
}

// The worst jump, dents and shading turn of the outline in each slice at each depth of the bow, over the named parts: [depth, jump,
// ...dents, turn]. The jacket is bent the way the shader bends it, and the rays start where the bend carries the joint.
function sweepBow(geometries: Record<BodyPartName, BufferGeometry>, names: readonly BodyPartName[]): number[][] {
  const worst: number[][] = [];
  for (let step = 0; step <= BOW_SWEEP.depths; step += 1) {
    const depth = step / BOW_SWEEP.depths;
    const avatar = bowedAvatar(depth);
    const meshes = names.map((name) => {
      const mesh = new Mesh(shownGeometry(avatar, name, geometries[name]), new MeshBasicMaterial({ side: DoubleSide }));
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorld.copy(nodeOf(avatar, name, 0).matrixWorld);
      return mesh;
    });
    const [forward, height] = BOW_SWEEP.joint;
    const hip = bendPoint(new Vector3(0, height, -forward), avatar.bend.theta, avatar.bend.gather, new Vector3()).applyMatrix4(avatar.waistNode.matrixWorld);
    const row = [depth, 0, ...BOW_SWEEP.reach.map(() => 0), 0];
    const turn = row.length - 1;
    for (const plane of BOW_SWEEP.planes) {
      const { walked, jump } = walkOutline(backOutline(meshes, hip, plane));
      const joint: OutlinePoint = [-hip.z, hip.y, new Vector3()];
      row[1] = Math.max(row[1] as number, jump);
      for (const [i, reach] of BOW_SWEEP.reach.entries()) row[2 + i] = Math.max(row[2 + i] as number, outlineDent(walked, joint, reach));
      row[turn] = Math.max(row[turn] as number, outlineTurn(walked, joint));
    }
    worst.push(row);
  }
  return worst;
}

describe("monk assets", () => {
  it("contains every part the rig binds", async () => {
    const parts = await loadParts();
    for (const name of BODY_PART_NAMES) expect(parts[name], name).toBeDefined();
  });

  it("gives every part positions, normals and vertex colours", async () => {
    const parts = await loadParts();
    for (const name of BODY_PART_NAMES) {
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
    const lightness = (name: BodyPartName): number => mean(parts[name]).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).l;
    for (const name of JACKET_PARTS) expect(lightness(name), `${name} matches the jacket`).toBeCloseTo(lightness("jacket"), 3);
    for (const name of TROUSER_PARTS) expect(lightness(name), `${name} matches the trousers`).toBeCloseTo(lightness("trousers"), 3);
    expect(lightness("jacket"), "the jacket is the lighter grey").toBeGreaterThan(lightness("trousers") + 0.04);
  });

  it("gives every monk its hue as a muted tint on the grey: clearly different colours, still a grey 승복", async () => {
    const parts = await loadParts();
    const shownOf = (part: BodyPartName, hue: number): Color => {
      const color = parts[part].getAttribute("color");
      return new Color(color.getX(0), color.getY(0), color.getZ(0)).multiply(robeColor(hue, new Color()));
    };
    const hues: number[] = [];
    for (let hue = 0; hue < 360; hue += 30) hues.push(hue);
    for (const part of ["jacket", "trousers"] as const) {
      const shown = hues.map((hue) => shownOf(part, hue));
      shown.forEach((color, i) => {
        const hsl = color.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
        expect(hsl.s, `${part} saturation at hue ${hues[i]}: tinted, not grey`).toBeGreaterThan(0.08);
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
    for (const name of ["sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers", "pelvis", "jacket"] as const) {
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
    expect(bounds(parts.jacket).min.y, "the jacket hem hangs jacketDrop below the hip pivot").toBeCloseTo(-monkRig.jacketDrop, 3);
    expect(bounds(parts.pelvis).min.y, "the seat of the trousers reaches pelvisDrop below the hip pivot").toBeCloseTo(-monkRig.pelvisDrop, 3);
  });

  it("rolls the hem under, so its lower edge is a bevel the trousers below shade into and not a flat shelf", async () => {
    const parts = await loadParts();
    const box = bounds(parts.jacket);
    const position = parts.jacket.getAttribute("position");
    const edge: Vector3[] = [];
    for (let i = 0; i < position.count; i += 1) {
      const v = new Vector3().fromBufferAttribute(position, i);
      if (v.y < box.min.y + 0.002) edge.push(v);
    }
    expect(edge.length, "the hem has a lower ring").toBeGreaterThan(8);
    expect(Math.max(...edge.map((v) => v.z)), "the back of the hem tucks in from the back wall").toBeLessThan(box.max.z - 0.03);
    expect(Math.max(...edge.map((v) => Math.abs(v.x))), "the sides of the hem tuck in from the widest of the skirt").toBeLessThan(box.max.x - 0.015);
  });

  it("shades the hem's lower ring as the tucked edge it is, not as an underside, so bowing no dark rim catches the light across the thighs", async () => {
    const parts = await loadParts();
    const box = bounds(parts.jacket);
    const position = parts.jacket.getAttribute("position");
    const normal = parts.jacket.getAttribute("normal");
    const tilts: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      if (position.getY(i) > box.min.y + 0.002) continue;
      const n = new Vector3().fromBufferAttribute(normal, i);
      if (Math.hypot(n.x, n.z) > 0.1) tilts.push((Math.asin(-n.y) * 180) / Math.PI);
    }
    expect(tilts.length, "the hem's lower ring has vertices around the skirt").toBeGreaterThan(8);
    expect(Math.max(...tilts), "none faces down more steeply than a bevel").toBeLessThan(40);
  });

  it("keeps the whole monk within the triangle budget", async () => {
    const parts = await loadParts();
    let total = 0;
    for (const name of BODY_PART_NAMES) total += triangles(parts[name]) * COPIES[name];
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
      "footKneelX",
      "footKneelZ",
      "footKneelTilt",
      "footKneelYaw",
      "footOverTilt",
      "footOverLift",
      "footOverShift",
      "legKneelLift",
      "legTopDrop",
      "legKneelTopDrop",
      "legKneelTopForward",
      "legKneelTopX",
      "legKneelFlat",
      "legLength",
      "kneelPelvisGrow",
      "kneelPelvisScaleY",
      "bendLength",
      "bendForward",
      "bowLean",
      "bowHead",
      "kneelSkirtScale",
      "seatTop",
      "robeTintSaturation",
      "robeTintLightness",
    ] as const) {
      expect(monkRig[key], key).toBeGreaterThan(0);
    }
    expect(Math.abs(monkRig.footKneelY), "the folded flat foot rests with its pivot on the seat").toBeLessThan(0.01);
    expect(monkRig.kneelPelvisLift).toBeGreaterThanOrEqual(0);
    expect(monkRig.bendLength, "the bend lies inside the jacket, above its hem").toBeLessThan(monkRig.jacketDrop);
    expect(monkRig.bendForward, "the bend's axis lies inside the jacket's depth").toBeLessThan(monkRig.headHeight);
    expect(monkRig.kneelSkirtScale, "the skirt is gathered kneeling, not stretched").toBeLessThanOrEqual(1);
    expect(monkRig.robeTintSaturation).toBeLessThanOrEqual(1);
    expect(monkRig.robeTintLightness).toBeLessThanOrEqual(1);
  });

  it("keeps the rig pivots consistent with the geometry hung on them", async () => {
    const parts = await loadParts();
    const jacket = bounds(parts.jacket);
    const head = bounds(parts.head);
    const upper = bounds(parts.sleeveUpper);
    const lower = bounds(parts.sleeveLower);

    // The neck pivot is the top of the jacket's collar; the head's neck stub dips just below it into the robe.
    expect(monkRig.neckY).toBeCloseTo(monkRig.torsoHeight, 4);
    expect(jacket.max.y).toBeCloseTo(monkRig.neckY, 3);
    expect(monkRig.neckY + head.min.y).toBeLessThanOrEqual(jacket.max.y);
    expect(monkRig.neckY + head.min.y).toBeGreaterThan(jacket.max.y - 0.05);

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

  it("is 3.4 heads tall (3.4등신), laid out like the reference chibi measured on sansatemple.com (in head heights, H = crown to chin)", async () => {
    const parts = await loadParts();
    const head = bounds(parts.head);
    const foot = bounds(parts.foot);
    const crown = head.max.y;
    const chin = chinY(parts.head);
    const H = crown - chin;
    expect(H, "head height").toBeCloseTo(monkRig.headHeight, 2);
    expect(H, "head height in scene units").toBeCloseTo(0.33, 2);

    // Everything below is read off the meshes: head, neck pivot (top of the jacket), hip pivot and the sole of the foot.
    const crownWorld = monkRig.hipStand + monkRig.neckY + crown;
    const chinWorld = monkRig.hipStand + monkRig.neckY + chin;
    const soleWorld = monkRig.footY + foot.min.y;
    expect(soleWorld, "sole on the ground").toBeCloseTo(0, 2);

    expect(Math.abs((crownWorld - soleWorld) / H - 3.4), "standing height: 3.4 heads").toBeLessThanOrEqual(0.05);
    expect(Math.abs((chinWorld - soleWorld) / H - 2.4), "chin height: 2.4 heads").toBeLessThanOrEqual(0.05);
    expect(Math.abs((chinWorld - monkRig.hipStand) / H - 0.55), "chin to hip").toBeLessThanOrEqual(0.02);
    expect(Math.abs((monkRig.hipStand - soleWorld) / H - 1.85), "hip to sole").toBeLessThanOrEqual(0.02);
    expect(Math.abs((head.max.x - head.min.x) / H - 1.25), "head width incl. ears").toBeLessThanOrEqual(0.03);
    expect(Math.abs((head.max.z - head.min.z) / H - 1.15), "head depth").toBeLessThanOrEqual(0.03);
    expect((monkRig.shoulderX * 2) / H, "shoulder joints").toBeLessThan(0.7);

    // The arm: shoulder joint, elbow, wrist and fingertip, measured with the arm hanging straight down. A chibi's short arm: 1.07 head
    // heights from shoulder to fingertip, the elbow half way down, and a stubby mitt of a hand.
    const upper = -bounds(parts.sleeveUpper).min.y;
    const hand = -bounds(parts.hand).min.y;
    const shoulderWorld = monkRig.hipStand + monkRig.shoulderY;
    const elbowWorld = shoulderWorld - upper;
    const wristWorld = elbowWorld - monkRig.foreArm;
    const fingertipWorld = wristWorld - hand;
    const reach = shoulderWorld - fingertipWorld;
    expect(Math.abs((chinWorld - shoulderWorld) / H - 0.025), "chin to shoulder joint").toBeLessThanOrEqual(0.02);
    expect(Math.abs((shoulderWorld - soleWorld) / H - 2.375), "shoulder joint height").toBeLessThanOrEqual(0.02);
    expect(Math.abs((elbowWorld - soleWorld) / H - 1.835), "elbow height").toBeLessThanOrEqual(0.02);
    expect(Math.abs((wristWorld - soleWorld) / H - 1.425), "wrist height").toBeLessThanOrEqual(0.02);
    expect(Math.abs((fingertipWorld - soleWorld) / H - 1.304), "fingertip height: about 1.3 H, the fingertips of the arms hanging straight").toBeLessThanOrEqual(0.02);
    expect(Math.abs(upper / H - 0.54), "upper arm").toBeLessThanOrEqual(0.01);
    expect(Math.abs(monkRig.foreArm / H - 0.41), "forearm").toBeLessThanOrEqual(0.01);
    expect(Math.abs(hand / H - 0.12), "hand").toBeLessThanOrEqual(0.01);
    expect(Math.abs(reach / H - 1.071), "shoulder to fingertip").toBeLessThanOrEqual(0.02);
    expect(Math.abs(upper / reach - 0.504), "elbow along the arm, from the shoulder").toBeLessThanOrEqual(0.01);

    // The leg: the knee is the widest point of the trouser leg, a thigh above the ankle pivot a shin long.
    const trousers = parts.trousers.getAttribute("position");
    let kneeLocal = 0;
    let kneeWidth = -Infinity;
    for (let i = 0; i < trousers.count; i += 1) {
      if (trousers.getX(i) > kneeWidth) [kneeWidth, kneeLocal] = [trousers.getX(i), trousers.getY(i)];
    }
    const kneeWorld = monkRig.hipStand - monkRig.legTopDrop + kneeLocal;
    const ankleWorld = soleWorld + monkRig.footY;
    expect(Math.abs((kneeWorld - soleWorld) / H - 0.95), "knee height").toBeLessThanOrEqual(0.01);
    expect(Math.abs((ankleWorld - soleWorld) / H - 0.21), "ankle height").toBeLessThanOrEqual(0.01);
    expect(Math.abs((monkRig.hipStand - kneeWorld) / H - 0.9), "thigh").toBeLessThanOrEqual(0.02);
    expect(Math.abs((kneeWorld - ankleWorld) / H - 0.74), "shin").toBeLessThanOrEqual(0.02);

    // The head keeps its size; the body is 3.4 heads (1.122 standing). Kneeling, the seat of the trousers (pelvisDrop below the hip)
    // rests on the heels, which lie flat on the 방석 a heel thick (0.069) under it: the hip drops to the 방석 + hipKneel and the crown
    // to about 0.94 of the standing crown (0.99 for a seat that rested on the 방석 itself, plus the heels).
    const kneelingCrown = monkRig.seatTop + monkRig.hipKneel + monkRig.neckY + crown;
    expect(Math.abs(crownWorld - 1.122), "standing crown").toBeLessThanOrEqual(0.03);
    expect(Math.abs(kneelingCrown - (0.99 + 0.069)), "kneeling crown").toBeLessThanOrEqual(0.03);
    const seatAbove = monkRig.hipKneel - monkRig.pelvisDrop * monkRig.kneelPelvisScaleY;
    expect(seatAbove, "the buttocks rest on the heels, which lie on the 방석: the seat of the trousers is a heel thick above it").toBeGreaterThan(0.06);
    expect(seatAbove, "the buttocks rest on the heels, which lie on the 방석: the seat of the trousers is a heel thick above it").toBeLessThan(0.075);
  });

  it("dresses the 동자승 in a knee-length jacket over baggy trousers gathered above the ankle, the foot showing below the cuff", async () => {
    const parts = await loadParts();
    const H = monkRig.headHeight;
    const jacket = bounds(parts.jacket);
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

    // The jacket is a tunic ending at the knee (not a robe down to the shins), the crotch hangs lower, and the cuff is just above the ankle.
    expect(Math.abs((hem - sole) / H - 0.95), "jacket hem above the sole (0.95 H, a tunic ending at the knee, 0.9 H below the hip at 1.85 H)").toBeLessThanOrEqual(0.03);
    expect(hem, "the hem is below the hip pivot").toBeLessThan(monkRig.hipStand);
    expect(Math.abs((monkRig.hipStand - hem) / H - 0.9), "the hem hangs 0.9 H below the hip pivot (knee length)").toBeLessThanOrEqual(0.03);
    expect(crotch, "the crotch hangs below the jacket hem").toBeLessThan(hem);
    expect(Math.abs((crotch - sole) / H - 0.81), "crotch above the sole").toBeLessThanOrEqual(0.03);
    expect(Math.abs((cuff - sole) / H - 0.275), "trouser cuff above the sole").toBeLessThanOrEqual(0.01);
    expect(footTop, "the foot shows below the cuff").toBeLessThan(cuff);
    expect((cuff - footTop) / H, "the cuff clears the foot by a visible band of ankle").toBeGreaterThan(0.045);
    expect(footTop / H, "the flat foot stays below the ankle pivot (0.21 H)").toBeLessThan(0.21);

    // The leg hangs from a pivot inside the trouser leg and reaches down to the foot, so no gap shows between cuff and foot.
    const legTop = legPivot + leg.max.y;
    const legBottom = legPivot + leg.min.y;
    expect(legTop, "the leg top is hidden inside the trousers").toBeGreaterThan(cuff);
    expect(legBottom, "the leg reaches the foot").toBeLessThanOrEqual(footTop);
    expect(monkRig.legLength).toBeCloseTo(monkRig.hipStand - monkRig.legTopDrop - monkRig.footY, 3);

    // The trouser leg hangs from the same pivot and runs up through the seat, which ends where the jacket's bend begins, to a top hidden
    // inside the jacket below the hip pivot: the two join without a gap and nothing of the leg ends in the open.
    expect(legPivot + trousers.max.y, "the trouser leg reaches up into the seat").toBeGreaterThan(monkRig.hipStand + pelvis.min.y);
    expect(legPivot + trousers.max.y, "the trouser leg tops out in the jacket, under the hip pivot").toBeLessThan(monkRig.hipStand);
    expect(monkRig.hipStand + pelvis.max.y, "the seat ends where the bend begins").toBeCloseTo(monkRig.hipStand - monkRig.bendLength, 3);
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

  it("lets the arms hang straight, splayed about 35 degrees, when standing: no crease at the elbow, clear of the hips, the fingertips beside the thigh (1.5 H)", async () => {
    const parts = await loadParts();
    const H = monkRig.headHeight;
    const avatar = posedAvatar("stand");
    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;
      const shoulder = new Vector3().setFromMatrixPosition(nodeOf(avatar, "sleeveUpper", side).matrixWorld);
      const elbow = new Vector3().setFromMatrixPosition(nodeOf(avatar, "sleeveLower", side).matrixWorld);
      const wrist = new Vector3().setFromMatrixPosition(nodeOf(avatar, "hand", side).matrixWorld);
      const bend = elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow));
      expect(bend, `elbow bend of arm ${side}`).toBeLessThan(0.15);
      const lean = Math.atan2(sign * (elbow.x - shoulder.x), shoulder.y - elbow.y);
      expect(lean, `the upper arm of arm ${side} hangs away from the body, not into it`).toBeGreaterThan(0.55);
      expect(lean, `the upper arm of arm ${side} splays about 35 degrees (0.61 rad), no further`).toBeLessThan(0.67);
      expect(shoulder.distanceTo(elbow) / H, `upper arm ${side}`).toBeCloseTo(0.54, 2);
      expect(elbow.distanceTo(wrist) / H, `forearm ${side}`).toBeCloseTo(0.41, 2);
      const hand = worldVertices(nodeOf(avatar, "hand", side), parts.hand);
      const tip = Math.min(...hand.map((v) => v.y));
      expect(Math.abs(tip / H - 1.5), `fingertip height of arm ${side} (higher than the 1.3 H of an arm hanging straight down: the arm leans out and forward)`).toBeLessThanOrEqual(0.04);
      const pelvis = bounds(parts.pelvis);
      expect(Math.min(...hand.map((v) => sign * v.x)), `the hand of arm ${side} hangs outside the hip`).toBeGreaterThan(pelvis.max.x * 0.8);
    }
  });

  it("brings the praying hands together under the chin, in front of the robe", async () => {
    const parts = await loadParts();
    const chin = chinY(parts.head);
    const avatar = posedAvatar("kneel");
    const chinWorld = monkRig.seatTop + monkRig.hipKneel + monkRig.neckY + chin;
    const tips: Vector3[] = [];
    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;
      const points = worldVertices(nodeOf(avatar, "hand", side), parts.hand);
      expect(Math.max(...points.map((v) => v.y)), `hand ${side} stays below the chin`).toBeLessThan(chinWorld);
      expect(Math.max(...points.map((v) => v.y)), `hand ${side} reaches up to just under the chin`).toBeGreaterThan(chinWorld - 0.1);
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

  it("bows with the hands together on the seat in front of the face: nothing below the seat, the hands off the head", async () => {
    const parts = await loadParts();
    const avatar = new MonkAvatar("bower", 0, false);
    avatar.setMode("bow", 0);
    avatar.animate(0.016, BOW_MS * 0.45, 0, true);
    for (const part of BODY_PART_NAMES) {
      for (let copy = 0; copy < COPIES[part]; copy += 1) {
        const low = Math.min(...shownVertices(avatar, parts, part, copy).map((v) => v.y));
        expect(low, `${part} ${copy} stays on the seat in the bow`).toBeGreaterThanOrEqual(monkRig.seatTop - 0.002);
      }
    }
    const head = worldVertices(nodeOf(avatar, "head", 0), parts.head);
    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;
      const hand = worldVertices(nodeOf(avatar, "hand", side), parts.hand);
      let nearest = Infinity;
      for (const h of hand) for (const v of head) nearest = Math.min(nearest, h.distanceTo(v));
      expect(nearest, `hand ${side} keeps off the head`).toBeGreaterThan(0.01);
      expect(Math.min(...hand.map((v) => sign * v.x)), `hand ${side} does not cross the middle`).toBeGreaterThan(-0.012);
      expect(Math.min(...hand.map((v) => v.y)) - monkRig.seatTop, `hand ${side} rests on the seat`).toBeLessThan(0.05);
      expect(Math.max(...hand.map((v) => v.z)), `hand ${side} lies in front of the knees`).toBeLessThan(-0.1);
    }
  });

  it("bows exactly as build_monk.py checked it, both sides: the seat stays on the heels and the jacket is bent over the thighs while the chest folds forward", async () => {
    const parts = await loadParts();
    const probe = JSON.parse(readFileSync(new URL("../assets/monk/monk-poses.json", import.meta.url), "utf8")) as { bow: BowProbe };
    expect(probe.bow.bows, "the probe covers the whole bow").toEqual([0, 0.25, 0.5, 0.75, 1]);
    for (const [index, depth] of probe.bow.bows.entries()) {
      const avatar = bowedAvatar(depth);
      const probed: [BodyPartName, number, string][] = [
        ...BOW_PROBED.map((part): [BodyPartName, number, string] => [part, 0, part]),
        ...BOW_PROBED_RIGHT.map((part): [BodyPartName, number, string] => [part, 1, `${part}Right`]),
      ];
      for (const [part, copy, key] of probed) {
        const box = new Box3().setFromPoints(shownVertices(avatar, parts, part, copy));
        const want = (probe.bow as Record<string, number[][]>)[key]?.[index] as number[];
        const got = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
        for (const [axis, value] of got.entries()) {
          expect(Math.abs(value - (want[axis] as number)), `${key} bounds[${axis}] at bow ${depth}`).toBeLessThan(0.002);
        }
      }
    }
  });

  it("bows as one body at every depth, not only the full one: no step, gap or dent in the outline over the hip", async () => {
    const parts = await loadParts();
    const rows = sweepBow(parts, SWEEP_PARTS);
    expect(rows, "the sweep covers the whole bow").toHaveLength(BOW_SWEEP.depths + 1);
    for (const [depth, jump, ...rest] of rows) {
      const turn = rest.pop() as number;
      expect(jump, `the outline's biggest step or gap at bow ${depth}`).toBeLessThanOrEqual(BOW_SWEEP.jump);
      for (const [i, dent] of rest.entries()) {
        expect(dent, `the waist's dent over ${BOW_SWEEP.reach[i]} m at bow ${depth}`).toBeLessThanOrEqual(BOW_SWEEP.dent[i] as number);
      }
      expect(turn, `the shading's biggest turn over ${BOW_SWEEP.span * 1000} mm at bow ${depth}, a ledge or a seam in the light`).toBeLessThanOrEqual(BOW_SWEEP.turn);
    }
  });

  // The chest used to be its own mesh in a separate skirt, and four checks guarded that joint: the chest poked out of the skirt by 0.02 at
  // most, its lower edge lay 0.05 inside it at least, the skirt's top was level with the chest's back within 0.004, and the skirt spread
  // forward by 0.25 of its depth at most. The jacket is one closed surface bent by one curve now, so there is no chest edge to bury, no
  // skirt top to level and no skirt to spread; what the four guarded is held by the next four tests: the surface is closed and does not
  // pass through itself (the poke and the buried edge), its front is not folded past a limit, the back is continuous where the curve
  // hands over to the rigid chest (the step), and the forearms and hands stay out of it (the spread).
  it("bends the jacket as one closed surface that never passes through itself, on every seat at every depth of the bow", async () => {
    const parts = await loadParts();
    const mesh = weld(parts.jacket);
    expect(looseEdges(mesh), "the jacket is closed: no chest edge shows or needs burying").toBe(0);
    const position = parts.jacket.getAttribute("position");
    const bentBy = (theta: number, gather: number): Vector3[] =>
      Array.from({ length: position.count }, (_, i) => bendPoint(new Vector3().fromBufferAttribute(position as never, i), theta, gather, new Vector3()));
    for (const seat of BOW_SEATS) {
      for (let step = 0; step <= BOW_SWEEP.depths; step += 1) {
        const { theta, gather } = bowedAvatar(step / BOW_SWEEP.depths, seat).bend;
        expect(crossingPairs(mesh, bentBy(theta, gather)), `${seat.pose}: pairs of triangles that cross at bow ${step / BOW_SWEEP.depths}`).toBe(0);
      }
    }
    // The count sees a fold through itself: measured on this jacket gathered kneeling, the first pairs cross between 3.3 and 3.6 radians
    // (6 at 3.6, 74 at 4.0), twice the lean of 1.54, so the bow has that margin.
    expect(crossingPairs(mesh, bentBy(3.3, monkRig.kneelSkirtScale)), "twice the lean is still clear").toBe(0);
    expect(crossingPairs(mesh, bentBy(4.0, monkRig.kneelSkirtScale)), "a bend of 4 radians folds the front through itself").toBeGreaterThan(50);
  });

  // build_monk.py's RIG["bendFold"], the limit its bend_fold check holds the front of the bend to.
  const BEND_FOLD = 0.8;
  it("keeps the front of the bend from being squeezed past its limit: the curvature times the distance in front of the axis, standing, gathered kneeling and on the bench", async () => {
    const parts = await loadParts();
    const position = parts.jacket.getAttribute("position");
    // The fold is measured on the bend itself: how much shorter a step up the jacket, at the jacket's vertices in the bend, is once bent.
    const STEP = 1e-6;
    const squeeze = (theta: number, gather: number): { worst: number; vertices: number } => {
      const from = new Vector3();
      const to = new Vector3();
      let worst = -Infinity;
      let vertices = 0;
      for (let i = 0; i < position.count; i += 1) {
        const point = new Vector3().fromBufferAttribute(position as never, i);
        if (!(point.y * gather > -monkRig.bendLength && point.y * gather < 0)) continue;
        vertices += 1;
        bendPoint(point, theta, gather, from);
        bendPoint(point.setY(point.y + STEP), theta, gather, to);
        worst = Math.max(worst, 1 - from.distanceTo(to) / (STEP * gather));
      }
      return { worst, vertices };
    };
    const gathers = [1, ...BOW_SEATS.map((seat) => bowedAvatar(1, seat).bend.gather)];
    for (const gather of gathers) {
      const { worst, vertices } = squeeze(monkRig.bowLean, gather);
      expect(vertices, `gather ${gather}: the jacket has vertices in the bend`).toBeGreaterThan(100);
      // 0.5616 standing, 0.5689 gathered kneeling (build_monk.py prints 0.569) and 0.5852 on the bench, against 0.8.
      expect(worst, `gather ${gather}: the front of the bend is squeezed to ${(1 - worst).toFixed(3)} of its length`).toBeLessThanOrEqual(BEND_FOLD);
    }
    expect(squeeze(2 * monkRig.bowLean, monkRig.kneelSkirtScale).worst, "twice the lean squeezes the front past the limit").toBeGreaterThan(BEND_FOLD);
  });

  it("carries the back over the hinge without a step: where the curve hands over to the rigid chest the two sides meet within 0.004", async () => {
    const parts = await loadParts();
    const position = parts.jacket.getAttribute("position");
    // The old step compared the skirt's top with the back of the chest at the deepest bow and held them within 0.004; in one surface both
    // sides of the hinge are the same bend_vertex, so this takes the ring of vertices at the hinge from just below it and from just above.
    // The two samples lie 2e-6 apart and come out 3.7e-6 apart at the deepest bow: a jump of the bend there would show as millimetres.
    const ring: Vector3[] = [];
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getY(i)) < 1e-4) ring.push(new Vector3().fromBufferAttribute(position as never, i));
    }
    expect(ring.length, "the hinge is a ring of vertices").toBeGreaterThan(10);
    let worst = 0;
    for (const gather of [1, monkRig.kneelSkirtScale]) {
      for (const point of ring) {
        const below = bendPoint(point.clone().setY(-1e-6), monkRig.bowLean, gather, new Vector3());
        const above = bendPoint(point.clone().setY(1e-6), monkRig.bowLean, gather, new Vector3());
        worst = Math.max(worst, below.distanceTo(above));
      }
    }
    expect(worst, "the back of the skirt and the back of the chest meet at the hinge").toBeLessThanOrEqual(0.004);
  });

  it("keeps the hands and the forearms out of the bent jacket at every depth of the bow after the first tilt", async () => {
    const parts = await loadParts();
    const aim = new Vector3(0.31, 0.93, 0.19).normalize();
    const raycaster = new Raycaster();
    // build_monk.py's BOW_DEPTHS: the first tilt to the deepest. Before the first tilt, in prayer, the cuffs touch the chest.
    const depths = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
    for (const depth of depths) {
      const avatar = bowedAvatar(depth);
      const jacket = new Mesh(shownGeometry(avatar, "jacket", parts.jacket), new MeshBasicMaterial({ side: DoubleSide }));
      const toJacket = nodeOf(avatar, "jacket", 0).matrixWorld.clone().invert();
      const insideLocal = (point: Vector3): boolean => {
        raycaster.set(point, aim);
        return raycaster.intersectObject(jacket).length % 2 === 1;
      };
      const inside = (point: Vector3): boolean => insideLocal(point.clone().applyMatrix4(toJacket));
      expect(insideLocal(new Vector3(0, -0.08, 0)), `bow ${depth}: the middle of the skirt is inside the jacket`).toBe(true);
      expect(insideLocal(new Vector3(0, -0.08, -2)), `bow ${depth}: a point far in front of the jacket is outside it`).toBe(false);
      for (const part of ["hand", "sleeveLower"] as const) {
        for (let copy = 0; copy < COPIES[part]; copy += 1) {
          const sunk = worldVertices(nodeOf(avatar, part, copy), parts[part]).filter(inside);
          expect(sunk.length, `${part} ${copy} sinks into the bent jacket at bow ${depth}`).toBe(0);
        }
      }
    }
  });

  it("walks exactly as build_monk.py checked it: the legs hang from hips that slide against the stride, the arms swing clear", async () => {
    const parts = await loadParts();
    const probe = JSON.parse(readFileSync(new URL("../assets/monk/monk-poses.json", import.meta.url), "utf8")) as { walk: WalkProbe };
    expect(probe.walk.phases, "the probe covers the walk at the eighths of a turn").toHaveLength(8);
    for (const [index, phase] of probe.walk.phases.entries()) {
      const avatar = new MonkAvatar("walker", 0, false);
      avatar.setMode("walk", 0);
      avatar.animate(phase / FASTEST_PHASE_RATE, 1000, 3.5, true);
      for (const part of ["head", "jacket", "sleeveUpper", "sleeveLower", "hand", "foot", "trousers"] as const) {
        const box = new Box3().setFromPoints(shownVertices(avatar, parts, part, 0));
        const want = probe.walk[part][index] as number[];
        const got = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
        for (const [axis, value] of got.entries()) {
          expect(Math.abs(value - (want[axis] as number)), `${part} bounds[${axis}] at walk phase ${phase}`).toBeLessThan(0.002);
        }
      }
    }
  });

  it("holds the rod exactly as build_monk.py checked it: the lead arm up on the rod, the rear arm out to steady it, both clear of the jacket", async () => {
    const parts = await loadParts();
    const probe = JSON.parse(readFileSync(new URL("../assets/monk/monk-poses.json", import.meta.url), "utf8")) as { fish: FishProbe };
    const avatar = new MonkAvatar("angler", 0, false);
    avatar.item = ITEM_ROD;
    avatar.setMode("fish", 0);
    avatar.animate(0.016, 5000, 0, true);
    for (const part of ["head", "jacket", "sleeveUpper", "sleeveLower", "hand"] as const) {
      for (const [copy, want] of (probe.fish[part] as number[][]).entries()) {
        const box = new Box3().setFromPoints(shownVertices(avatar, parts, part, copy));
        const got = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
        for (const [axis, value] of got.entries()) {
          expect(Math.abs(value - (want[axis] as number)), `${part} ${copy} bounds[${axis}] holding the rod`).toBeLessThan(0.002);
        }
      }
    }
  });

  it("keeps the thighs and the seat of the trousers inside the jacket at every point of the walk", async () => {
    const parts = await loadParts();
    const hem = bounds(parts.jacket).min.y + 0.004;
    // The jacket is one closed mesh, and a point is inside it when a ray from it crosses its surface an odd number of times.
    const jacket = new Mesh(parts.jacket, new MeshBasicMaterial({ side: DoubleSide }));
    const aim = new Vector3(0.31, 0.93, 0.19).normalize();
    const raycaster = new Raycaster();
    for (let step = 0; step < 16; step += 1) {
      const avatar = new MonkAvatar("walker", 0, false);
      avatar.setMode("walk", 0);
      avatar.animate(((step * Math.PI) / 8) / FASTEST_PHASE_RATE, 1000, 3.5, true);
      const toJacket = nodeOf(avatar, "jacket", 0).matrixWorld.clone().invert();
      for (const part of ["pelvis", "trousers", "leg"] as const) {
        for (let copy = 0; copy < COPIES[part]; copy += 1) {
          // A point is inside a closed, convex piece of the jacket when a ray from it crosses the surface an odd number of times.
          const outside = worldVertices(nodeOf(avatar, part, copy), parts[part])
            .map((v) => v.applyMatrix4(toJacket))
            .filter((v) => v.y > hem)
            .filter((v) => {
              raycaster.set(v, aim);
              return raycaster.intersectObject(jacket).length % 2 === 0;
            });
          expect(outside.length, `${part} ${copy} pokes through the jacket at walk step ${step}`).toBe(0);
        }
      }
    }
  });

  // The trouser top is bound only below the hip pivot (0.611) because the trousers cannot be cut back: their top is the visible knee when
  // kneeling (a cut to the old 0.411 left bare leg and broke build_monk.py's knee-to-ankle and thigh-clearance checks). This is what
  // keeps them hidden instead, at every depth of the bow in the sweep's steps, bent the way the shader bends the jacket.
  it("keeps the seat and the trouser legs under the bent jacket at every depth of the bow, kneeling and cross-legged, and shows no more of them on a bench than upright", async () => {
    const parts = await loadParts();
    const aim = new Vector3(0.31, 0.93, 0.19).normalize();
    const raycaster = new Raycaster();
    for (const seat of BOW_SEATS) {
      const exposed: number[] = [];
      let covered = 0;
      for (let step = 0; step <= BOW_SWEEP.depths; step += 1) {
        const avatar = bowedAvatar(step / BOW_SWEEP.depths, seat);
        const shown = shownGeometry(avatar, "jacket", parts.jacket);
        // The hem is the lowest point of the bent jacket; the trousers are free to show HEM_LIP above it, where the hem rolls under.
        const hem = bounds(shown).min.y + 0.004;
        const jacket = new Mesh(shown, new MeshBasicMaterial({ side: DoubleSide }));
        const toJacket = nodeOf(avatar, "jacket", 0).matrixWorld.clone().invert();
        let outside = 0;
        let top = -Infinity;
        for (const part of ["pelvis", "trousers", "leg"] as const) {
          for (let copy = 0; copy < COPIES[part]; copy += 1) {
            for (const v of worldVertices(nodeOf(avatar, part, copy), parts[part]).map((w) => w.applyMatrix4(toJacket))) {
              if (part === "trousers") top = Math.max(top, v.y);
              if (v.y <= hem) continue;
              covered += 1;
              raycaster.set(v, aim);
              if (raycaster.intersectObject(jacket).length % 2 === 0) outside += 1;
            }
          }
        }
        exposed.push(outside);
        if (seat.pose === "kneel") {
          expect(-monkRig.bendLength - top, `the trousers' top lies under where the bend begins at bow ${step / BOW_SWEEP.depths}`).toBeGreaterThanOrEqual(0.06);
        }
      }
      expect(covered, `${seat.pose}: some of the seat reaches above the hem, so this measures something`).toBeGreaterThan(0);
      if (seat.pose === "bench") {
        // On the bench the thigh tops stand out of the jacket's front at every depth, upright included: the bow adds none.
        for (const [step, count] of exposed.entries()) expect(count, `${seat.pose}: vertices outside the jacket at bow ${step / BOW_SWEEP.depths}`).toBeLessThanOrEqual(exposed[0] as number);
      } else {
        expect(Math.max(...exposed), `${seat.pose}: a vertex of the seat or the legs pokes through the bent jacket`).toBe(0);
      }
    }
  }, 120_000);

  it("swings the arms in a natural arc against the same-side leg while walking", async () => {
    const parts = await loadParts();
    const avatar = new MonkAvatar("swinger", 0, false);
    avatar.setMode("walk", 0);
    const handZ: number[] = [];
    const footZ: number[] = [];
    for (let i = 0; i < 80; i += 1) {
      avatar.animate(0.05, 50 * (i + 1), 3, true);
      if (i < 40) continue;
      handZ.push(new Vector3().setFromMatrixPosition(nodeOf(avatar, "hand", 0).matrixWorld).z);
      footZ.push(new Vector3().setFromMatrixPosition(nodeOf(avatar, "foot", 0).matrixWorld).z);
    }
    const travel = Math.max(...handZ) - Math.min(...handZ);
    expect(travel, "the hand swings through a natural arc").toBeGreaterThan(0.15);
    expect(travel, "the hand swings through a natural arc").toBeLessThan(0.4);
    const meanHand = handZ.reduce((a, b) => a + b, 0) / handZ.length;
    const meanFoot = footZ.reduce((a, b) => a + b, 0) / footZ.length;
    let covariance = 0;
    for (let i = 0; i < handZ.length; i += 1) covariance += ((handZ[i] as number) - meanHand) * ((footZ[i] as number) - meanFoot);
    expect(covariance, "the arm swings forward as the same-side foot goes back").toBeLessThan(0);
    const hips = bounds(parts.pelvis);
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? -1 : 1;
      expect(Math.min(...worldVertices(nodeOf(avatar, "hand", side), parts.hand).map((v) => sign * v.x)), `hand ${side} swings outside the hip`).toBeGreaterThan(
        hips.max.x * 0.75,
      );
    }
  });

  it("draws the face with closed ^^ eyes, a small u smile and two blush ovals: no nose, no brows", async () => {
    const parts = await loadParts();
    const H = monkRig.headHeight;
    const chin = chinY(parts.head);
    const color = parts.face.getAttribute("color");
    const position = parts.face.getAttribute("position");
    const shades = new Map<string, Box3>();
    for (let i = 0; i < color.count; i += 1) {
      const shade = [color.getX(i), color.getY(i), color.getZ(i)].map((c) => c.toFixed(2)).join(",");
      const box = shades.get(shade) ?? new Box3();
      box.expandByPoint(new Vector3().fromBufferAttribute(position as never, i));
      shades.set(shade, box);
    }
    expect(shades.size, "eye, mouth and blush shades: no nose, no brows").toBe(3);

    // Narrowest to widest: the smile (0.20 H), the pair of eyes (centres 0.38 H apart, each 0.15 H wide: 0.53 H), the pair of blush ovals
    // (0.20 H long each, just outward of the eyes: 0.73 H). Each sits at its height above the chin.
    const widthOf = (box: Box3): number => (box.max.x - box.min.x) / H;
    const [mouth, eyes, blush] = [...shades.values()].sort((a, b) => widthOf(a) - widthOf(b)) as [Box3, Box3, Box3];
    const heightOf = (box: Box3): number => ((box.max.y + box.min.y) / 2 - chin) / H;
    expect(Math.abs(widthOf(mouth) - 0.2), "the smile is 0.20 H wide").toBeLessThan(0.03);
    expect(Math.abs(widthOf(eyes) - 0.53), "the eyes' outer edges are 0.53 H apart").toBeLessThan(0.03);
    expect(Math.abs(widthOf(blush) - 0.73), "the blush ovals' outer edges are 0.73 H apart").toBeLessThan(0.04);
    expect(Math.abs(heightOf(mouth) - 0.3), "the smile sits 0.30 H above the chin").toBeLessThan(0.03);
    expect(Math.abs(heightOf(eyes) - 0.62), "the eyes sit 0.62 H above the chin").toBeLessThan(0.03);
    expect(heightOf(blush), "the blush sits between the smile and the eyes").toBeGreaterThan(heightOf(mouth));
    expect(heightOf(blush), "the blush sits under the eyes").toBeLessThan(heightOf(eyes));
    expect(Math.abs(heightOf(blush) - 0.5), "the blush sits 0.50 H above the chin").toBeLessThan(0.03);
    expect(blush.max.x - blush.min.x, "the blush stays on the cheeks, within the head's width").toBeLessThan((bounds(parts.head).max.x - bounds(parts.head).min.x) * 0.75);
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

  it("keeps the jacket and trousers off the ground and clear of the seat, with the toes showing past the seat", async () => {
    const parts = await loadParts();
    const pelvis = bounds(parts.pelvis);
    const jacket = bounds(parts.jacket);
    const foot = bounds(parts.foot);

    const hemStanding = monkRig.hipStand + jacket.min.y;
    expect(hemStanding, "the hem hangs about 0.95 H (0.31 m) above the ground").toBeGreaterThan(0.28);
    expect(hemStanding, "the hem hangs about 0.95 H (0.31 m) above the ground").toBeLessThan(0.34);
    const seatKneeling = monkRig.seatTop + monkRig.hipKneel + monkRig.kneelPelvisLift + pelvis.min.y * monkRig.kneelPelvisScaleY;
    expect(seatKneeling).toBeGreaterThanOrEqual(monkRig.seatTop);
    expect(seatKneeling - monkRig.seatTop, "the kneeling seat rests on the heels, a heel thick above the 방석").toBeGreaterThan(0.06);
    expect(seatKneeling - monkRig.seatTop, "the kneeling seat rests on the heels, a heel thick above the 방석").toBeLessThan(0.075);
    const hemKneeling = monkRig.seatTop + monkRig.hipKneel + jacket.min.y * monkRig.kneelSkirtScale;
    expect(hemKneeling - monkRig.seatTop, "the jacket hem stays above the spread seat").toBeGreaterThan(0.05);

    // Kneeling, the foot is turned over behind the hip: its top rests on the seat, the toes show past the back of the seat.
    expect(monkRig.footKneelY - foot.max.y).toBeGreaterThanOrEqual(0);
    expect(monkRig.footKneelZ - foot.min.z).toBeGreaterThan(pelvis.max.z * (1 + monkRig.kneelPelvisGrow) + 0.02);
  });

  it("folds the trousers behind the knees when kneeling without sinking into the seat", async () => {
    const parts = await loadParts();
    const avatar = posedAvatar("kneel");
    const lowest = (part: BodyPartName): number => {
      let low = Infinity;
      for (let copy = 0; copy < COPIES[part]; copy += 1) {
        low = Math.min(low, ...worldVertices(nodeOf(avatar, part, copy), parts[part]).map((v) => v.y));
      }
      return low;
    };
    for (const part of ["pelvis", "trousers", "leg", "foot"] as const) {
      expect(lowest(part), `${part} rests on the seat, not in it`).toBeGreaterThanOrEqual(monkRig.seatTop - 0.002);
      expect(lowest(part) - monkRig.seatTop, `${part} sits right on the seat`).toBeLessThan(part === "pelvis" ? 0.075 : 0.03);
    }
    expect(lowest("pelvis") - monkRig.seatTop, "the buttocks rest on the heels, not on the 방석").toBeGreaterThan(0.06);
    const jacketHem = Math.min(...shownVertices(avatar, parts, "jacket", 0).map((v) => v.y));
    expect(jacketHem, "the jacket hangs clear above the seat").toBeGreaterThan(monkRig.seatTop + 0.05);

    // The trouser cuff folds back with the foot: from the knee (toward -Z, the front) back to the ankle under the seat, not out in front.
    for (const side of [0, 1]) {
      const legZ = worldVertices(nodeOf(avatar, "trousers", side), parts.trousers).map((v) => v.z);
      expect(Math.max(...legZ), `trouser leg ${side} folds back behind the hip`).toBeGreaterThan(0);
      expect(Math.max(...legZ) - Math.min(...legZ), `trouser leg ${side} runs from the knee back to the ankle`).toBeGreaterThan(0.15);
    }
  });

  it("folds the chest forward when bowing: one straight back at 85 to 90 degrees carried by the bent jacket, the hem stays put and off the seat", async () => {
    const parts = await loadParts();
    const kneeling = posedAvatar("kneel");
    const avatar = bowedAvatar(1);
    const tilt = (node: Object3D): number => {
      const up = new Vector3(0, 1, 0).transformDirection(node.matrixWorld);
      return Math.atan2(up.z, up.y);
    };
    expect(avatar.bend.theta, "the jacket is bent by the lean of the chest").toBeCloseTo(monkRig.bowLean, 5);
    expect(avatar.bend.gather, "kneeling, the jacket is gathered").toBeCloseTo(monkRig.kneelSkirtScale, 5);
    expect(Math.abs(tilt(avatar.torsoNode)), "the chest bows well over, about 88 degrees at the deepest").toBeCloseTo(monkRig.bowLean, 2);
    expect(Math.abs(tilt(avatar.torsoNode)), "the chest bows at least 85 degrees").toBeGreaterThanOrEqual((85 * Math.PI) / 180);
    expect(Math.abs(tilt(avatar.torsoNode)), "the chest bows at most 90 degrees").toBeLessThanOrEqual(Math.PI / 2);
    expect(Math.abs(tilt(avatar.waistNode)), "the jacket's own frame does not turn: only its bend does").toBeLessThan(0.01);
    expect(Math.abs(tilt(nodeOf(avatar, "pelvis", 0))), "the seat of the trousers stays level on the heels").toBeLessThan(0.01);

    // The chest, the head and the sleeves ride one frame: the bend's end, where the curve leaves the jacket's frame at its hinge.
    const hinge = bendFrame(avatar.bend.theta, new Vector3()).applyMatrix4(avatar.waistNode.matrixWorld);
    const waist = new Vector3().setFromMatrixPosition(avatar.torsoNode.matrixWorld);
    expect(waist.distanceTo(hinge), "the chest sits where the bend ends").toBeLessThan(1e-5);
    // The bend turns the waist about the centre of its curve, bendLength under the pivot, on a circle through the pivot: the pivot sits
    // bendForward behind the curve's axis, so the circle's radius is the curve's own, bendLength / lean, plus that. At the full lean of
    // 1.54 the radius is 0.2299, and the waist has swung radius * (1 - cos lean) = 0.2228 forward and risen radius * sin lean - bendLength
    // = 0.0298 (the old pivot a hip joint under the waist let it fall a little instead: the bend's circle is wider than the bend is long).
    const waistKneeling = new Vector3().setFromMatrixPosition(kneeling.torsoNode.matrixWorld);
    const radius = monkRig.bendLength / monkRig.bowLean + monkRig.bendForward;
    expect(waistKneeling.z - waist.z, "the waist swings forward over the thighs about the bend").toBeCloseTo(radius * (1 - Math.cos(monkRig.bowLean)), 7);
    expect(waist.y - waistKneeling.y, "and a little up").toBeCloseTo(radius * Math.sin(monkRig.bowLean) - monkRig.bendLength, 7);

    const hem = Math.min(...shownVertices(avatar, parts, "jacket", 0).map((v) => v.y));
    const hemKneeling = Math.min(...shownVertices(kneeling, parts, "jacket", 0).map((v) => v.y));
    expect(hem - monkRig.seatTop, "the hem of the bowing jacket stays off the seat").toBeGreaterThanOrEqual(-0.0005);
    expect(Math.abs(hem - hemKneeling), "the hem stays where it hung kneeling, on the thighs").toBeLessThan(0.002);
    const rearOf = (a: MonkAvatar): number => Math.max(...shownVertices(a, parts, "jacket", 0).filter((v) => v.y < hem + 0.02).map((v) => v.z));
    expect(rearOf(avatar), "the back of the hem does not move when bowing").toBeCloseTo(rearOf(kneeling), 3);
  });

  it("leaves the seat of the trousers where it sat kneeling when bowing: neither squashed nor lifted", async () => {
    const parts = await loadParts();
    const kneeling = posedAvatar("kneel");
    const avatar = bowedAvatar(1);
    const corners = (a: MonkAvatar): number[] => {
      const box = new Box3().setFromPoints(shownVertices(a, parts, "pelvis", 0));
      return [...box.min.toArray(), ...box.max.toArray()];
    };
    const want = corners(kneeling);
    for (const [axis, value] of corners(avatar).entries()) expect(value, `bounds[${axis}] of the seat`).toBeCloseTo(want[axis] as number, 4);
    expect((want[1] as number) - monkRig.seatTop, "the buttocks stay a heel thick above the 방석").toBeGreaterThan(0.06);
  });

  it("folds the kneeling leg under the body: a thigh in front, a knee, a flattened shin back to the foot, and the foot lying under the seat", async () => {
    const parts = await loadParts();
    const avatar = posedAvatar("kneel");
    for (const side of [0, 1]) {
      const leg = nodeOf(avatar, "leg", side);
      const top = new Vector3().setFromMatrixPosition(leg.matrixWorld);
      const foot = new Vector3().setFromMatrixPosition(nodeOf(avatar, "foot", side).matrixWorld);
      const toes = worldVertices(nodeOf(avatar, "foot", side), parts.foot);
      expect(top.z, `the thigh of leg ${side} starts in front of the hip`).toBeLessThan(-0.05);
      expect(Math.abs(foot.z), `the heel of foot ${side} lies under the seat, not out behind it`).toBeLessThan(0.08);
      expect(Math.max(...toes.map((v) => v.z)), `the toes of foot ${side} point back past the seat`).toBeGreaterThan(0.1);
      expect(top.y - monkRig.seatTop, `the thigh of leg ${side} lies low over the seat`).toBeLessThan(0.12);
      const worldZ = worldVertices(nodeOf(avatar, "trousers", side), parts.trousers).map((v) => v.z);
      expect(Math.min(...worldZ), `the knee of leg ${side} reaches in front of the hip`).toBeLessThan(-0.1);
      expect(leg.scale.z, `the shin of leg ${side} is flattened`).toBeCloseTo(monkRig.legKneelFlat, 3);
      const hem = Math.min(...shownVertices(avatar, parts, "jacket", 0).map((v) => v.y));
      expect(Math.max(...toes.map((v) => v.y)), `foot ${side} lies under the hem of the jacket`).toBeLessThan(hem);
    }
  });

  it("sits in the 정좌: buttocks on the heels, insteps flat on the 방석, the toes back and crossed right over left, the knees a hand-span apart", async () => {
    const parts = await loadParts();
    const avatar = posedAvatar("kneel");
    const H = monkRig.headHeight;
    const feet = [0, 1].map((side) => worldVertices(nodeOf(avatar, "foot", side), parts.foot));
    const lowest = feet.map((points) => Math.min(...points.map((v) => v.y)) - monkRig.seatTop);
    for (const [side, low] of lowest.entries()) {
      expect(low, `the instep of foot ${side} does not sink into the 방석`).toBeGreaterThanOrEqual(-0.0005);
      expect(low, `the instep of foot ${side} lies flat on the 방석`).toBeLessThan(0.004);
    }
    expect(lowest[1] as number, "the right foot lies over the left").toBeGreaterThan(lowest[0] as number);
    expect(Math.max(...(feet[1] as Vector3[]).map((v) => v.y)), "the right foot's toes ride up over the left").toBeGreaterThan(Math.max(...(feet[0] as Vector3[]).map((v) => v.y)));

    // The toes point back and in: the big toes overlap past the middle, each toe tip further in than its heel.
    const tips = feet.map((points) => points.reduce((back, v) => (v.z > back.z ? v : back)));
    const heels = feet.map((points) => points.reduce((front, v) => (v.z < front.z ? v : front)));
    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;
      const tip = tips[side] as Vector3;
      const heel = heels[side] as Vector3;
      expect(tip.z - heel.z, `the toes of foot ${side} lie well behind its heel`).toBeGreaterThan(0.12);
      expect(sign * tip.x, `the toes of foot ${side} point in toward the middle`).toBeLessThan(sign * heel.x - 0.05);
    }
    const leftIn = Math.max(...(feet[0] as Vector3[]).map((v) => v.x));
    const rightIn = Math.min(...(feet[1] as Vector3[]).map((v) => v.x));
    expect(leftIn - rightIn, "the big toes overlap").toBeGreaterThan(0.01);
    expect(leftIn - rightIn, "the big toes overlap by a toe, not a foot").toBeLessThan(0.04);
    expect(Math.abs((heels[1] as Vector3).x - (heels[0] as Vector3).x), "the heels are apart, the buttocks between them").toBeGreaterThan(0.04);

    // The buttocks (the seat of the trousers) rest on the heels, not on the 방석, and the back is straight up from them.
    const pelvis = worldVertices(nodeOf(avatar, "pelvis", 0), parts.pelvis);
    expect(Math.min(...pelvis.map((v) => v.y)) - monkRig.seatTop, "the buttocks sit a heel thick above the 방석").toBeGreaterThan(0.06);
    const up = new Vector3(0, 1, 0).transformDirection(avatar.torsoNode.matrixWorld);
    expect(Math.abs(up.z), "the back is straight, no lean").toBeLessThan(0.01);
    expect(Math.abs(new Vector3().setFromMatrixPosition(nodeOf(avatar, "head", 0).matrixWorld).z), "the head sits over the seat").toBeLessThan(0.01);

    // The knees are about a hand-span apart (0.2 m, 0.6 H), neither pressed together nor wide.
    const kneeInner = [0, 1].map((side) => {
      const leg = worldVertices(nodeOf(avatar, "trousers", side), parts.trousers);
      const front = Math.min(...leg.map((v) => v.z));
      return Math.min(...leg.filter((v) => v.z < front + 0.015).map((v) => (side === 0 ? -v.x : v.x)));
    });
    const kneeGap = (kneeInner[0] as number) + (kneeInner[1] as number);
    expect(kneeGap, "the knees are about 0.2 m apart").toBeGreaterThan(0.18);
    expect(kneeGap, "the knees are about 0.2 m apart").toBeLessThan(0.24);
    expect(kneeGap / H, "the knees are about 0.6 H apart").toBeGreaterThan(0.55);
    expect(kneeGap / H, "the knees are about 0.6 H apart").toBeLessThan(0.7);
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
