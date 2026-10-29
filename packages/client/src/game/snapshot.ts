import { lerpAngle } from "@dongjane/shared";

export interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

export interface Sample {
  x: number;
  z: number;
  yaw: number;
}

const MAX_SNAPSHOTS = 40;

export class SnapshotBuffer {
  private readonly items: Snapshot[] = [];

  get length(): number {
    return this.items.length;
  }

  push(t: number, x: number, z: number, yaw: number): void {
    const last = this.items[this.items.length - 1];
    if (last && t <= last.t) {
      last.x = x;
      last.z = z;
      last.yaw = yaw;
      return;
    }
    this.items.push({ t, x, z, yaw });
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
      out.x = last.x;
      out.z = last.z;
      out.yaw = last.yaw;
      this.trim(items.length - 1);
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
    this.trim(upper - 1);
    return true;
  }

  private trim(keepFrom: number): void {
    if (keepFrom > 0) this.items.splice(0, keepFrom);
  }
}
