import { BOW_COOLDOWN_MS, BOW_MAX_TIMES, BOW_MS, WALK_SPEED } from "./constants.ts";
import { ZONE_BOUNDS, ZONE_SEATS, type Zone, isZone, resolveWalkable } from "./layout.ts";

export interface NpcBody {
  readonly id: string;
  readonly zone: string;
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

export interface NpcWorld {
  now: number;
  random: () => number;
  chantEndsAt: number | null;
  isFree(seatId: number): boolean;
}

interface Seat {
  seatId: number;
  bows: number;
  bowBase: number;
  bowsAsked: boolean;
  leaveAt: number;
}

export interface NpcBrain {
  readonly restless: number;
  readonly devotion: number;
  nextThinkAt: number;
  seat: Seat | null;
}

type Range = readonly [number, number];

const FIRST_THINK_MS: Range = [1000, 4000];
const PAUSE_MS: Range = [1500, 5000];
const STROLL_REACH_M: Range = [1.5, 3.5];
const SETTLE_MS: Range = [1000, 3000];
const SIT_MS: Range = [12_000, 40_000];
const LINGER_MS: Range = [0, 6000];
const AFTER_STAND_MS: Range = [1000, 3000];
const EVICTED_MS: Range = [1000, 2500];
const FAR_STROLL_CHANCE = 0.15;
const CHANT_SIT_BOOST = 0.5;
const WALK_RECHECK_MS = 300;
const BOW_RECHECK_MS = 400;
const ARRIVE_SLACK_MS = 300;

function span(random: () => number, [low, high]: Range): number {
  return low + random() * (high - low);
}

function travelMs(monk: NpcBody, x: number, z: number): number {
  return (Math.hypot(x - monk.x, z - monk.z) / WALK_SPEED) * 1000;
}

export function createNpcBrain(random: () => number, now: number): NpcBrain {
  return {
    restless: 0.2 + random() * 0.7,
    devotion: 0.3 + random() * 0.7,
    nextThinkAt: now + span(random, FIRST_THINK_MS),
    seat: null,
  };
}

export function disturbNpc(brain: NpcBrain, now: number, random: () => number): void {
  brain.seat = null;
  brain.nextThinkAt = now + span(random, EVICTED_MS);
}

export function thinkNpc(brain: NpcBrain, monk: NpcBody, world: NpcWorld, actions: NpcActions): void {
  const zone = monk.zone;
  if (!isZone(zone)) return;
  if (monk.seatId < 0) {
    brain.seat = null;
  } else if (brain.seat?.seatId !== monk.seatId) {
    brain.seat = { seatId: monk.seatId, bows: -1, bowBase: 0, bowsAsked: false, leaveAt: 0 };
  }

  if (monk.mode === "walk") brain.nextThinkAt = world.now + WALK_RECHECK_MS;
  else if (brain.seat) thinkSeated(brain, brain.seat, monk, world, actions);
  else thinkStanding(brain, monk, zone, world, actions);
}

function thinkSeated(brain: NpcBrain, seat: Seat, monk: NpcBody, world: NpcWorld, actions: NpcActions): void {
  const { now, random } = world;

  if (monk.mode !== "kneel") {
    brain.nextThinkAt = now + BOW_RECHECK_MS;
    return;
  }

  if (seat.bows < 0) {
    seat.bows = rollBows(brain, random);
    seat.bowBase = monk.bowCount;
    brain.nextThinkAt = now + span(random, SETTLE_MS);
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
  if (monk.bowCount - seat.bowBase < seat.bows) {
    brain.nextThinkAt = now + BOW_RECHECK_MS;
    return;
  }

  if (seat.leaveAt === 0) seat.leaveAt = now + sitMs(brain, random);
  if (now < seat.leaveAt) {
    brain.nextThinkAt = seat.leaveAt;
    return;
  }

  if (world.chantEndsAt !== null && random() < brain.devotion) {
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

  const chanting = world.chantEndsAt !== null;
  const sitChance = 0.04 + 0.12 * (1 - brain.restless) + 0.05 * brain.devotion + (chanting ? CHANT_SIT_BOOST : 0);
  if (random() < sitChance) {
    const free = ZONE_SEATS[zone].filter((spot) => world.isFree(spot.id));
    const spot = free[Math.floor(random() * free.length)];
    if (spot && actions.sit(monk.id, spot.id)) {
      brain.nextThinkAt = now + travelMs(monk, spot.x, spot.z) + ARRIVE_SLACK_MS;
      return;
    }
  }

  const target = pickStrollTarget(monk, zone, random);
  actions.move(monk.id, target.x, target.z);
  const pause = span(random, PAUSE_MS) * (1.3 - 0.7 * brain.restless);
  brain.nextThinkAt = now + travelMs(monk, target.x, target.z) + pause;
}

function pickStrollTarget(monk: NpcBody, zone: Zone, random: () => number): { x: number; z: number } {
  if (random() < FAR_STROLL_CHANCE) {
    const bounds = ZONE_BOUNDS[zone];
    return resolveWalkable(
      zone,
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      bounds.minZ + random() * (bounds.maxZ - bounds.minZ),
    );
  }
  const angle = random() * Math.PI * 2;
  const reach = span(random, STROLL_REACH_M);
  const dx = Math.cos(angle) * reach;
  const dz = Math.sin(angle) * reach;
  const ahead = resolveWalkable(zone, monk.x + dx, monk.z + dz);
  if (Math.hypot(ahead.x - monk.x, ahead.z - monk.z) >= reach / 2) return ahead;
  return resolveWalkable(zone, monk.x - dx, monk.z - dz);
}

function rollBows(brain: NpcBrain, random: () => number): number {
  if (random() >= 0.35 + 0.65 * brain.devotion) return 0;
  return random() < 0.6 * brain.devotion ? BOW_MAX_TIMES : 1;
}

function sitMs(brain: NpcBrain, random: () => number): number {
  const mix = Math.min(1, random() * 0.5 + brain.devotion * 0.5);
  return SIT_MS[0] + (SIT_MS[1] - SIT_MS[0]) * mix;
}
