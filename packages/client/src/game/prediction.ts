import { WALK_SPEED, type Zone, resolveWalkable, yawFromDirection } from "@dongjane/shared";

export const KEY_MOVE_INTERVAL_MS = 100;
export const KEY_MOVE_REACH = 1.6;
export const MAX_FRAME_DT_S = 0.1;

const ARRIVED_DISTANCE = 0.15;
const TURN_RESEND_COS = Math.cos(0.35);
const MOVED_EPSILON = 1e-4;

export interface Point {
  x: number;
  z: number;
}

export interface MoveTarget extends Point {
  seq: number;
}

export interface ServerSelf extends Point {
  mode: string;
  ackSeq: number;
}

export interface SelfDisplay extends Point {
  yaw: number;
  walking: boolean;
}

type Phase = "idle" | "held" | "settling";

// Keyboard walking runs ahead of the server: the monk moves the instant a key goes down and the server only has to follow.
// Every target sent is derived from the predicted point, so the server converges on our path and its position is never used to correct us.
export class SelfPrediction {
  zone: Zone = "gatbawi";
  private phase: Phase = "idle";
  private x = 0;
  private z = 0;
  private yaw = 0;
  private walking = false;
  private lastSentAt = 0;
  private sentDir: Point | null = null;
  private seq = 0;
  private releaseSeq = 0;

  get active(): boolean {
    return this.phase !== "idle";
  }

  display(): SelfDisplay | null {
    return this.phase === "idle" ? null : { x: this.x, z: this.z, yaw: this.yaw, walking: this.walking };
  }

  // Advances the predicted point by one frame (long frames are capped at MAX_FRAME_DT_S); returns a numbered move target when one should be sent.
  frame(dtSeconds: number, nowMs: number, dir: Point | null, displayed: Point): MoveTarget | null {
    const length = dir ? Math.hypot(dir.x, dir.z) : 0;
    if (!dir || length < 1e-6) return this.phase === "held" ? this.release() : null;

    const ux = dir.x / length;
    const uz = dir.z / length;
    if (this.phase === "idle") {
      this.x = displayed.x;
      this.z = displayed.z;
    }
    if (this.phase !== "held") this.sentDir = null;
    this.phase = "held";

    const step = WALK_SPEED * Math.min(MAX_FRAME_DT_S, Math.max(0, dtSeconds));
    const next = resolveWalkable(this.zone, this.x + ux * step, this.z + uz * step);
    this.walking = Math.hypot(next.x - this.x, next.z - this.z) > MOVED_EPSILON;
    this.x = next.x;
    this.z = next.z;
    this.yaw = yawFromDirection(ux, uz);

    const sent = this.sentDir;
    const turned = sent === null || ux * sent.x + uz * sent.z < TURN_RESEND_COS;
    if (!turned && nowMs - this.lastSentAt < KEY_MOVE_INTERVAL_MS) return null;
    this.sentDir = { x: ux, z: uz };
    this.lastSentAt = nowMs;
    const point = resolveWalkable(this.zone, this.x + ux * KEY_MOVE_REACH, this.z + uz * KEY_MOVE_REACH);
    this.seq += 1;
    return { x: point.x, z: point.z, seq: this.seq };
  }

  // Held keys ignore the server entirely; after release the display waits at the released point until the server acks the release and stands there.
  reconcile(server: ServerSelf): void {
    if (this.phase !== "settling" || server.ackSeq < this.releaseSeq) return;
    if (server.mode !== "walk" && Math.hypot(server.x - this.x, server.z - this.z) <= ARRIVED_DISTANCE) {
      this.phase = "idle";
    }
  }

  cancel(): void {
    this.phase = "idle";
    this.walking = false;
    this.sentDir = null;
  }

  private release(): MoveTarget {
    this.phase = "settling";
    this.walking = false;
    this.sentDir = null;
    this.seq += 1;
    this.releaseSeq = this.seq;
    return { x: this.x, z: this.z, seq: this.seq };
  }
}
