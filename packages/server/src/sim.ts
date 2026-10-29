import {
  ARRIVE_DISTANCE,
  BOW_COOLDOWN_MS,
  BOW_MAX_TIMES,
  BOW_MS,
  CHANT_EVERY_MS,
  CHANT_MS,
  CUSHION_SPOTS,
  Cushion,
  Monk,
  SPAWN_POINT,
  TempleState,
  WALK_SPEED,
  chantAt,
  chantEndsAt,
  cushionSpot,
  resolveWalkable,
  sanitizeName,
  yawFromDirection,
} from "@dongjane/shared";

interface Target {
  x: number;
  z: number;
  cushionId: number;
}

interface Runtime {
  target: Target | null;
  bowEndsAt: number;
  bowsLeft: number;
  nextBowAt: number;
  lastBowEndedAt: number;
}

export interface SimOptions {
  clock?: () => number;
  random?: () => number;
  chantEveryMs?: number;
  chantMs?: number;
}

export class TempleSim {
  readonly state = new TempleState();

  private readonly runtimes = new Map<string, Runtime>();
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly chantEveryMs: number;
  private readonly chantMs: number;

  constructor(options: SimOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.random = options.random ?? Math.random;
    this.chantEveryMs = options.chantEveryMs ?? CHANT_EVERY_MS;
    this.chantMs = options.chantMs ?? CHANT_MS;

    for (const spot of CUSHION_SPOTS) {
      this.state.cushions.set(String(spot.id), new Cushion({ id: spot.id, occupantId: "" }));
    }
    this.updateChant();
  }

  join(id: string, name: string, hue: number): Monk {
    const monk = new Monk({
      id,
      name,
      hue,
      x: SPAWN_POINT.x + (this.random() - 0.5) * 4,
      z: SPAWN_POINT.z,
      yaw: 0,
      mode: "stand",
      cushionId: -1,
      bowCount: 0,
    });
    this.state.monks.set(id, monk);
    this.runtimes.set(id, { target: null, bowEndsAt: 0, bowsLeft: 0, nextBowAt: 0, lastBowEndedAt: 0 });
    return monk;
  }

  leave(id: string): void {
    const monk = this.state.monks.get(id);
    if (monk) this.releaseSeat(monk);
    this.state.monks.delete(id);
    this.runtimes.delete(id);
  }

  setName(id: string, raw: string): boolean {
    const monk = this.state.monks.get(id);
    const name = sanitizeName(raw);
    if (!monk || name === "") return false;
    monk.name = name;
    return true;
  }

  move(id: string, x: number, z: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime || !Number.isFinite(x) || !Number.isFinite(z)) return false;

    this.releaseSeat(monk);
    const point = resolveWalkable(x, z);
    this.startWalk(monk, runtime, { x: point.x, z: point.z, cushionId: -1 });
    return true;
  }

  sit(id: string, cushionId: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    const spot = cushionSpot(cushionId);
    const cushion = this.state.cushions.get(String(cushionId));
    if (!monk || !runtime || !spot || !cushion) return false;
    if (monk.cushionId === cushionId) return true;
    if (cushion.occupantId !== "") return false;

    this.releaseSeat(monk);
    cushion.occupantId = id;
    monk.cushionId = cushionId;
    this.startWalk(monk, runtime, { x: spot.x, z: spot.z, cushionId });
    return true;
  }

  stand(id: string): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime) return false;
    this.releaseSeat(monk);
    runtime.target = null;
    monk.mode = "stand";
    return true;
  }

  bow(id: string, times: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime) return false;
    if (!Number.isInteger(times) || times < 1 || times > BOW_MAX_TIMES) return false;
    if (monk.mode !== "kneel" || monk.cushionId < 0 || runtime.bowsLeft > 0) return false;

    const now = this.clock();
    if (now < runtime.lastBowEndedAt + BOW_COOLDOWN_MS) return false;

    runtime.bowsLeft = times - 1;
    this.beginBow(monk, runtime, now);
    return true;
  }

  tick(dtMs: number): void {
    const now = this.clock();
    const dt = Math.max(0, Math.min(dtMs, 250)) / 1000;

    for (const [id, monk] of this.state.monks) {
      const runtime = this.runtimes.get(id);
      if (!runtime) continue;

      if (monk.mode === "walk") {
        this.advanceWalk(monk, runtime, dt);
      } else if (monk.mode === "bow") {
        if (now >= runtime.bowEndsAt) {
          monk.bowCount += 1;
          monk.mode = "kneel";
          runtime.lastBowEndedAt = now;
          runtime.nextBowAt = now + BOW_COOLDOWN_MS;
        }
      } else if (monk.mode === "kneel" && runtime.bowsLeft > 0 && now >= runtime.nextBowAt) {
        runtime.bowsLeft -= 1;
        this.beginBow(monk, runtime, now);
      }
    }
  }

  updateChant(): number {
    const now = this.clock();
    const next = chantAt(now, this.chantEveryMs, this.chantMs);
    const chant = this.state.chant;
    if (chant.startsAt !== next.startsAt || chant.durationMs !== next.durationMs) {
      chant.label = next.label;
      chant.startsAt = next.startsAt;
      chant.durationMs = next.durationMs;
    }
    return Math.max(50, chantEndsAt(next) - now + 20);
  }

  private beginBow(monk: Monk, runtime: Runtime, now: number): void {
    monk.mode = "bow";
    runtime.bowEndsAt = now + BOW_MS;
  }

  private startWalk(monk: Monk, runtime: Runtime, target: Target): void {
    runtime.target = target;
    const dx = target.x - monk.x;
    const dz = target.z - monk.z;
    if (Math.hypot(dx, dz) <= ARRIVE_DISTANCE) {
      this.arrive(monk, runtime);
      return;
    }
    monk.yaw = yawFromDirection(dx, dz);
    monk.mode = "walk";
  }

  private advanceWalk(monk: Monk, runtime: Runtime, dt: number): void {
    const target = runtime.target;
    if (!target) {
      monk.mode = "stand";
      return;
    }
    const dx = target.x - monk.x;
    const dz = target.z - monk.z;
    const distance = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;
    if (distance <= Math.max(step, ARRIVE_DISTANCE)) {
      this.arrive(monk, runtime);
      return;
    }
    monk.x += (dx / distance) * step;
    monk.z += (dz / distance) * step;
  }

  private arrive(monk: Monk, runtime: Runtime): void {
    const target = runtime.target;
    runtime.target = null;
    if (!target) {
      monk.mode = "stand";
      return;
    }
    monk.x = target.x;
    monk.z = target.z;
    if (target.cushionId >= 0 && monk.cushionId === target.cushionId) {
      monk.yaw = 0;
      monk.mode = "kneel";
    } else {
      monk.mode = "stand";
    }
  }

  private releaseSeat(monk: Monk): void {
    const runtime = this.runtimes.get(monk.id);
    if (runtime) {
      runtime.bowsLeft = 0;
      runtime.target = null;
    }
    if (monk.cushionId >= 0) {
      const cushion = this.state.cushions.get(String(monk.cushionId));
      if (cushion && cushion.occupantId === monk.id) cushion.occupantId = "";
      monk.cushionId = -1;
    }
  }
}
