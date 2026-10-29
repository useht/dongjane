import { WALK_SPEED, resolveWalkable, yawFromDirection } from "@dongjane/shared";

export const KEY_MOVE_INTERVAL_MS = 100;
export const KEY_MOVE_REACH = 1.6;

const ARRIVED_DISTANCE = 0.15;
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

type Phase = "idle" | "held" | "settling";

// Keyboard walking runs ahead of the server: the monk moves the instant a key goes down and the server only has to follow.
// Every target sent is derived from the predicted point, so the server converges on our path and its position is never used to correct us.
export class SelfPrediction {
  private phase: Phase = "idle";
  private x = 0;
  private z = 0;
  private yaw = 0;
  private walking = false;
  private lastSentAt = 0;
  private sentDir: Point | null = null;

  get active(): boolean {
    return this.phase !== "idle";
  }

  display(): SelfDisplay | null {
    return this.phase === "idle" ? null : { x: this.x, z: this.z, yaw: this.yaw, walking: this.walking };
  }

  // Advances the predicted point by one frame; returns a move target when one should be sent to the server.
  frame(dtSeconds: number, nowMs: number, dir: Point | null, displayed: Point): Point | null {
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

    const step = WALK_SPEED * dtSeconds;
    const next = resolveWalkable(this.x + ux * step, this.z + uz * step);
    this.walking = Math.hypot(next.x - this.x, next.z - this.z) > MOVED_EPSILON;
    this.x = next.x;
    this.z = next.z;
    this.yaw = yawFromDirection(ux, uz);

    const sent = this.sentDir;
    const turned = sent === null || ux * sent.x + uz * sent.z < TURN_RESEND_COS;
    if (!turned && nowMs - this.lastSentAt < KEY_MOVE_INTERVAL_MS) return null;
    this.sentDir = { x: ux, z: uz };
    this.lastSentAt = nowMs;
    return resolveWalkable(this.x + ux * KEY_MOVE_REACH, this.z + uz * KEY_MOVE_REACH);
  }

  // Held keys ignore the server entirely; after release the display waits at the released point until the server confirms the stop there.
  reconcile(server: ServerSelf): void {
    if (this.phase !== "settling") return;
    if (server.mode !== "walk" && Math.hypot(server.x - this.x, server.z - this.z) <= ARRIVED_DISTANCE) {
      this.phase = "idle";
    }
  }

  cancel(): void {
    this.phase = "idle";
    this.walking = false;
    this.sentDir = null;
  }

  private release(): Point {
    this.phase = "settling";
    this.walking = false;
    this.sentDir = null;
    return { x: this.x, z: this.z };
  }
}
