import { chantAt, chantEndsAt } from "./chant.ts";
import {
  ARRIVE_DISTANCE,
  BOW_COOLDOWN_MS,
  BOW_MAX_TIMES,
  BOW_MS,
  CHANT_EVERY_MS,
  CHANT_MS,
  EMOTE_COOLDOWN_MS,
  JUMP_COOLDOWN_MS,
  WALK_SPEED,
  WORLD_CAPACITY,
} from "./constants.ts";
import { isValidEmote } from "./emote.ts";
import { randomHue } from "./identity.ts";
import { ARRIVAL, SEAT_YAW, ZONES, ZONE_SEATS, type Zone, seatKey, seatSpot, yawFromDirection } from "./layout.ts";
import { type NpcActions, type NpcBrain, type NpcVisitor, createNpcBrain, disturbNpc, thinkNpc } from "./npc.ts";
import { type Persona, generatePersona } from "./persona.ts";
import { Monk, Seat, TempleState } from "./schema.ts";
import { HOME_AREAS, type Point, clampToHome, planPath, resolveWalkable, zoneAt } from "./walk.ts";

// The corners left to walk, in order; the last is where the walk ends, and `seatId` is the seat it ends on (or -1).
interface Route {
  path: Point[];
  end: Point;
  seatId: number;
}

interface Runtime {
  route: Route | null;
  // the zone of the seat the monk holds, when it holds one
  seatZone: Zone | null;
  // a computer-driven monk's own zone, which it never leaves
  home: Zone | null;
  bowEndsAt: number;
  bowsLeft: number;
  nextBowAt: number;
  lastBowEndedAt: number;
  nextEmoteAt: number;
  nextJumpAt: number;
  brain: NpcBrain | null;
}

export interface SimOptions {
  clock?: () => number;
  random?: () => number;
  chantEveryMs?: number;
  chantMs?: number;
  npcCount?: number;
  personas?: readonly Persona[];
}

export class TempleSim {
  readonly state = new TempleState();

  private readonly runtimes = new Map<string, Runtime>();
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly chantEveryMs: number;
  private readonly chantMs: number;
  private readonly npcActions: NpcActions = {
    move: (id, x, z) => this.move(id, x, z),
    sit: (id, seatId) => {
      const home = this.runtimes.get(id)?.home;
      return home != null && this.sit(id, home, seatId);
    },
    stand: (id) => this.stand(id),
    bow: (id, times) => this.bow(id, times),
  };

  constructor(options: SimOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.random = options.random ?? Math.random;
    this.chantEveryMs = options.chantEveryMs ?? CHANT_EVERY_MS;
    this.chantMs = options.chantMs ?? CHANT_MS;
    this.state.serverTime = this.clock();

    for (const zone of ZONES) {
      for (const spot of ZONE_SEATS[zone]) {
        this.state.seats.set(seatKey(zone, spot.id), new Seat({ zone, id: spot.id, occupantId: "" }));
      }
    }
    this.updateChant();

    let n = 0;
    for (const zone of ZONES) {
      for (let i = 0; i < (options.npcCount ?? 0); i += 1) {
        n += 1;
        this.spawnNpc(`npc-${n}`, zone, options.personas?.[n - 1]);
      }
    }
  }

  get humanCount(): number {
    let count = 0;
    for (const monk of this.state.monks.values()) if (!monk.npc) count += 1;
    return count;
  }

  // Visitors standing in a zone right now; the NPCs are not counted, so they never take a visitor's place.
  zoneCount(zone: Zone): number {
    let count = 0;
    for (const monk of this.state.monks.values()) if (!monk.npc && zoneAt(monk.x, monk.z) === zone) count += 1;
    return count;
  }

  personaOf(id: string): Persona | undefined {
    return this.runtimes.get(id)?.brain?.persona;
  }

  join(id: string, hue: number): Monk {
    const taken = new Set<number>();
    for (const other of this.state.monks.values()) taken.add(other.slot);
    let slot = 1;
    while (slot <= WORLD_CAPACITY && taken.has(slot)) slot += 1;
    const monk = new Monk({
      id,
      slot,
      hue,
      x: 0,
      z: 0,
      yaw: 0,
      mode: "stand",
      seatId: -1,
      bowCount: 0,
    });
    this.placeAtArrival(monk);
    this.state.monks.set(id, monk);
    this.runtimes.set(id, this.runtime(null, null));
    return monk;
  }

  leave(id: string): void {
    const monk = this.state.monks.get(id);
    if (monk) this.releaseSeat(monk);
    this.state.monks.delete(id);
    this.runtimes.delete(id);
  }

  move(id: string, x: number, z: number, seq = 0): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (monk && seq > monk.ackSeq) monk.ackSeq = seq;
    if (!monk || !runtime || !Number.isFinite(x) || !Number.isFinite(z)) return false;

    this.releaseSeat(monk);
    this.startWalk(monk, runtime, planPath(monk, { x, z }), -1);
    return true;
  }

  // A seat can be asked for from anywhere in the world: the monk walks there, through the doorway if need be.
  sit(id: string, zone: Zone, seatId: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime || (runtime.home && runtime.home !== zone)) return false;
    const spot = seatSpot(zone, seatId);
    const seat = this.state.seats.get(seatKey(zone, seatId));
    if (!spot || !seat) return false;
    if (seat.occupantId === id) return true;
    if (seat.occupantId !== "") {
      const holder = this.state.monks.get(seat.occupantId);
      if (monk.npc || !holder?.npc) return false;
      this.evict(holder);
    }

    this.releaseSeat(monk);
    seat.occupantId = id;
    monk.seatId = seatId;
    runtime.seatZone = zone;
    this.startWalk(monk, runtime, planPath(monk, spot), seatId);
    return true;
  }

  stand(id: string): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime) return false;
    this.releaseSeat(monk);
    runtime.route = null;
    monk.mode = "stand";
    return true;
  }

  bow(id: string, times: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime) return false;
    if (!Number.isInteger(times) || times < 1 || times > BOW_MAX_TIMES) return false;
    if (monk.mode !== "kneel" || monk.seatId < 0 || runtime.bowsLeft > 0) return false;

    const now = this.clock();
    if (now < runtime.lastBowEndedAt + BOW_COOLDOWN_MS) return false;

    runtime.bowsLeft = times - 1;
    this.beginBow(monk, runtime, now);
    return true;
  }

  emote(id: string, index: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime || !isValidEmote(index)) return false;

    const now = this.clock();
    if (now < runtime.nextEmoteAt) return false;

    monk.emote = index;
    monk.emoteSeq += 1;
    runtime.nextEmoteAt = now + EMOTE_COOLDOWN_MS;
    return true;
  }

  jump(id: string): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime || monk.seatId >= 0) return false;

    const now = this.clock();
    if (now < runtime.nextJumpAt) return false;

    monk.jumpSeq += 1;
    runtime.nextJumpAt = now + JUMP_COOLDOWN_MS;
    return true;
  }

  tick(dtMs: number): void {
    const now = this.clock();
    const dt = Math.max(0, Math.min(dtMs, 250)) / 1000;
    this.state.serverTime = now;

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

      if (runtime.brain && runtime.home && now >= runtime.brain.nextThinkAt) {
        this.think(monk, runtime.brain, runtime.home, now);
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

  private visitors(zone: Zone): NpcVisitor[] {
    const visitors: NpcVisitor[] = [];
    for (const monk of this.state.monks.values()) {
      if (!monk.npc && zoneAt(monk.x, monk.z) === zone) visitors.push({ id: monk.id, x: monk.x, z: monk.z, bowCount: monk.bowCount });
    }
    return visitors;
  }

  private evict(npc: Monk): void {
    this.releaseSeat(npc);
    npc.mode = "stand";
    const brain = this.runtimes.get(npc.id)?.brain;
    if (brain) disturbNpc(brain, this.clock(), this.random);
  }

  private runtime(brain: NpcBrain | null, home: Zone | null): Runtime {
    return {
      route: null,
      seatZone: null,
      home,
      bowEndsAt: 0,
      bowsLeft: 0,
      nextBowAt: 0,
      lastBowEndedAt: 0,
      nextEmoteAt: 0,
      nextJumpAt: 0,
      brain,
    };
  }

  private spawnNpc(id: string, zone: Zone, persona: Persona | undefined): void {
    const random = this.random;
    const bounds = HOME_AREAS[zone];
    const spot = clampToHome(
      zone,
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
    );
    const monk = new Monk({
      id,
      slot: 0,
      hue: randomHue(random),
      x: spot.x,
      z: spot.z,
      yaw: (random() * 2 - 1) * Math.PI,
      mode: "stand",
      seatId: -1,
      bowCount: 0,
      npc: true,
    });
    this.state.monks.set(id, monk);
    const brain = createNpcBrain(persona ?? generatePersona(random), random, this.clock());
    this.runtimes.set(id, this.runtime(brain, zone));
  }

  private think(monk: Monk, brain: NpcBrain, zone: Zone, now: number): void {
    const chant = this.state.chant;
    const chanting = now >= chant.startsAt && now < chantEndsAt(chant);
    thinkNpc(
      brain,
      monk,
      {
        zone,
        now,
        random: this.random,
        chantEndsAt: chanting ? chantEndsAt(chant) : null,
        visitors: this.visitors(zone),
        isFree: (seatId) => this.state.seats.get(seatKey(zone, seatId))?.occupantId === "",
      },
      this.npcActions,
    );
  }

  private beginBow(monk: Monk, runtime: Runtime, now: number): void {
    monk.mode = "bow";
    runtime.bowEndsAt = now + BOW_MS;
  }

  private startWalk(monk: Monk, runtime: Runtime, path: Point[], seatId: number): void {
    const end = path[path.length - 1] ?? { x: monk.x, z: monk.z };
    runtime.route = { path, end, seatId };
    const first = path[0] ?? end;
    const dx = first.x - monk.x;
    const dz = first.z - monk.z;
    if (path.length <= 1 && Math.hypot(dx, dz) <= ARRIVE_DISTANCE) {
      this.arrive(monk, runtime);
      return;
    }
    monk.yaw = yawFromDirection(dx, dz);
    monk.mode = "walk";
  }

  private advanceWalk(monk: Monk, runtime: Runtime, dt: number): void {
    const route = runtime.route;
    if (!route) {
      monk.mode = "stand";
      return;
    }
    let reach = WALK_SPEED * dt;
    for (let corner = route.path[0]; corner; corner = route.path[0]) {
      const dx = corner.x - monk.x;
      const dz = corner.z - monk.z;
      const distance = Math.hypot(dx, dz);
      if (distance > Math.max(reach, ARRIVE_DISTANCE)) {
        monk.x += (dx / distance) * reach;
        monk.z += (dz / distance) * reach;
        return;
      }
      reach = Math.max(0, reach - distance);
      monk.x = corner.x;
      monk.z = corner.z;
      route.path.shift();
      const next = route.path[0];
      if (next) monk.yaw = yawFromDirection(next.x - monk.x, next.z - monk.z);
    }
    this.arrive(monk, runtime);
  }

  private arrive(monk: Monk, runtime: Runtime): void {
    const route = runtime.route;
    runtime.route = null;
    if (!route) {
      monk.mode = "stand";
      return;
    }
    monk.x = route.end.x;
    monk.z = route.end.z;
    if (route.seatId >= 0 && monk.seatId === route.seatId) {
      monk.yaw = SEAT_YAW;
      monk.mode = "kneel";
    } else {
      monk.mode = "stand";
    }
  }

  private releaseSeat(monk: Monk): void {
    const runtime = this.runtimes.get(monk.id);
    if (runtime) {
      runtime.bowsLeft = 0;
      runtime.route = null;
      if (monk.seatId >= 0 && runtime.seatZone) {
        const seat = this.state.seats.get(seatKey(runtime.seatZone, monk.seatId));
        if (seat && seat.occupantId === monk.id) seat.occupantId = "";
      }
      runtime.seatZone = null;
    }
    monk.seatId = -1;
  }

  private placeAtArrival(monk: Monk): void {
    const point = resolveWalkable(ARRIVAL.x + (this.random() - 0.5) * ARRIVAL.spread, ARRIVAL.z);
    monk.x = point.x;
    monk.z = point.z;
    monk.yaw = 0;
  }
}
