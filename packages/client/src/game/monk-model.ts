import { Color, Group, InstancedMesh, MeshLambertMaterial, Object3D, DynamicDrawUsage, InstancedBufferAttribute, Vector3 } from "three";
import { BOW_MS, JUMP_MS } from "@dongjane/shared";
import rig from "../../assets/monk/monk-rig.json";
import type { MonkAssets } from "./monk-assets.ts";
import { PoseBlend, approach, bowDepth, hopArc } from "./pose.ts";

export const PART_NAMES = [
  "head",
  "face",
  "hair",
  "skirt",
  "torso",
  "trim",
  "sleeveUpper",
  "sleeveLower",
  "hand",
  "foot",
  "leg",
] as const;
export type PartName = (typeof PART_NAMES)[number];

const PART_COPIES: Record<PartName, number> = {
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

const ROBE_PARTS: ReadonlySet<PartName> = new Set(["skirt", "torso", "sleeveUpper", "sleeveLower"]);

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
const LEG_TOP_DROP = rig.legTopDrop;
const LEG_LENGTH = rig.legLength;
const KNEEL_SKIRT_GROW = rig.kneelSkirtGrow;
const KNEEL_SKIRT_SCALE_Y = rig.kneelSkirtScaleY;
const KNEEL_SKIRT_LIFT = rig.kneelSkirtLift;
const CUSHION_TOP = rig.cushionTop;
const HEAD_TOP_OFFSET = rig.crownY;
const EMOTE_ANCHOR_Y = rig.crownY + 0.04;
const HOP_HEIGHT = 0.35;

interface Binding {
  part: PartName;
  copy: number;
  node: Object3D;
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

  private readonly hips = new Object3D();
  private readonly skirtNode = new Object3D();
  private readonly torsoNode = new Object3D();
  private readonly headNode = new Object3D();
  private readonly shoulders: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly elbows: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly handNodes: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly feet: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly legs: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private phase = 0;
  private clock = 0;
  private liftedBy = 0;
  private hopStartedAt = -Infinity;
  private readonly headPoint = new Vector3();

  constructor(id: string, hue: number, isSelf: boolean) {
    this.id = id;
    this.hue = hue;
    this.isSelf = isSelf;

    this.root.add(this.hips, this.feet[0], this.feet[1], this.legs[0], this.legs[1]);
    this.hips.add(this.skirtNode, this.torsoNode);
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

    const bind = (part: PartName, node: Object3D, copy = 0): void => {
      this.bindings.push({ part, copy, node });
    };
    bind("head", this.headNode);
    bind("face", this.headNode);
    bind("hair", this.headNode);
    bind("skirt", this.skirtNode);
    bind("torso", this.torsoNode);
    bind("trim", this.torsoNode);
    for (let side = 0; side < 2; side += 1) {
      bind("sleeveUpper", this.shoulders[side] as Object3D, side);
      bind("sleeveLower", this.elbows[side] as Object3D, side);
      bind("hand", this.handNodes[side] as Object3D, side);
      bind("foot", this.feet[side] as Object3D, side);
      bind("leg", this.legs[side] as Object3D, side);
    }
  }

  setMode(mode: string, nowMs: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeSince = nowMs;
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
    this.liftedBy = approach(this.liftedBy, this.mode === "stand" || this.mode === "walk" ? 0 : CUSHION_TOP, dt, reduceMotion ? 1000 : 10);

    if (this.mode === "walk") this.phase += dt * Math.min(speed, 3.5) * 4.4;
    const swing = Math.sin(this.phase);
    const swingBack = Math.sin(this.phase + Math.PI);
    const depth = this.mode === "bow" ? bowDepth(nowMs - this.modeSince, !reduceMotion, BOW_MS) : 0;
    const breathe = reduceMotion ? 0 : Math.sin(this.clock * 1.7);

    const hop = reduceMotion ? 0 : hopArc(nowMs - this.hopStartedAt, JUMP_MS) * HOP_HEIGHT;
    this.root.position.y = this.liftedBy * kneel + hop;
    const bob = Math.abs(swing) * 0.03 * walk;
    this.hips.position.y = HIP_STAND + (HIP_KNEEL - HIP_STAND) * kneel + bob + breathe * 0.006 - depth * 0.025;
    this.hips.position.z = -depth * 0.1;

    const skirtY = 1 + (KNEEL_SKIRT_SCALE_Y - 1) * kneel;
    const skirtXZ = 1 + KNEEL_SKIRT_GROW * kneel;
    this.skirtNode.scale.set(skirtXZ, skirtY, skirtXZ);
    this.skirtNode.position.y = KNEEL_SKIRT_LIFT * kneel;

    this.torsoNode.rotation.x = -0.05 * walk - 1.32 * depth + breathe * 0.012;
    this.headNode.rotation.x = -0.5 * depth + breathe * 0.015 + 0.03 * walk;
    this.headNode.rotation.z = swing * 0.035 * walk;

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? -1 : 1;
      const shoulder = this.shoulders[side] as Object3D;
      const elbow = this.elbows[side] as Object3D;
      const armSwing = (side === 0 ? swing : swingBack) * 0.75 * walk;

      // The arm hangs straight at rest; praying swings it forward, yaws it inward and rolls the forearm so the palms meet under the chin
      // (a copy of POSE in packages/client/assets/monk/build_monk.py, keep both in step).
      const idleX = 0.08 + breathe * 0.02;
      const idleZ = 0;
      const idleElbow = 0.1;
      const prayX = 0.9;
      const prayY = sign * 0.35;
      const prayZ = -sign * 0.28;
      const prayElbow = 1.93;
      const prayTwist = -sign * 0.94;
      const bowX = 2.45;
      const bowZ = -sign * 0.32;
      const bowElbow = 0.1;

      const prayMix = kneel * (1 - depth);
      const baseX = idleX + (prayX - idleX) * kneel;
      shoulder.rotation.x = baseX + (bowX - baseX) * depth + armSwing * (1 - kneel);
      shoulder.rotation.y = prayY * prayMix;
      shoulder.rotation.z = idleZ + (prayZ - idleZ) * prayMix + (bowZ - idleZ) * depth * kneel;
      const baseElbow = idleElbow + (prayElbow - idleElbow) * kneel;
      elbow.rotation.x = baseElbow + (bowElbow - baseElbow) * depth + Math.max(0, -armSwing) * 0.5 * (1 - kneel);
      elbow.rotation.y = prayTwist * prayMix;

      const foot = this.feet[side] as Object3D;
      const stride = (side === 0 ? swing : swingBack) * walk;
      const lift = Math.max(0, Math.cos(this.phase + (side === 0 ? 0 : Math.PI))) * walk;
      foot.position.z = stride * 0.2 - FOOT_FORWARD * (1 - kneel) + FOOT_KNEEL_Z * kneel;
      foot.position.y = FOOT_Y + (FOOT_KNEEL_Y - FOOT_Y) * kneel + lift * 0.07;
      foot.rotation.x = kneel * FOOT_KNEEL_TILT;

      // The leg hangs from a pivot inside the skirt and is stretched to the ankle, so it follows strides, bobbing and the folded kneel.
      const leg = this.legs[side] as Object3D;
      const topY = this.hips.position.y - LEG_TOP_DROP;
      const reachY = foot.position.y - topY;
      const reachZ = foot.position.z - this.hips.position.z;
      leg.position.set(sign * FOOT_X, topY, this.hips.position.z);
      leg.rotation.x = Math.atan2(-reachZ, -reachY);
      leg.scale.y = Math.hypot(reachY, reachZ) / LEG_LENGTH;
    }

    this.root.updateMatrixWorld(true);
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

function robeColor(hue: number, into: Color): Color {
  return into.setHSL((((hue % 360) + 360) % 360) / 360, 0.42, 0.62);
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
      for (const { part, copy, node } of avatar.bindings) {
        const mesh = this.meshes.get(part) as InstancedMesh;
        mesh.setMatrixAt(avatar.slot * PART_COPIES[part] + copy, node.matrixWorld);
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
