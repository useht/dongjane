import { WALK_SPEED, lerpAngle, resolveWalkable } from "@dongjane/shared";

export interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
  walking: boolean;
}

export interface Sample {
  x: number;
  z: number;
  yaw: number;
}

export const EXTRAPOLATION_MAX_MS = 150;
export const DELAY_MIN_MS = 100;
export const DELAY_MAX_MS = 400;

const MAX_SNAPSHOTS = 40;
const BACKWARD_RESET_MS = 1000;

const DELAY_BASE_MS = 60;
const DELAY_JITTER_GAIN = 1.5;
const OFFSET_WINDOW_MS = 5000;
const RESYNC_GAP_MS = 5000;
const JITTER_RISE = 0.5;
const JITTER_FALL = 0.005;
const SLEW_FASTER = 0.1;
const SLEW_SLOWER = 0.25;
const RENDER_RESNAP_MS = 1500;

const OFFSET_TAU_S = 0.25;
const DISPLAY_STEP_FACTOR = 3;
const JUMP_SPEED_FACTOR = 1.25;
const JUMP_SLACK = 0.03;

export class SnapshotBuffer {
  private readonly items: Snapshot[] = [];

  get length(): number {
    return this.items.length;
  }

  push(t: number, x: number, z: number, yaw: number, walking = false): void {
    const last = this.items[this.items.length - 1];
    if (last && t <= last.t) {
      if (t === last.t) {
        last.x = x;
        last.z = z;
        last.yaw = yaw;
        last.walking = walking;
        return;
      }
      if (last.t - t <= BACKWARD_RESET_MS) return;
      this.items.length = 0;
    }
    this.items.push({ t, x, z, yaw, walking });
    if (this.items.length > MAX_SNAPSHOTS) this.items.shift();
  }

  sample(renderTime: number, out: Sample): boolean {
    const items = this.items;
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return false;

    if (renderTime <= first.t) {
      out.x = first.x;
      out.z = first.z;
      out.yaw = first.yaw;
      return true;
    }
    if (renderTime >= last.t) {
      extrapolate(last, renderTime - last.t, out);
      this.trim(renderTime);
      return true;
    }

    let upper = 1;
    while (upper < items.length - 1 && (items[upper] as Snapshot).t < renderTime) upper += 1;
    const a = items[upper - 1] as Snapshot;
    const b = items[upper] as Snapshot;
    const span = b.t - a.t;
    const k = span > 0 ? (renderTime - a.t) / span : 1;
    out.x = a.x + (b.x - a.x) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    this.trim(renderTime);
    return true;
  }

  // Drops snapshots behind the render time but always keeps the pair that brackets (or ends) the timeline.
  private trim(renderTime: number): void {
    let drop = 0;
    while (this.items.length - drop > 2 && (this.items[drop + 1] as Snapshot).t <= renderTime) drop += 1;
    if (drop > 0) this.items.splice(0, drop);
  }
}

function extrapolate(last: Snapshot, overshootMs: number, out: Sample): void {
  out.x = last.x;
  out.z = last.z;
  out.yaw = last.yaw;
  if (!last.walking) return;
  const reach = (WALK_SPEED * Math.min(overshootMs, EXTRAPOLATION_MAX_MS)) / 1000;
  const point = resolveWalkable(last.x - Math.sin(last.yaw) * reach, last.z - Math.cos(last.yaw) * reach);
  out.x = point.x;
  out.z = point.z;
}

interface OffsetSample {
  at: number;
  raw: number;
}

// Maps server time to the local clock and picks how far behind the live edge remote monks are drawn.
export class ServerClock {
  private readonly window: OffsetSample[] = [];
  private offset = 0;
  private jitter = 0;
  private render = 0;
  private lastLocal = 0;
  private running = false;

  get delay(): number {
    return Math.min(DELAY_MAX_MS, Math.max(DELAY_MIN_MS, DELAY_BASE_MS + DELAY_JITTER_GAIN * this.jitter));
  }

  get jitterMs(): number {
    return this.jitter;
  }

  reset(): void {
    this.window.length = 0;
    this.offset = 0;
    this.jitter = 0;
    this.running = false;
  }

  observe(serverMs: number, localMs: number): void {
    const raw = localMs - serverMs;
    if (this.window.length > 0 && raw - this.offset > RESYNC_GAP_MS) this.window.length = 0;
    this.window.push({ at: localMs, raw });
    let drop = 0;
    while (drop < this.window.length - 1 && (this.window[drop] as OffsetSample).at < localMs - OFFSET_WINDOW_MS) drop += 1;
    if (drop > 0) this.window.splice(0, drop);

    let best = raw;
    for (const entry of this.window) if (entry.raw < best) best = entry.raw;
    this.offset = best;

    const deviation = raw - best;
    this.jitter += (deviation - this.jitter) * (deviation > this.jitter ? JITTER_RISE : JITTER_FALL);
  }

  // Server time that should be on screen now; it never runs backwards and only drifts toward the target by bounded slew.
  advance(localMs: number): number {
    if (this.window.length === 0) return this.render;
    const target = localMs - this.offset - this.delay;
    if (!this.running) {
      this.running = true;
      this.render = target;
      this.lastLocal = localMs;
      return target;
    }
    const elapsed = Math.max(0, localMs - this.lastLocal);
    this.lastLocal = localMs;
    const error = target - (this.render + elapsed);
    if (Math.abs(error) > RENDER_RESNAP_MS) {
      this.render = target;
    } else {
      this.render += elapsed + Math.min(elapsed * SLEW_FASTER, Math.max(-elapsed * SLEW_SLOWER, error));
    }
    return this.render;
  }
}

// One remote monk: snapshots in server time, plus a decaying offset that glides over any correction, however large, instead of snapping.
export class RemoteTrack {
  readonly buffer = new SnapshotBuffer();
  private offsetX = 0;
  private offsetZ = 0;
  private rawX = 0;
  private rawZ = 0;
  private primed = false;

  push(t: number, x: number, z: number, yaw: number, walking: boolean): void {
    this.buffer.push(t, x, z, yaw, walking);
  }

  sample(renderTime: number, dtSeconds: number, out: Sample): boolean {
    if (!this.buffer.sample(renderTime, out)) return false;
    let moved = 0;
    if (this.primed) {
      const dx = out.x - this.rawX;
      const dz = out.z - this.rawZ;
      const step = Math.hypot(dx, dz);
      if (step > WALK_SPEED * JUMP_SPEED_FACTOR * dtSeconds + JUMP_SLACK) {
        this.offsetX -= dx;
        this.offsetZ -= dz;
      } else {
        moved = step;
      }
    }
    this.rawX = out.x;
    this.rawZ = out.z;
    this.primed = true;

    const size = Math.hypot(this.offsetX, this.offsetZ);
    if (size > 1e-6) {
      const cap = Math.max(0, DISPLAY_STEP_FACTOR * WALK_SPEED * dtSeconds - moved);
      const step = Math.min(size * (1 - Math.exp(-dtSeconds / OFFSET_TAU_S)), cap);
      const keep = (size - step) / size;
      this.offsetX *= keep;
      this.offsetZ *= keep;
    } else {
      this.offsetX = 0;
      this.offsetZ = 0;
    }
    out.x += this.offsetX;
    out.z += this.offsetZ;
    return true;
  }
}
