import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Vector3,
} from "three";
import { BOW_MS, JUMP_MS } from "@dongjane/shared";
import { MONK_PARTS, type MonkPart } from "../assets/contract.ts";
import type { ModelMeshes } from "../assets/registry.ts";
import {
  MAT_TOP,
  FOOT_X,
  FOOT_Y,
  FORE_ARM,
  HIP_KNEEL,
  HIP_STAND,
  NECK_Y,
  PART_COPIES,
  SHOULDER_X,
  SHOULDER_Y,
  UPPER_ARM,
} from "./monk-rig.ts";
import { PoseBlend, approach, bowDepth, hopArc } from "./pose.ts";

const ROBE_PARTS: ReadonlySet<MonkPart> = new Set(["skirt", "torso", "sleeveUpper", "sleeveLower"]);

// The crown of the head above the neck pivot, and the point above it where an emoticon floats.
const HEAD_TOP_OFFSET = 0.44;
const EMOTE_ANCHOR_Y = 0.52;
const HOP_HEIGHT = 0.35;
const NOT_DRAWN = new Matrix4().makeScale(0, 0, 0);

interface Binding {
  part: MonkPart;
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
  // A monk in another part of the world than the camera's is still animated but not drawn.
  hidden = false;

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
      (this.feet[side] as Object3D).position.set(sign * FOOT_X, FOOT_Y, 0);
    }

    const bind = (part: MonkPart, node: Object3D, copy = 0): void => {
      this.bindings.push({ part, copy, node });
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
    this.liftedBy = approach(this.liftedBy, this.mode === "stand" || this.mode === "walk" ? 0 : MAT_TOP, dt, reduceMotion ? 1000 : 10);

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

    const skirtY = 1 + (0.56 - 1) * kneel;
    const skirtXZ = 1 + 0.38 * kneel;
    this.skirtNode.scale.set(skirtXZ, skirtY, skirtXZ);
    this.skirtNode.position.y = 0.01 * kneel;

    this.torsoNode.rotation.x = -0.05 * walk - 1.32 * depth + breathe * 0.012;
    this.headNode.rotation.x = -0.5 * depth + breathe * 0.015 + 0.03 * walk;
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
      shoulder.rotation.x = baseX + (bowX - baseX) * depth + armSwing * (1 - kneel);
      shoulder.rotation.z = idleZ + (prayZ - idleZ) * prayMix + (bowZ - idleZ) * depth * kneel;
      const baseElbow = idleElbow + (prayElbow - idleElbow) * kneel;
      elbow.rotation.x = baseElbow + (bowElbow - baseElbow) * depth + Math.max(0, -armSwing) * 0.5 * (1 - kneel);

      const foot = this.feet[side] as Object3D;
      const stride = (side === 0 ? swing : swingBack) * walk;
      const lift = Math.max(0, Math.cos(this.phase + (side === 0 ? 0 : Math.PI))) * walk;
      foot.position.z = stride * 0.2 + 0.2 * kneel;
      foot.position.y = FOOT_Y + lift * 0.07;
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
  private readonly meshes = new Map<MonkPart, InstancedMesh>();
  private readonly avatars: MonkAvatar[] = [];
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly robe = new Color();
  private readonly white = new Color(1, 1, 1);

  constructor(
    private readonly host: Object3D,
    parts: ModelMeshes<"monk">,
    capacity = 40,
  ) {
    this.capacity = capacity;
    host.add(this.group);
    for (const part of MONK_PARTS) {
      const size = capacity * PART_COPIES[part];
      const mesh = new InstancedMesh(parts[part].geometry, this.material, size);
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
        mesh.setMatrixAt(avatar.slot * PART_COPIES[part] + copy, avatar.hidden ? NOT_DRAWN : node.matrixWorld);
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
    this.material.dispose();
    this.group.removeFromParent();
  }
}
