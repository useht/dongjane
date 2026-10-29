import { WALK_SPEED, resolveWalkable, yawFromDirection } from "@dongjane/shared";

export const KEY_MOVE_INTERVAL_MS = 100;
export const KEY_MOVE_REACH = 1.6;
export const PATH_TOLERANCE = 1;
export const SETTLE_TIMEOUT_MS = 6000;

const HISTORY_MS = 4000;
const ARRIVED_DISTANCE = 0.15;
const GLIDE_DONE_DISTANCE = 0.05;
const TURN_RESEND_COS = Math.cos(0.35);
const MOVED_EPSILON = 1e-4;

export interface Point {
  x: number;
  z: number;
}

export interface ServerSelf extends Point {
  mode: string;
}

export interface SelfDisplay extends Point {
  yaw: number;
  walking: boolean;
}

interface TrailPoint extends Point {
  t: number;
}

type Phase = "idle" | "held" | "settling" | "easing";

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSquared = abx * abx + abz * abz;
  const k = lengthSquared > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + abx * k), p.z - (a.z + abz * k));
}

// Keyboard walking runs ahead of the server: the monk moves the instant a key goes down and the server only has to follow.
export class SelfPrediction {
  private phase: Phase = "idle";
  private x = 0;
  private z = 0;
  private yaw = 0;
  private walking = false;
  private releasedAt = 0;
  private lastSentAt = 0;
  private sentDir: Point | null = null;
  private trail: TrailPoint[] = [];
  private serverX = 0;
  private serverZ = 0;

  get active(): boolean {
    return this.phase !== "idle";
  }

  display(): SelfDisplay | null {
    return this.phase === "idle" ? null : { x: this.x, z: this.z, yaw: this.yaw, walking: this.walking };
  }

  // Advances the predicted point by one frame; returns a move target when one should be sent to the server.
  frame(dtSeconds: number, nowMs: number, dir: Point | null, displayed: Point): Point | null {
    const length = dir ? Math.hypot(dir.x, dir.z) : 0;
    if (!dir || length < 1e-6) {
      if (this.phase === "easing") this.glide(dtSeconds);
      return this.phase === "held" ? this.release(nowMs) : null;
    }

    const ux = dir.x / length;
    const uz = dir.z / length;
    if (this.phase === "idle") {
      this.x = displayed.x;
      this.z = displayed.z;
    }
    if (this.phase === "idle" || this.phase === "easing") this.trail = [{ t: nowMs, x: this.x, z: this.z }];
    if (this.phase !== "held") this.sentDir = null;
    this.phase = "held";

    const step = WALK_SPEED * dtSeconds;
    const next = resolveWalkable(this.x + ux * step, this.z + uz * step);
    this.walking = Math.hypot(next.x - this.x, next.z - this.z) > MOVED_EPSILON;
    this.x = next.x;
    this.z = next.z;
    this.yaw = yawFromDirection(ux, uz);
    this.trail.push({ t: nowMs, x: this.x, z: this.z });
    this.prune(nowMs);

    const sent = this.sentDir;
    const turned = sent === null || ux * sent.x + uz * sent.z < TURN_RESEND_COS;
    if (!turned && nowMs - this.lastSentAt < KEY_MOVE_INTERVAL_MS) return null;
    this.sentDir = { x: ux, z: uz };
    this.lastSentAt = nowMs;
    return resolveWalkable(this.x + ux * KEY_MOVE_REACH, this.z + uz * KEY_MOVE_REACH);
  }

  // The server reports where it was one round trip ago, so it only counts as desynced when it is off our whole recent path.
  reconcile(server: ServerSelf, nowMs: number): void {
    if (this.phase === "idle") return;
    this.serverX = server.x;
    this.serverZ = server.z;
    if (this.phase === "easing") return;

    this.prune(nowMs);
    if (this.offTrail(server)) {
      this.x = server.x;
      this.z = server.z;
      this.trail = [{ t: nowMs, x: server.x, z: server.z }];
      if (this.phase === "settling") this.phase = "idle";
      return;
    }
    if (this.phase !== "settling") return;

    if (server.mode !== "walk" && Math.hypot(server.x - this.x, server.z - this.z) <= ARRIVED_DISTANCE) {
      this.phase = "idle";
    } else if (nowMs - this.releasedAt >= SETTLE_TIMEOUT_MS) {
      this.phase = "easing";
    }
  }

  cancel(): void {
    this.phase = "idle";
    this.walking = false;
    this.sentDir = null;
    this.trail = [];
  }

  private release(nowMs: number): Point {
    this.phase = "settling";
    this.releasedAt = nowMs;
    this.walking = false;
    this.sentDir = null;
    return { x: this.x, z: this.z };
  }

  // Safety-net handover: walk to the server's point at normal speed instead of teleporting there.
  private glide(dtSeconds: number): void {
    const dx = this.serverX - this.x;
    const dz = this.serverZ - this.z;
    const gap = Math.hypot(dx, dz);
    const step = WALK_SPEED * dtSeconds;
    if (gap <= Math.max(step, GLIDE_DONE_DISTANCE)) {
      this.x = this.serverX;
      this.z = this.serverZ;
      this.walking = false;
      this.phase = "idle";
      return;
    }
    this.x += (dx / gap) * step;
    this.z += (dz / gap) * step;
    this.yaw = yawFromDirection(dx / gap, dz / gap);
    this.walking = true;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - HISTORY_MS;
    let drop = 0;
    while (drop < this.trail.length - 1 && (this.trail[drop + 1] as TrailPoint).t < cutoff) drop += 1;
    if (drop > 0) this.trail.splice(0, drop);
  }

  private offTrail(p: Point): boolean {
    const trail = this.trail;
    const first = trail[0];
    if (!first) return Math.hypot(p.x - this.x, p.z - this.z) > PATH_TOLERANCE;
    if (Math.hypot(p.x - first.x, p.z - first.z) <= PATH_TOLERANCE) return false;
    for (let i = 1; i < trail.length; i += 1) {
      if (distanceToSegment(p, trail[i - 1] as TrailPoint, trail[i] as TrailPoint) <= PATH_TOLERANCE) return false;
    }
    return true;
  }
}
