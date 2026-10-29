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
  ZONE_CAPACITY,
  ZONE_COOLDOWN_MS,
} from "./constants.ts";
import { isValidEmote } from "./emote.ts";
import { randomHue } from "./identity.ts";
import {
  SEAT_YAW,
  ZONES,
  ZONE_BOUNDS,
  ZONE_SEATS,
  ZONE_SPAWN,
  type Zone,
  isZone,
  otherZone,
  pickSeat,
  resolveWalkable,
  seatKey,
  seatSpot,
  yawFromDirection,
} from "./layout.ts";
import { type NpcActions, type NpcBrain, type NpcVisitor, createNpcBrain, disturbNpc, thinkNpc } from "./npc.ts";
import { type Persona, generatePersona } from "./persona.ts";
import { Monk, Seat, TempleState } from "./schema.ts";

interface Target {
  x: number;
  z: number;
  seatId: number;
}

interface Runtime {
  target: Target | null;
  bowEndsAt: number;
  bowsLeft: number;
  nextBowAt: number;
  lastBowEndedAt: number;
  lastZoneChangeAt: number;
  nextEmoteAt: number;
  nextJumpAt: number;
  brain: NpcBrain | null;
}

export interface ZoneChoice {
  zone: Zone;
  // true when the requested zone was full and the visitor was sent to the other one
  redirected: boolean;
}

export type ZoneChangeResult = "moved" | "same" | "full" | "cooldown" | "unknown";

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
      const zone = this.state.monks.get(id)?.zone;
      return isZone(zone) && this.sit(id, zone, seatId);
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

  // Visitors in a zone; the NPCs are not counted, so they never take a visitor's place.
  zoneCount(zone: Zone): number {
    let count = 0;
    for (const monk of this.state.monks.values()) if (monk.zone === zone && !monk.npc) count += 1;
    return count;
  }

  chooseZone(requested: Zone | null | undefined): ZoneChoice {
    const wanted = requested ?? "gatbawi";
    if (this.zoneCount(wanted) < ZONE_CAPACITY) return { zone: wanted, redirected: false };
    return { zone: otherZone(wanted), redirected: true };
  }

  personaOf(id: string): Persona | undefined {
    return this.runtimes.get(id)?.brain?.persona;
  }

  join(id: string, hue: number, zone: Zone = "gatbawi"): Monk {
    const taken = new Set<number>();
    for (const other of this.state.monks.values()) taken.add(other.slot);
    let slot = 1;
    while (slot <= WORLD_CAPACITY && taken.has(slot)) slot += 1;
    const monk = new Monk({
      id,
      slot,
      hue,
      zone,
      x: 0,
      z: 0,
      yaw: 0,
      mode: "stand",
      seatId: -1,
      bowCount: 0,
    });
    this.placeAtSpawn(monk);
    this.state.monks.set(id, monk);
    this.runtimes.set(id, this.runtime(null));
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
    const point = resolveWalkable(monk.zone as Zone, x, z);
    this.startWalk(monk, runtime, { x: point.x, z: point.z, seatId: -1 });
    return true;
  }

  // A seat is only ever taken from inside its own zone, so a request naming another zone is ignored.
  sit(id: string, zone: Zone, seatId: number): boolean {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime || monk.zone !== zone) return false;
    const spot = seatSpot(zone, seatId);
    const seat = this.state.seats.get(seatKey(zone, seatId));
    if (!spot || !seat) return false;
    if (monk.seatId === seatId) return true;
    if (seat.occupantId !== "") {
      const holder = this.state.monks.get(seat.occupantId);
      if (monk.npc || !holder?.npc) return false;
      this.evict(holder);
    }

    this.releaseSeat(monk);
    seat.occupantId = id;
    monk.seatId = seatId;
    this.startWalk(monk, runtime, { x: spot.x, z: spot.z, seatId });
    return true;
  }

  // Moves a visitor to the spawn of another zone and sends them to the best free seat there.
  changeZone(id: string, zone: Zone): ZoneChangeResult {
    const monk = this.state.monks.get(id);
    const runtime = this.runtimes.get(id);
    if (!monk || !runtime) return "unknown";
    if (monk.zone === zone) return "same";
    const now = this.clock();
    if (now < runtime.lastZoneChangeAt + ZONE_COOLDOWN_MS) return "cooldown";
    if (this.zoneCount(zone) >= ZONE_CAPACITY) return "full";

    this.releaseSeat(monk);
    runtime.lastZoneChangeAt = now;
    monk.zone = zone;
    monk.mode = "stand";
    this.placeAtSpawn(monk);
    const spot = this.bestSeat(zone);
    if (spot) this.sit(id, zone, spot.id);
    return "moved";
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

      if (runtime.brain && now >= runtime.brain.nextThinkAt) this.think(monk, runtime.brain, now);
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
      if (!monk.npc && monk.zone === zone) visitors.push({ id: monk.id, x: monk.x, z: monk.z, bowCount: monk.bowCount });
    }
    return visitors;
  }

  private evict(npc: Monk): void {
    this.releaseSeat(npc);
    npc.mode = "stand";
    const brain = this.runtimes.get(npc.id)?.brain;
    if (brain) disturbNpc(brain, this.clock(), this.random);
  }

  private runtime(brain: NpcBrain | null): Runtime {
    return {
      target: null,
      bowEndsAt: 0,
      bowsLeft: 0,
      nextBowAt: 0,
      lastBowEndedAt: 0,
      lastZoneChangeAt: Number.NEGATIVE_INFINITY,
      nextEmoteAt: 0,
      nextJumpAt: 0,
      brain,
    };
  }

  // The seat a visitor is sent to: a free one if there is any, otherwise one an NPC will give up.
  private bestSeat(zone: Zone): { id: number } | undefined {
    const holderOf = (seatId: number): string => this.state.seats.get(seatKey(zone, seatId))?.occupantId ?? "";
    return (
      pickSeat(zone, (seatId) => holderOf(seatId) !== "") ??
      pickSeat(zone, (seatId) => {
        const holder = holderOf(seatId);
        return holder !== "" && !this.state.monks.get(holder)?.npc;
      })
    );
  }

  private spawnNpc(id: string, zone: Zone, persona: Persona | undefined): void {
    const random = this.random;
    const bounds = ZONE_BOUNDS[zone];
    const spot = resolveWalkable(
      zone,
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
    );
    const monk = new Monk({
      id,
      slot: 0,
      hue: randomHue(random),
      zone,
      x: spot.x,
      z: spot.z,
      yaw: (random() * 2 - 1) * Math.PI,
      mode: "stand",
      seatId: -1,
      bowCount: 0,
      npc: true,
    });
    this.state.monks.set(id, monk);
    this.runtimes.set(id, this.runtime(createNpcBrain(persona ?? generatePersona(random), random, this.clock())));
  }

  private think(monk: Monk, brain: NpcBrain, now: number): void {
    const chant = this.state.chant;
    const chanting = now >= chant.startsAt && now < chantEndsAt(chant);
    thinkNpc(
      brain,
      monk,
      {
        now,
        random: this.random,
        chantEndsAt: chanting ? chantEndsAt(chant) : null,
        visitors: this.visitors(monk.zone as Zone),
        isFree: (seatId) => this.state.seats.get(seatKey(monk.zone as Zone, seatId))?.occupantId === "",
      },
      this.npcActions,
    );
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
    if (target.seatId >= 0 && monk.seatId === target.seatId) {
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
      runtime.target = null;
    }
    if (monk.seatId >= 0) {
      const seat = this.state.seats.get(seatKey(monk.zone as Zone, monk.seatId));
      if (seat && seat.occupantId === monk.id) seat.occupantId = "";
      monk.seatId = -1;
    }
  }

  private placeAtSpawn(monk: Monk): void {
    const spawn = ZONE_SPAWN[monk.zone as Zone];
    const point = resolveWalkable(monk.zone as Zone, spawn.x + (this.random() - 0.5) * spawn.spread, spawn.z);
    monk.x = point.x;
    monk.z = point.z;
    monk.yaw = 0;
  }
}
