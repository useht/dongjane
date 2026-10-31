import { Color, Group, InstancedMesh, MeshLambertMaterial, Object3D, DynamicDrawUsage, InstancedBufferAttribute, Matrix4, Vector3 } from "three";
import { BOW_MS, ITEM_CHANT, ITEM_MOKT, ITEM_ROD, JUMP_MS, SEA_LINE_X } from "@dongjane/shared";
import rig from "../../assets/monk/monk-rig.json";
import type { MonkAssets } from "./monk-assets.ts";
import { ROD, ROD_POSE } from "./monk-items.ts";
import { PoseBlend, approach, bowDepth, hopArc } from "./pose.ts";

// The body parts come from the baked monk.glb; the held items (mokt, beads, rod) and the line and float of a fishing monk are built in monk-items.ts.
export const BODY_PART_NAMES = [
  "head",
  "face",
  "hair",
  "pelvis",
  "torso",
  "trim",
  "sleeveUpper",
  "sleeveLower",
  "hand",
  "foot",
  "leg",
  "trousers",
] as const;
export const ITEM_PART_NAMES = ["mokt", "beads", "rod", "fishLine", "bobber"] as const;
export const PART_NAMES = [...BODY_PART_NAMES, ...ITEM_PART_NAMES] as const;
export type BodyPartName = (typeof BODY_PART_NAMES)[number];
export type ItemPartName = (typeof ITEM_PART_NAMES)[number];
export type PartName = (typeof PART_NAMES)[number];

const PART_COPIES: Record<PartName, number> = {
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
  mokt: 1,
  beads: 1,
  rod: 1,
  fishLine: 1,
  bobber: 1,
};

// The jacket (torso, sleeves) and the trousers (pelvis seat, legs) take the per-monk tint; everything else keeps its own colours.
export const ROBE_PARTS: ReadonlySet<PartName> = new Set(["pelvis", "torso", "trousers", "sleeveUpper", "sleeveLower"]);

// Pivots, lengths and every kneel offset that depends on the mesh come from build_monk.py (assets/monk/monk-rig.json),
// so the model and the animation always agree. Only pose angles and walk timing live in animate().
const HIP_STAND = rig.hipStand;
const HIP_KNEEL = rig.hipKneel;
const NECK_Y = rig.neckY;
const SHOULDER_X = rig.shoulderX;
const SHOULDER_Y = rig.shoulderY;
const UPPER_ARM = rig.upperArm;
const FORE_ARM = rig.foreArm;
const FOOT_X = rig.footX;
const FOOT_Y = rig.footY;
const FOOT_FORWARD = rig.footForward;
const FOOT_KNEEL_Z = rig.footKneelZ;
const FOOT_KNEEL_Y = rig.footKneelY;
const FOOT_KNEEL_TILT = rig.footKneelTilt;
const LEG_KNEEL_LIFT = rig.legKneelLift;
const LEG_TOP_DROP = rig.legTopDrop;
const LEG_LENGTH = rig.legLength;
const KNEEL_PELVIS_GROW = rig.kneelPelvisGrow;
const KNEEL_PELVIS_SCALE_Y = rig.kneelPelvisScaleY;
const KNEEL_PELVIS_LIFT = rig.kneelPelvisLift;
const ROBE_TINT_SATURATION = rig.robeTintSaturation;
const ROBE_TINT_LIGHTNESS = rig.robeTintLightness;
// The lift of a kneeling monk on a 방석; on a 돗자리 it is less.
export const SEAT_TOP = rig.seatTop;
const HEAD_TOP_OFFSET = rig.crownY;
const EMOTE_ANCHOR_Y = rig.crownY + 0.04;
const BEAD_RING_CENTER = { y: -0.105, z: 0.01 };
const BEADS_TURN_RATE = 1;
const KNOCK_MS = 220;
const KNOCK_REDUCED_SHARE = 0.3;
const CHANT_NOD_HZ = 0.8;
const CHANT_NOD = 0.06;
const CHANT_SWAY_HZ = 0.4;
const CHANT_SWAY = 0.025;
const HOP_HEIGHT = 0.35;
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);
const UP = new Vector3(0, 1, 0);
// The float lands this far past the waterline and floats on the water's face (WATER_Y in shore.ts).
const FLOAT_PAST_SEA_LINE = 1.8;
const FLOAT_WATER_Y = 0.01;
const FLOAT_DIP = 0.055;
const CAST_FLIGHT_MS = 520;
const CAST_ARC = 0.9;
const ROD_SWAY_HZ = 0.35;
const ROD_SWAY = 0.02;
const TUG_HZ = 7;
const TUG = 0.07;
const TUG_REDUCED_SHARE = 0.3;

interface Binding {
  part: PartName;
  copy: number;
  node: Object3D;
  item?: number;
  // Shown only while the monk has a line out.
  fishing?: boolean;
}

export class MonkAvatar {
  readonly id: string;
  readonly root = new Group();
  readonly bindings: Binding[] = [];
  readonly pose = new PoseBlend();
  hue: number;
  isSelf: boolean;
  mode = "stand";
  modeSince = 0;
  slot = -1;
  chanting = false;
  item = 0;
  // A fish is on the line: the float dips and the rod pulls.
  bite = false;
  // A monk in another part of the world than the camera's is still animated but not drawn.
  hidden = false;
  // How high the seat under this monk is: a kneeling monk is lifted by it.
  seatTop = SEAT_TOP;

  private readonly hips = new Object3D();
  private readonly pelvisNode = new Object3D();
  private readonly torsoNode = new Object3D();
  private readonly headNode = new Object3D();
  private readonly shoulders: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly elbows: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly handNodes: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly beadsNode = new Object3D();
  private readonly rodNode = new Object3D();
  private readonly rodTip = new Object3D();
  private readonly lineNode = new Object3D();
  private readonly floatNode = new Object3D();
  private readonly feet: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly legs: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private phase = 0;
  private clock = 0;
  private liftedBy = 0;
  private chantMix = 0;
  private beadTurn = 0;
  private knockAt = Number.NEGATIVE_INFINITY;
  private hopStartedAt = -Infinity;
  private readonly headPoint = new Vector3();
  private readonly tipPoint = new Vector3();
  private readonly floatPoint = new Vector3();
  private readonly lineDirection = new Vector3();

  constructor(id: string, hue: number, isSelf: boolean) {
    this.id = id;
    this.hue = hue;
    this.isSelf = isSelf;

    this.root.add(this.hips, this.feet[0], this.feet[1], this.legs[0], this.legs[1]);
    this.hips.add(this.pelvisNode, this.torsoNode);
    this.torsoNode.add(this.headNode, this.shoulders[0], this.shoulders[1]);
    this.headNode.position.y = NECK_Y;
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? -1 : 1;
      const shoulder = this.shoulders[side] as Object3D;
      const elbow = this.elbows[side] as Object3D;
      const hand = this.handNodes[side] as Object3D;
      shoulder.position.set(sign * SHOULDER_X, SHOULDER_Y, 0);
      elbow.position.y = -UPPER_ARM;
      hand.position.y = -FORE_ARM;
      shoulder.add(elbow);
      elbow.add(hand);
      (this.feet[side] as Object3D).position.set(sign * FOOT_X, FOOT_Y, 0);
    }
    this.beadsNode.position.set(0, BEAD_RING_CENTER.y, BEAD_RING_CENTER.z);
    this.rodNode.position.copy(ROD.grip);
    this.rodTip.position.set(0, ROD.reach, 0);
    this.rodNode.add(this.rodTip);
    (this.handNodes[0] as Object3D).add(this.beadsNode, this.rodNode);
    this.root.add(this.lineNode, this.floatNode);

    const bind = (part: PartName, node: Object3D, copy = 0, item?: number, fishing?: boolean): void => {
      this.bindings.push({ part, copy, node, item, fishing });
    };
    bind("head", this.headNode);
    bind("face", this.headNode);
    bind("hair", this.headNode);
    bind("pelvis", this.pelvisNode);
    bind("torso", this.torsoNode);
    bind("trim", this.torsoNode);
    for (let side = 0; side < 2; side += 1) {
      bind("sleeveUpper", this.shoulders[side] as Object3D, side);
      bind("sleeveLower", this.elbows[side] as Object3D, side);
      bind("hand", this.handNodes[side] as Object3D, side);
      bind("foot", this.feet[side] as Object3D, side);
      bind("leg", this.legs[side] as Object3D, side);
      bind("trousers", this.legs[side] as Object3D, side);
    }
    bind("mokt", this.handNodes[0], 0, ITEM_MOKT);
    bind("beads", this.beadsNode, 0, ITEM_CHANT);
    bind("rod", this.rodNode, 0, ITEM_ROD);
    bind("fishLine", this.lineNode, 0, ITEM_ROD, true);
    bind("bobber", this.floatNode, 0, ITEM_ROD, true);
  }

  setMode(mode: string, nowMs: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeSince = nowMs;
  }

  knock(nowMs: number): void {
    this.knockAt = nowMs;
  }

  hop(nowMs: number): void {
    this.hopStartedAt = nowMs;
  }

  place(x: number, z: number, yaw: number): void {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = yaw;
  }

  animate(dt: number, nowMs: number, speed: number, reduceMotion: boolean): void {
    this.clock += dt;
    this.pose.update(this.mode, dt, !reduceMotion);
    const kneel = this.pose.kneel;
    const walk = this.pose.walk;
    const fish = this.pose.fish;
    const afoot = this.mode === "stand" || this.mode === "walk" || this.mode === "fish";
    this.liftedBy = approach(this.liftedBy, afoot ? 0 : this.seatTop, dt, reduceMotion ? 1000 : 10);

    if (this.mode === "walk") this.phase += dt * Math.min(speed, 3.5) * 4.4;
    const swing = Math.sin(this.phase);
    const swingBack = Math.sin(this.phase + Math.PI);
    const depth = this.mode === "bow" ? bowDepth(nowMs - this.modeSince, !reduceMotion, BOW_MS) : 0;
    const breathe = reduceMotion ? 0 : Math.sin(this.clock * 1.7);
    this.chantMix = reduceMotion ? 0 : approach(this.chantMix, this.chanting ? 1 : 0, dt, 4);
    const chant = this.chantMix * kneel;
    this.beadTurn = reduceMotion ? 0 : (this.beadTurn + dt * BEADS_TURN_RATE * chant) % (Math.PI * 2);
    this.beadsNode.rotation.z = this.beadTurn;
    const knockProgress = (nowMs - this.knockAt) / KNOCK_MS;
    const knock = knockProgress > 0 && knockProgress < 1 ? Math.sin(Math.PI * knockProgress) * (reduceMotion ? KNOCK_REDUCED_SHARE : 1) : 0;

    const hop = reduceMotion ? 0 : hopArc(nowMs - this.hopStartedAt, JUMP_MS) * HOP_HEIGHT;
    this.root.position.y = this.liftedBy * kneel + hop;
    const bob = Math.abs(swing) * 0.03 * walk;
    this.hips.position.y = HIP_STAND + (HIP_KNEEL - HIP_STAND) * kneel + bob + breathe * 0.006;
    this.hips.position.z = -depth * 0.1;

    // Kneeling, the seat of the trousers spreads over the seat while the trouser legs fold behind with the legs.
    const pelvisY = 1 + (KNEEL_PELVIS_SCALE_Y - 1) * kneel;
    const pelvisXZ = 1 + KNEEL_PELVIS_GROW * kneel;
    this.pelvisNode.scale.set(pelvisXZ, pelvisY, pelvisXZ);
    this.pelvisNode.position.y = KNEEL_PELVIS_LIFT * kneel;

    // A fish on the line pulls the rod in jerks; with reduced motion the pull is a small steady lean instead.
    const biting = this.bite && fish > 0.5;
    const tug = biting ? (reduceMotion ? TUG_REDUCED_SHARE : Math.sin(this.clock * Math.PI * 2 * TUG_HZ)) * TUG : 0;
    const rodSway = reduceMotion ? 0 : Math.sin(this.clock * Math.PI * 2 * ROD_SWAY_HZ) * ROD_SWAY;

    this.torsoNode.rotation.x = -0.05 * walk - 1.61 * depth + breathe * 0.012 + ROD_POSE.lean * fish + tug * 0.4 * fish;
    this.torsoNode.rotation.z = Math.sin(this.clock * Math.PI * 2 * CHANT_SWAY_HZ) * CHANT_SWAY * chant;
    this.headNode.rotation.x = -0.1 * depth + breathe * 0.015 + 0.03 * walk + Math.sin(this.clock * Math.PI * 2 * CHANT_NOD_HZ) * CHANT_NOD * chant;
    this.headNode.rotation.z = swing * 0.035 * walk;

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? -1 : 1;
      const shoulder = this.shoulders[side] as Object3D;
      const elbow = this.elbows[side] as Object3D;
      const armSwing = (side === 0 ? swing : swingBack) * 0.5 * walk;

      // The arm hangs straight at rest, splayed about 35 degrees out from the shoulder so the sleeve clears the wide robe; praying swings
      // it forward, yaws it inward and rolls the forearm so the palms meet under the chin; bowing lays both hands together on the seat under
      // the face (a copy of POSE in packages/client/assets/monk/build_monk.py, keep both in step).
      const idleX = 0.08 + breathe * 0.02;
      const idleZ = sign * 0.61;
      const idleElbow = 0.1;
      const prayX = 0.924;
      const prayY = sign * 0.315;
      const prayZ = -sign * 0.185;
      const prayElbow = 1.301;
      const prayTwist = -sign * 1.478;
      const bowX = 1.245;
      const bowZ = -sign * 0.187;
      const bowElbow = 0.471;

      const prayMix = kneel * (1 - depth);
      const baseX = idleX + (prayX - idleX) * kneel;
      const strike = side === 1 ? knock * prayMix : 0;
      shoulder.rotation.x = baseX + (bowX - baseX) * depth + armSwing * (1 - kneel) + strike * 0.12;
      shoulder.rotation.y = prayY * prayMix;
      shoulder.rotation.z = idleZ + (prayZ - idleZ) * prayMix + (bowZ - idleZ) * depth * kneel;
      const baseElbow = idleElbow + (prayElbow - idleElbow) * kneel;
      elbow.rotation.x = baseElbow + (bowElbow - baseElbow) * depth + Math.max(0, -armSwing) * 0.5 * (1 - kneel) - strike * 0.4;
      elbow.rotation.y = prayTwist * prayMix;

      if (fish > 0) {
        const hold = side === 0 ? ROD_POSE.lead : ROD_POSE.rear;
        shoulder.rotation.x += (hold.shoulder + (side === 0 ? rodSway + tug : 0) - shoulder.rotation.x) * fish;
        shoulder.rotation.z += (-sign * ROD_POSE.roll - shoulder.rotation.z) * fish;
        elbow.rotation.x += (hold.elbow - elbow.rotation.x) * fish;
      }

      const foot = this.feet[side] as Object3D;
      const stride = (side === 0 ? swing : swingBack) * walk;
      const lift = Math.max(0, Math.cos(this.phase + (side === 0 ? 0 : Math.PI))) * walk;
      foot.position.z = stride * 0.2 - FOOT_FORWARD * (1 - kneel) + FOOT_KNEEL_Z * kneel;
      foot.position.y = FOOT_Y + (FOOT_KNEEL_Y - FOOT_Y) * kneel + lift * 0.07;
      foot.rotation.x = kneel * FOOT_KNEEL_TILT;

      // The leg (and the trouser leg hung on it) hangs from a pivot inside the pelvis and is stretched to the ankle, so it follows
      // strides, bobbing and the folded kneel.
      const leg = this.legs[side] as Object3D;
      const topY = this.hips.position.y - LEG_TOP_DROP;
      const reachY = foot.position.y + LEG_KNEEL_LIFT * kneel - topY;
      const reachZ = foot.position.z - this.hips.position.z;
      leg.position.set(sign * FOOT_X, topY, this.hips.position.z);
      leg.rotation.x = Math.atan2(-reachZ, -reachY);
      leg.scale.y = Math.hypot(reachY, reachZ) / LEG_LENGTH;
    }

    // Fished, the rod rises toward the sea; otherwise it is carried leaning forward, and folded away while kneeling.
    this.rodNode.quaternion.slerpQuaternions(ROD.carry, ROD.aim, fish);
    this.rodNode.scale.setScalar(kneel > 0.5 ? 0 : 1);

    this.root.updateMatrixWorld(true);
    if (this.mode === "fish" && this.item === ITEM_ROD) this.castLine(nowMs, reduceMotion);
  }

  // The float flies out from the rod tip when the line is cast, then rides the water straight out toward the sea; the line is
  // stretched between the two. Both are placed in the monk's frame, so they stay right while the monk turns toward the sea.
  private castLine(nowMs: number, reduceMotion: boolean): void {
    const tip = this.rodTip.getWorldPosition(this.tipPoint);
    const flight = reduceMotion ? 1 : Math.min(1, Math.max(0, (nowMs - this.modeSince) / CAST_FLIGHT_MS));
    const dip = this.bite ? FLOAT_DIP : 0;
    const ripple = reduceMotion ? 0 : Math.sin(this.clock * (this.bite ? 31 : 2.3)) * (this.bite ? 0.012 : 0.008);
    const landed = this.floatPoint.set(SEA_LINE_X + FLOAT_PAST_SEA_LINE, FLOAT_WATER_Y - dip + ripple, this.root.position.z);
    landed.x += (tip.x - landed.x) * (1 - flight);
    landed.y += (tip.y - landed.y) * (1 - flight) + Math.sin(Math.PI * flight) * CAST_ARC;
    landed.z += (tip.z - landed.z) * (1 - flight);

    this.root.worldToLocal(tip);
    this.root.worldToLocal(landed);
    const span = this.lineDirection.copy(landed).sub(tip);
    const length = span.length();
    this.lineNode.position.copy(tip).addScaledVector(span, 0.5);
    this.lineNode.quaternion.setFromUnitVectors(UP, length > 1e-6 ? span.divideScalar(length) : UP);
    this.lineNode.scale.set(1, length, 1);
    this.floatNode.position.copy(landed);
    this.lineNode.updateMatrixWorld(true);
    this.floatNode.updateMatrixWorld(true);
  }

  headTopY(): number {
    return this.headNode.getWorldPosition(this.headPoint).y + HEAD_TOP_OFFSET;
  }

  // The world point just above the crown, following the head through kneel and bow.
  emoteAnchor(out: Vector3): Vector3 {
    return this.headNode.localToWorld(out.set(0, EMOTE_ANCHOR_Y, 0));
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

// The jacket and trousers are baked ash grey; the tint is multiplied into that grey (three.js reads the HSL as linear channel values),
// giving every monk a muted version of its hue that still reads as a grey 승복.
export function robeColor(hue: number, into: Color): Color {
  return into.setHSL((((hue % 360) + 360) % 360) / 360, ROBE_TINT_SATURATION, ROBE_TINT_LIGHTNESS);
}

export class MonkPool {
  readonly group = new Group();
  readonly capacity: number;
  private readonly meshes = new Map<PartName, InstancedMesh>();
  private readonly avatars: MonkAvatar[] = [];
  private readonly robe = new Color();
  private readonly white = new Color(1, 1, 1);

  constructor(
    private readonly host: Object3D,
    assets: MonkAssets,
    capacity = 40,
  ) {
    this.capacity = capacity;
    host.add(this.group);
    const material = new MeshLambertMaterial({ vertexColors: true });
    for (const part of PART_NAMES) {
      const size = capacity * PART_COPIES[part];
      const mesh = new InstancedMesh(assets.parts[part], material, size);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(size * 3).fill(1), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `monk-${part}`;
      this.meshes.set(part, mesh);
      this.group.add(mesh);
    }
  }

  get size(): number {
    return this.avatars.length;
  }

  add(avatar: MonkAvatar): boolean {
    if (this.avatars.length >= this.capacity) return false;
    avatar.slot = this.avatars.length;
    this.avatars.push(avatar);
    this.paint(avatar);
    this.host.add(avatar.root);
    this.updateCounts();
    return true;
  }

  remove(avatar: MonkAvatar): void {
    const index = this.avatars.indexOf(avatar);
    if (index < 0) return;
    const last = this.avatars.pop() as MonkAvatar;
    if (last !== avatar) {
      this.avatars[index] = last;
      last.slot = index;
      this.paint(last);
    }
    avatar.slot = -1;
    avatar.root.removeFromParent();
    this.updateCounts();
  }

  repaint(avatar: MonkAvatar): void {
    if (avatar.slot >= 0) this.paint(avatar);
  }

  flush(): void {
    for (const avatar of this.avatars) {
      for (const { part, copy, node, item, fishing } of avatar.bindings) {
        const mesh = this.meshes.get(part) as InstancedMesh;
        const shown = !avatar.hidden && (item === undefined || item === avatar.item) && (!fishing || avatar.mode === "fish");
        mesh.setMatrixAt(avatar.slot * PART_COPIES[part] + copy, shown ? node.matrixWorld : HIDDEN_MATRIX);
      }
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  private paint(avatar: MonkAvatar): void {
    robeColor(avatar.hue, this.robe);
    for (const { part, copy } of avatar.bindings) {
      const mesh = this.meshes.get(part) as InstancedMesh;
      mesh.setColorAt(avatar.slot * PART_COPIES[part] + copy, ROBE_PARTS.has(part) ? this.robe : this.white);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private updateCounts(): void {
    for (const [part, mesh] of this.meshes) mesh.count = this.avatars.length * PART_COPIES[part];
  }

  dispose(): void {
    for (const avatar of [...this.avatars]) this.remove(avatar);
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.group.removeFromParent();
  }
}
