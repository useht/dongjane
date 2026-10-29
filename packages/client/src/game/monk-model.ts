import {
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  Vector3,
} from "three";
import { BOW_MS, ITEM_CHANT, ITEM_MOKT, JUMP_MS } from "@dongjane/shared";
import { GeometryBuilder } from "./geometry.ts";
import { PoseBlend, approach, bowDepth, hopArc } from "./pose.ts";

export const PART_NAMES = [
  "head",
  "face",
  "skirt",
  "torso",
  "trim",
  "sleeveUpper",
  "sleeveLower",
  "hand",
  "foot",
  "mokt",
  "beads",
] as const;
export type PartName = (typeof PART_NAMES)[number];

const PART_COPIES: Record<PartName, number> = {
  head: 1,
  face: 1,
  skirt: 1,
  torso: 1,
  trim: 1,
  sleeveUpper: 2,
  sleeveLower: 2,
  hand: 2,
  foot: 2,
  mokt: 1,
  beads: 1,
};

const ROBE_PARTS: ReadonlySet<PartName> = new Set(["skirt", "torso", "sleeveUpper", "sleeveLower"]);

const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);

const SKIN = 0xf3cba2;
const WOOD = 0xb8793b;
const WOOD_DARK = 0x3a2112;
const BEAD = 0x6b3f26;
const BEAD_MARK = 0xc99a3a;
const BEAD_COUNT = 11;
const WHITE = 0xffffff;

const HIP_STAND = 0.4;
const HIP_KNEEL = 0.2;
const SKIRT_DROP = 0.36;
const TORSO_HEIGHT = 0.38;
const NECK_Y = TORSO_HEIGHT;
const HEAD_CENTER_Y = 0.22;
const HEAD_RADIUS = 0.19;
const HEAD_TOP_OFFSET = HEAD_CENTER_Y + HEAD_RADIUS;
const SHOULDER_X = 0.165;
const SHOULDER_Y = 0.33;
const UPPER_ARM = 0.18;
const FORE_ARM = 0.16;
const CUSHION_TOP = 0.13;
const EMOTE_ANCHOR_Y = 0.45;
const KNOCK_MS = 220;
const KNOCK_REDUCED_SHARE = 0.3;
const CHANT_NOD_HZ = 0.8;
const CHANT_NOD = 0.06;
const CHANT_SWAY_HZ = 0.4;
const CHANT_SWAY = 0.025;
const HOP_HEIGHT = 0.35;

function buildPartGeometries(): Record<PartName, BufferGeometry> {
  const head = new GeometryBuilder()
    .add(new SphereGeometry(HEAD_RADIUS, 22, 16), SKIN, { y: HEAD_CENTER_Y })
    .add(new SphereGeometry(0.052, 10, 8), SKIN, { x: -0.186, y: 0.22, sx: 0.55, sy: 1.15 })
    .add(new SphereGeometry(0.052, 10, 8), SKIN, { x: 0.186, y: 0.22, sx: 0.55, sy: 1.15 })
    .add(new CylinderGeometry(0.06, 0.07, 0.1, 10), SKIN, { y: 0.02 })
    .build();

  const face = new GeometryBuilder()
    .add(new SphereGeometry(0.024, 8, 6), 0x2b1a12, { x: -0.066, y: 0.245, z: -0.172, sy: 1.25 })
    .add(new SphereGeometry(0.024, 8, 6), 0x2b1a12, { x: 0.066, y: 0.245, z: -0.172, sy: 1.25 })
    .add(new SphereGeometry(0.04, 8, 6), 0xf0948a, { x: -0.108, y: 0.172, z: -0.15, sz: 0.3 })
    .add(new SphereGeometry(0.04, 8, 6), 0xf0948a, { x: 0.108, y: 0.172, z: -0.15, sz: 0.3 })
    .add(new TorusGeometry(0.03, 0.0065, 5, 10, Math.PI), 0x9a4a3c, { y: 0.158, z: -0.178, rz: Math.PI })
    .add(new SphereGeometry(0.009, 5, 4), 0x6a3a2a, { x: -0.03, y: 0.405, z: -0.01 })
    .add(new SphereGeometry(0.009, 5, 4), 0x6a3a2a, { x: 0.03, y: 0.405, z: -0.01 })
    .add(new SphereGeometry(0.009, 5, 4), 0x6a3a2a, { y: 0.408, z: 0.03 })
    .build();

  const skirt = new GeometryBuilder()
    .add(new CylinderGeometry(0.17, 0.27, SKIRT_DROP, 22, 1), WHITE, { y: -SKIRT_DROP / 2 })
    .build();

  const torso = new GeometryBuilder()
    .add(new CylinderGeometry(0.15, 0.19, TORSO_HEIGHT, 20, 1), WHITE, { y: TORSO_HEIGHT / 2 })
    .add(new SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), WHITE, { y: TORSO_HEIGHT - 0.01, sy: 0.35 })
    .build();

  const trim = new GeometryBuilder()
    .add(new TorusGeometry(0.19, 0.024, 8, 24), 0xc99a3a, { y: 0.03, rx: Math.PI / 2 })
    .add(new BoxGeometry(0.17, 0.024, 0.012), 0xf6ecd2, { x: -0.045, y: 0.28, z: -0.154, rz: 0.78 })
    .add(new BoxGeometry(0.17, 0.024, 0.012), 0xf6ecd2, { x: 0.045, y: 0.28, z: -0.154, rz: -0.78 })
    .build();

  const sleeveUpper = new GeometryBuilder()
    .add(new CylinderGeometry(0.07, 0.085, UPPER_ARM, 12, 1), WHITE, { y: -UPPER_ARM / 2 })
    .add(new SphereGeometry(0.07, 10, 8), WHITE)
    .build();

  const sleeveLower = new GeometryBuilder()
    .add(new CylinderGeometry(0.085, 0.108, FORE_ARM + 0.01, 12, 1), WHITE, { y: -FORE_ARM / 2 })
    .build();

  const hand = new GeometryBuilder().add(new SphereGeometry(0.046, 10, 8), SKIN, { y: -0.01 }).build();

  const foot = new GeometryBuilder()
    .add(new CapsuleGeometry(0.05, 0.1, 4, 8), 0xf4eee0, { rx: Math.PI / 2, sy: 1, sz: 0.8, z: -0.03 })
    .build();

  const mokt = new GeometryBuilder()
    .add(new SphereGeometry(0.064, 14, 10), WOOD, { y: -0.078, sx: 1, sy: 0.82, sz: 1.12 })
    .add(new BoxGeometry(0.09, 0.012, 0.014), WOOD_DARK, { y: -0.07, z: 0.068 })
    .add(new BoxGeometry(0.09, 0.012, 0.014), WOOD_DARK, { y: -0.07, z: -0.068 })
    .add(new CylinderGeometry(0.011, 0.014, 0.05, 6), WOOD, { y: -0.012, z: 0.02, rx: 0.4 })
    .build();

  const beadRing = new GeometryBuilder();
  for (let i = 0; i < BEAD_COUNT; i += 1) {
    const angle = (i / BEAD_COUNT) * Math.PI * 2;
    beadRing.add(new SphereGeometry(i === 0 ? 0.024 : 0.018, 7, 5), i === 0 ? BEAD_MARK : BEAD, {
      x: Math.cos(angle) * 0.055,
      y: -0.105 + Math.sin(angle) * 0.055,
      z: 0.01,
    });
  }
  const beads = beadRing.build();

  return { head, face, skirt, torso, trim, sleeveUpper, sleeveLower, hand, foot, mokt, beads };
}

interface Binding {
  part: PartName;
  copy: number;
  node: Object3D;
  item?: number;
}

let sharedGeometries: Record<PartName, BufferGeometry> | null = null;

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

  private readonly hips = new Object3D();
  private readonly skirtNode = new Object3D();
  private readonly torsoNode = new Object3D();
  private readonly headNode = new Object3D();
  private readonly shoulders: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly elbows: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly handNodes: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private readonly feet: [Object3D, Object3D] = [new Object3D(), new Object3D()];
  private phase = 0;
  private clock = 0;
  private liftedBy = 0;
  private chantMix = 0;
  private knockAt = Number.NEGATIVE_INFINITY;
  private hopStartedAt = -Infinity;
  private readonly headPoint = new Vector3();

  constructor(id: string, hue: number, isSelf: boolean) {
    this.id = id;
    this.hue = hue;
    this.isSelf = isSelf;

    this.root.add(this.hips, this.feet[0], this.feet[1]);
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
      (this.feet[side] as Object3D).position.set(sign * 0.085, 0.045, 0);
    }

    const bind = (part: PartName, node: Object3D, copy = 0, item?: number): void => {
      this.bindings.push({ part, copy, node, item });
    };
    bind("head", this.headNode);
    bind("face", this.headNode);
    bind("skirt", this.skirtNode);
    bind("torso", this.torsoNode);
    bind("trim", this.torsoNode);
    for (let side = 0; side < 2; side += 1) {
      bind("sleeveUpper", this.shoulders[side] as Object3D, side);
      bind("sleeveLower", this.elbows[side] as Object3D, side);
      bind("hand", this.handNodes[side] as Object3D, side);
      bind("foot", this.feet[side] as Object3D, side);
    }
    bind("mokt", this.handNodes[0], 0, ITEM_MOKT);
    bind("beads", this.handNodes[0], 0, ITEM_CHANT);
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
    this.liftedBy = approach(this.liftedBy, this.mode === "stand" || this.mode === "walk" ? 0 : CUSHION_TOP, dt, reduceMotion ? 1000 : 10);

    if (this.mode === "walk") this.phase += dt * Math.min(speed, 3.5) * 4.4;
    const swing = Math.sin(this.phase);
    const swingBack = Math.sin(this.phase + Math.PI);
    const depth = this.mode === "bow" ? bowDepth(nowMs - this.modeSince, !reduceMotion, BOW_MS) : 0;
    const breathe = reduceMotion ? 0 : Math.sin(this.clock * 1.7);
    this.chantMix = reduceMotion ? 0 : approach(this.chantMix, this.chanting ? 1 : 0, dt, 4);
    const chant = this.chantMix * kneel;
    const knockProgress = (nowMs - this.knockAt) / KNOCK_MS;
    const knock = knockProgress > 0 && knockProgress < 1 ? Math.sin(Math.PI * knockProgress) * (reduceMotion ? KNOCK_REDUCED_SHARE : 1) : 0;

    const hop = reduceMotion ? 0 : hopArc(nowMs - this.hopStartedAt, JUMP_MS) * HOP_HEIGHT;
    this.root.position.y = this.liftedBy * kneel + hop;
    const bob = Math.abs(swing) * 0.03 * walk;
    this.hips.position.y = HIP_STAND + (HIP_KNEEL - HIP_STAND) * kneel + bob + breathe * 0.006 - depth * 0.025;
    this.hips.position.z = -depth * 0.1;

    const skirtY = 1 + (0.56 - 1) * kneel;
    const skirtXZ = 1 + 0.38 * kneel;
    this.skirtNode.scale.set(skirtXZ, skirtY, skirtXZ);
    this.skirtNode.position.y = 0.01 * kneel;

    this.torsoNode.rotation.x = -0.05 * walk - 1.32 * depth + breathe * 0.012;
    this.torsoNode.rotation.z = Math.sin(this.clock * Math.PI * 2 * CHANT_SWAY_HZ) * CHANT_SWAY * chant;
    this.headNode.rotation.x = -0.5 * depth + breathe * 0.015 + 0.03 * walk + Math.sin(this.clock * Math.PI * 2 * CHANT_NOD_HZ) * CHANT_NOD * chant;
    this.headNode.rotation.z = swing * 0.035 * walk;

    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? -1 : 1;
      const shoulder = this.shoulders[side] as Object3D;
      const elbow = this.elbows[side] as Object3D;
      const armSwing = (side === 0 ? swing : swingBack) * 0.75 * walk;

      const idleX = 0.1 + breathe * 0.02;
      const idleZ = -sign * 0.12;
      const idleElbow = 0.22;
      const prayX = 0.62;
      const prayZ = -sign * 0.5;
      const prayElbow = 1.95;
      const bowX = 2.45;
      const bowZ = -sign * 0.32;
      const bowElbow = 0.1;

      const prayMix = kneel * (1 - depth);
      const baseX = idleX + (prayX - idleX) * kneel;
      const strike = side === 1 ? knock * prayMix : 0;
      shoulder.rotation.x = baseX + (bowX - baseX) * depth + armSwing * (1 - kneel) + strike * 0.12;
      shoulder.rotation.z = idleZ + (prayZ - idleZ) * prayMix + (bowZ - idleZ) * depth * kneel;
      const baseElbow = idleElbow + (prayElbow - idleElbow) * kneel;
      elbow.rotation.x = baseElbow + (bowElbow - baseElbow) * depth + Math.max(0, -armSwing) * 0.5 * (1 - kneel) - strike * 0.55;

      const foot = this.feet[side] as Object3D;
      const stride = (side === 0 ? swing : swingBack) * walk;
      const lift = Math.max(0, Math.cos(this.phase + (side === 0 ? 0 : Math.PI))) * walk;
      foot.position.z = stride * 0.2 + 0.2 * kneel;
      foot.position.y = 0.045 + lift * 0.07;
      foot.rotation.x = kneel * 0.5;
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

  constructor(private readonly host: Object3D, capacity = 40) {
    this.capacity = capacity;
    host.add(this.group);
    sharedGeometries ??= buildPartGeometries();
    const material = new MeshLambertMaterial({ vertexColors: true });
    for (const part of PART_NAMES) {
      const size = capacity * PART_COPIES[part];
      const mesh = new InstancedMesh(sharedGeometries[part], material, size);
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
      for (const { part, copy, node, item } of avatar.bindings) {
        const mesh = this.meshes.get(part) as InstancedMesh;
        const held = item === undefined || item === avatar.item;
        mesh.setMatrixAt(avatar.slot * PART_COPIES[part] + copy, held ? node.matrixWorld : HIDDEN_MATRIX);
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
