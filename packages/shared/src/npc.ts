import { BOW_COOLDOWN_MS, BOW_MAX_TIMES, BOW_MS, WALK_SPEED } from "./constants.ts";
import { ZONE_SEATS, type SeatSpot, type Zone } from "./layout.ts";
import type { Persona } from "./persona.ts";
import { HOME_AREAS, clampToHome } from "./walk.ts";

export interface NpcBody {
  readonly id: string;
  readonly mode: string;
  readonly x: number;
  readonly z: number;
  readonly seatId: number;
  readonly bowCount: number;
}

export interface NpcActions {
  move(id: string, x: number, z: number): boolean;
  sit(id: string, seatId: number): boolean;
  stand(id: string): boolean;
  bow(id: string, times: number): boolean;
}

export interface NpcVisitor {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly bowCount: number;
}

export interface NpcWorld {
  // the zone the monk lives in; it never walks out of it
  zone: Zone;
  now: number;
  random: () => number;
  chantEndsAt: number | null;
  visitors: readonly NpcVisitor[];
  isFree(seatId: number): boolean;
}

interface Point {
  x: number;
  z: number;
}

interface Nearby {
  visitor: NpcVisitor;
  distance: number;
}

interface Seat {
  seatId: number;
  bows: number;
  bowBase: number;
  bowsAsked: boolean;
  greetBows: number;
  settleAt: number;
  leaveAt: number;
}

export interface NpcBrain {
  readonly persona: Persona;
  nextThinkAt: number;
  seat: Seat | null;
  greetAt: number;
  seen: Map<string, number>;
}

type Range = readonly [number, number];

const FIRST_THINK_MS: Range = [1000, 4000];
const EVICTED_MS: Range = [1000, 2500];
const PAUSE_MS: Range = [1500, 5000];
const STROLL_REACH_M: Range = [1.5, 3.5];
const SETTLE_MS: Range = [1000, 3000];
const SIT_MS: Range = [12_000, 40_000];
const LINGER_MS: Range = [0, 6000];
const AFTER_STAND_MS: Range = [1000, 3000];
const GREET_DELAY_MS: Range = [500, 1500];
const AWAY_M: Range = [2, 3];
const APPROACH_GAP_M: Range = [1, 1.5];
const GREET_RANGE_M = 3;
const TOO_CLOSE_M = 1.5;
const NEAR_M = 3;
const MIN_RETREAT_M = 0.5;
const APPROACH_FACTOR = 0.5;
const FAR_STROLL_CHANCE = 0.15;
const CHANT_SIT_BOOST = 0.5;
const WALK_RECHECK_MS = 300;
const BOW_RECHECK_MS = 400;
const SOCIAL_RECHECK_MS = 1000;
const ARRIVE_SLACK_MS = 300;

function span(random: () => number, [low, high]: Range): number {
  return low + random() * (high - low);
}

function travelMs(monk: NpcBody, x: number, z: number): number {
  return (Math.hypot(x - monk.x, z - monk.z) / WALK_SPEED) * 1000;
}

export function createNpcBrain(persona: Persona, random: () => number, now: number): NpcBrain {
  return {
    persona,
    nextThinkAt: now + span(random, FIRST_THINK_MS),
    seat: null,
    greetAt: 0,
    seen: new Map(),
  };
}

export function disturbNpc(brain: NpcBrain, now: number, random: () => number): void {
  brain.seat = null;
  brain.greetAt = 0;
  brain.nextThinkAt = now + span(random, EVICTED_MS);
}

export function thinkNpc(brain: NpcBrain, monk: NpcBody, world: NpcWorld, actions: NpcActions): void {
  const zone = world.zone;
  if (monk.seatId < 0) {
    brain.seat = null;
  } else if (brain.seat?.seatId !== monk.seatId) {
    brain.seat = { seatId: monk.seatId, bows: -1, bowBase: 0, bowsAsked: false, greetBows: 0, settleAt: 0, leaveAt: 0 };
    brain.greetAt = 0;
  }

  const bowSeen = watchVisitors(brain, monk, world);

  if (monk.mode === "walk") {
    brain.nextThinkAt = world.now + WALK_RECHECK_MS;
  } else if (brain.seat) {
    thinkSeated(brain, brain.seat, monk, world, actions, bowSeen);
    if (brain.seat) {
      brain.nextThinkAt = Math.min(brain.nextThinkAt, world.now + SOCIAL_RECHECK_MS);
      if (brain.greetAt > 0) brain.nextThinkAt = Math.min(brain.nextThinkAt, brain.greetAt);
    }
  } else {
    thinkStanding(brain, monk, zone, world, actions);
  }
}

function watchVisitors(brain: NpcBrain, monk: NpcBody, world: NpcWorld): boolean {
  let bowSeen = false;
  const present = new Set<string>();
  for (const visitor of world.visitors) {
    present.add(visitor.id);
    const before = brain.seen.get(visitor.id);
    brain.seen.set(visitor.id, visitor.bowCount);
    if (before === undefined || visitor.bowCount <= before) continue;
    if (Math.hypot(visitor.x - monk.x, visitor.z - monk.z) <= GREET_RANGE_M) bowSeen = true;
  }
  for (const id of brain.seen.keys()) if (!present.has(id)) brain.seen.delete(id);
  return bowSeen;
}

function thinkSeated(
  brain: NpcBrain,
  seat: Seat,
  monk: NpcBody,
  world: NpcWorld,
  actions: NpcActions,
  bowSeen: boolean,
): void {
  const { now, random } = world;

  if (monk.mode !== "kneel") {
    brain.nextThinkAt = now + BOW_RECHECK_MS;
    return;
  }

  if (seat.bows < 0) {
    seat.bows = rollBows(brain, random);
    seat.bowBase = monk.bowCount;
    seat.settleAt = now + span(random, SETTLE_MS);
    brain.nextThinkAt = seat.settleAt;
    return;
  }

  if (bowSeen && brain.greetAt === 0 && random() < brain.persona.sociability) {
    brain.greetAt = now + span(random, GREET_DELAY_MS);
  }
  if (brain.greetAt > 0 && now >= brain.greetAt) {
    if (actions.bow(monk.id, 1)) {
      brain.greetAt = 0;
      seat.greetBows += 1;
      brain.nextThinkAt = now + BOW_RECHECK_MS;
      return;
    }
    brain.greetAt = now + BOW_RECHECK_MS;
  }

  if (now < seat.settleAt) {
    brain.nextThinkAt = seat.settleAt;
    return;
  }

  if (seat.bows > 0 && !seat.bowsAsked) {
    if (!actions.bow(monk.id, seat.bows)) {
      brain.nextThinkAt = now + BOW_RECHECK_MS;
      return;
    }
    seat.bowsAsked = true;
    brain.nextThinkAt = now + seat.bows * BOW_MS + (seat.bows - 1) * BOW_COOLDOWN_MS;
    return;
  }

  // standing up would cancel bows the sim still has queued
  if (monk.bowCount - seat.bowBase - seat.greetBows < seat.bows) {
    brain.nextThinkAt = now + BOW_RECHECK_MS;
    return;
  }

  if (seat.leaveAt === 0) seat.leaveAt = now + sitMs(brain, random);
  if (now < seat.leaveAt) {
    brain.nextThinkAt = seat.leaveAt;
    return;
  }

  if (world.chantEndsAt !== null && random() < brain.persona.devotion) {
    seat.leaveAt = world.chantEndsAt + span(random, LINGER_MS);
    brain.nextThinkAt = seat.leaveAt;
    return;
  }

  actions.stand(monk.id);
  brain.seat = null;
  brain.nextThinkAt = now + span(random, AFTER_STAND_MS);
}

function thinkStanding(brain: NpcBrain, monk: NpcBody, zone: Zone, world: NpcWorld, actions: NpcActions): void {
  const { now, random } = world;
  const { persona } = brain;

  const near = nearestVisitor(monk, world.visitors);
  if (near && near.distance <= TOO_CLOSE_M) {
    if (random() < persona.shyness) {
      const away = stepAway(monk, zone, near.visitor, random);
      if (Math.hypot(away.x - monk.x, away.z - monk.z) >= MIN_RETREAT_M) {
        walkTo(brain, monk, world, actions, away);
        return;
      }
    }
  } else if (near && near.distance <= NEAR_M && random() < persona.sociability * APPROACH_FACTOR) {
    walkTo(brain, monk, world, actions, approach(monk, zone, near.visitor, random));
    return;
  }

  const chanting = world.chantEndsAt !== null;
  const sitChance = 0.04 + 0.12 * (1 - persona.restless) + 0.05 * persona.devotion + (chanting ? CHANT_SIT_BOOST : 0);
  if (random() < sitChance) {
    const spot = pickSeat(zone, persona, world);
    if (spot && actions.sit(monk.id, spot.id)) {
      brain.nextThinkAt = now + travelMs(monk, spot.x, spot.z) + ARRIVE_SLACK_MS;
      return;
    }
  }

  walkTo(brain, monk, world, actions, pickStrollTarget(monk, zone, random));
}

function walkTo(brain: NpcBrain, monk: NpcBody, world: NpcWorld, actions: NpcActions, target: Point): void {
  actions.move(monk.id, target.x, target.z);
  const pause = span(world.random, PAUSE_MS) * (1.3 - 0.7 * brain.persona.restless);
  brain.nextThinkAt = world.now + travelMs(monk, target.x, target.z) + pause;
}

function nearestVisitor(monk: NpcBody, visitors: readonly NpcVisitor[]): Nearby | null {
  let nearest: Nearby | null = null;
  for (const visitor of visitors) {
    const distance = Math.hypot(visitor.x - monk.x, visitor.z - monk.z);
    if (!nearest || distance < nearest.distance) nearest = { visitor, distance };
  }
  return nearest;
}

function directionFrom(visitor: NpcVisitor, monk: NpcBody, random: () => number): Point {
  const dx = monk.x - visitor.x;
  const dz = monk.z - visitor.z;
  const length = Math.hypot(dx, dz);
  if (length > 1e-6) return { x: dx / length, z: dz / length };
  const angle = random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function stepAway(monk: NpcBody, zone: Zone, visitor: NpcVisitor, random: () => number): Point {
  const away = directionFrom(visitor, monk, random);
  const reach = span(random, AWAY_M);
  return clampToHome(zone, monk.x + away.x * reach, monk.z + away.z * reach);
}

function approach(monk: NpcBody, zone: Zone, visitor: NpcVisitor, random: () => number): Point {
  const side = directionFrom(visitor, monk, random);
  const gap = span(random, APPROACH_GAP_M);
  return clampToHome(zone, visitor.x + side.x * gap, visitor.z + side.z * gap);
}

// "In front" is the half of the zone's rows nearest the Buddha, whichever zone the walker is in.
function pickSeat(zone: Zone, persona: Persona, world: NpcWorld): SeatSpot | undefined {
  const spots = ZONE_SEATS[zone];
  const free = spots.filter((spot) => world.isFree(spot.id));
  const rows = spots.map((spot) => spot.z);
  const middle = (Math.min(...rows) + Math.max(...rows)) / 2;
  const front = world.random() < persona.frontRow ? free.filter((spot) => spot.z <= middle) : free;
  const pool = front.length > 0 ? front : free;
  return pool[Math.floor(world.random() * pool.length)];
}

function pickStrollTarget(monk: NpcBody, zone: Zone, random: () => number): Point {
  if (random() < FAR_STROLL_CHANCE) {
    const bounds = HOME_AREAS[zone];
    return clampToHome(
      zone,
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
    );
  }
  const angle = random() * Math.PI * 2;
  const reach = span(random, STROLL_REACH_M);
  const dx = Math.cos(angle) * reach;
  const dz = Math.sin(angle) * reach;
  const ahead = clampToHome(zone, monk.x + dx, monk.z + dz);
  if (Math.hypot(ahead.x - monk.x, ahead.z - monk.z) >= reach / 2) return ahead;
  return clampToHome(zone, monk.x - dx, monk.z - dz);
}

function rollBows(brain: NpcBrain, random: () => number): number {
  if (random() >= 0.35 + 0.65 * brain.persona.devotion) return 0;
  return random() < 0.6 * brain.persona.devotion ? BOW_MAX_TIMES : 1;
}

function sitMs(brain: NpcBrain, random: () => number): number {
  const mix = Math.min(1, random() * 0.5 + brain.persona.devotion * 0.5);
  return SIT_MS[0] + (SIT_MS[1] - SIT_MS[0]) * mix;
}
