import { BOW_COOLDOWN_MS, BOW_MAX_TIMES, BOW_MS, WALK_SPEED } from "./constants.ts";
import type { SeatSpot } from "./layout.ts";
import type { Persona } from "./persona.ts";
import { SEAT_DEPTH, ZONES, ZONE_SEATS, type Zone, perZone } from "./venues/index.ts";
import { randomWalkable, resolveNearby, resolveWalkable } from "./walk.ts";

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
  sit(id: string, zone: Zone, seatId: number): boolean;
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
  // the zone the monk stands in right now; it sees visitors there and mostly sits there
  zone: Zone;
  now: number;
  random: () => number;
  chantEndsAt: number | null;
  visitors: readonly NpcVisitor[];
  isFree(zone: Zone, seatId: number): boolean;
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
  // a devotional bow is under way, and standing or stepping away now would cancel its queued bows
  bowingUntil: number;
}

export interface NpcBrain {
  readonly persona: Persona;
  nextThinkAt: number;
  seat: Seat | null;
  greetAt: number;
  seen: Map<string, number>;
  // One prayer spans several mats: these clocks run from the first mat until the monk stands up for good (0 = not started).
  leaveAt: number;
  devoutAt: number;
  shiftAt: number;
  // the mat under the monk was reached by shifting over, so it does not bow again for sitting down
  shifted: boolean;
}

type Range = readonly [number, number];

const FIRST_THINK_MS: Range = [1000, 4000];
const EVICTED_MS: Range = [1000, 2500];
const PAUSE_MS: Range = [1500, 5000];
const STROLL_REACH_M: Range = [1.5, 3.5];
const SETTLE_MS: Range = [1000, 3000];
const SIT_MS: Range = [5 * 60_000, 15 * 60_000];
// A long prayer is never still: the monk bows again every minute or two, and shifts to a mat a few steps off.
const DEVOUT_MS: Range = [50_000, 130_000];
const SHIFT_MS: Range = [18_000, 50_000];
const SHIFT_REACH_M: Range = [2, 3.4];
const DEVOUT_MULTI_CHANCE = 0.3;
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
// A standing monk sits almost every time it thinks; a stroll is the rare exception.
const SIT_CHANCE = 0.9;
const CHANT_SIT_BOOST = 0.1;
// Roaming happens between seats: now and then a monk walks to a seat in another zone to pray there.
const OTHER_ZONE_SEAT_CHANCE = 0.5;
// Within a zone a monk mostly picks a mat close to where it stands, and only now and then one anywhere.
const NEAR_SEAT_M = 3;
const NEAR_SEAT_CHANCE = 0.8;
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
    leaveAt: 0,
    devoutAt: 0,
    shiftAt: 0,
    shifted: false,
  };
}

export function disturbNpc(brain: NpcBrain, now: number, random: () => number): void {
  brain.seat = null;
  brain.greetAt = 0;
  brain.nextThinkAt = now + span(random, EVICTED_MS);
}

export function thinkNpc(brain: NpcBrain, monk: NpcBody, world: NpcWorld, actions: NpcActions): void {
  if (monk.seatId < 0) {
    brain.seat = null;
    brain.leaveAt = 0;
    brain.devoutAt = 0;
    brain.shiftAt = 0;
    brain.shifted = false;
  } else if (brain.seat?.seatId !== monk.seatId) {
    brain.seat = { seatId: monk.seatId, bows: -1, bowBase: 0, bowsAsked: false, greetBows: 0, settleAt: 0, bowingUntil: 0 };
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
    thinkStanding(brain, monk, world, actions);
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
    seat.bows = brain.shifted ? 0 : rollBows(brain, random);
    brain.shifted = false;
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

  if (now < seat.bowingUntil) {
    brain.nextThinkAt = seat.bowingUntil;
    return;
  }

  if (brain.leaveAt === 0) brain.leaveAt = now + sitMs(brain, random);
  if (brain.devoutAt === 0) brain.devoutAt = now + devoutMs(brain, random);
  if (brain.shiftAt === 0) brain.shiftAt = now + shiftMs(brain, random);

  if (now >= brain.leaveAt) {
    if (world.chantEndsAt !== null && random() < brain.persona.devotion) {
      brain.leaveAt = world.chantEndsAt + span(random, LINGER_MS);
      brain.nextThinkAt = brain.leaveAt;
      return;
    }
    actions.stand(monk.id);
    brain.seat = null;
    brain.nextThinkAt = now + span(random, AFTER_STAND_MS);
    return;
  }

  // the chant is prayed still: bows and shifting wait until it is over
  if (now >= brain.devoutAt) {
    if (world.chantEndsAt !== null) brain.devoutAt = world.chantEndsAt + devoutMs(brain, random);
    else if (devoutBow(brain, seat, monk, world, actions)) return;
    else {
      brain.nextThinkAt = now + BOW_RECHECK_MS;
      return;
    }
  }

  if (now >= brain.shiftAt) {
    if (world.chantEndsAt !== null) brain.shiftAt = world.chantEndsAt + shiftMs(brain, random);
    else if (shiftOver(brain, monk, world, actions)) return;
  }

  brain.nextThinkAt = Math.min(brain.leaveAt, brain.devoutAt, brain.shiftAt);
}

function devoutBow(brain: NpcBrain, seat: Seat, monk: NpcBody, world: NpcWorld, actions: NpcActions): boolean {
  const { now, random } = world;
  const times = random() < DEVOUT_MULTI_CHANCE * brain.persona.devotion ? 2 + Math.floor(random() * (BOW_MAX_TIMES - 1)) : 1;
  if (!actions.bow(monk.id, times)) return false;
  const bowing = times * BOW_MS + (times - 1) * BOW_COOLDOWN_MS;
  seat.bowingUntil = now + bowing + ARRIVE_SLACK_MS;
  brain.devoutAt = now + bowing + devoutMs(brain, random);
  brain.nextThinkAt = seat.bowingUntil;
  return true;
}

// Gets up and kneels on a free mat a few steps off in the same zone, keeping the prayer going; false if there is none.
function shiftOver(brain: NpcBrain, monk: NpcBody, world: NpcWorld, actions: NpcActions): boolean {
  const { now, random } = world;
  const spot = pickNearbySpot(brain.persona, monk, world);
  if (!spot || !actions.sit(monk.id, world.zone, spot.id)) {
    brain.shiftAt = now + shiftMs(brain, random);
    return false;
  }
  brain.seat = null;
  brain.shiftAt = 0;
  brain.shifted = true;
  brain.nextThinkAt = now + travelMs(monk, spot.x, spot.z) + ARRIVE_SLACK_MS;
  return true;
}

function thinkStanding(brain: NpcBrain, monk: NpcBody, world: NpcWorld, actions: NpcActions): void {
  const { now, random } = world;
  const { persona } = brain;

  const near = nearestVisitor(monk, world.visitors);
  if (near && near.distance <= TOO_CLOSE_M) {
    if (random() < persona.shyness) {
      const away = stepAway(monk, near.visitor, random);
      if (Math.hypot(away.x - monk.x, away.z - monk.z) >= MIN_RETREAT_M) {
        walkTo(brain, monk, world, actions, away);
        return;
      }
    }
  } else if (near && near.distance <= NEAR_M && random() < persona.sociability * APPROACH_FACTOR) {
    walkTo(brain, monk, world, actions, approach(monk, near.visitor, random));
    return;
  }

  const chanting = world.chantEndsAt !== null;
  const sitChance = SIT_CHANCE + 0.06 * (1 - persona.restless) + 0.03 * persona.devotion + (chanting ? CHANT_SIT_BOOST : 0);
  if (random() < sitChance) {
    const pick = pickSeat(persona, monk, world);
    if (pick && actions.sit(monk.id, pick.zone, pick.spot.id)) {
      brain.nextThinkAt = now + travelMs(monk, pick.spot.x, pick.spot.z) + ARRIVE_SLACK_MS;
      return;
    }
  }

  walkTo(brain, monk, world, actions, pickStrollTarget(monk, random));
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

function stepAway(monk: NpcBody, visitor: NpcVisitor, random: () => number): Point {
  const away = directionFrom(visitor, monk, random);
  const reach = span(random, AWAY_M);
  return resolveNearby(monk.x + away.x * reach, monk.z + away.z * reach, monk);
}

function approach(monk: NpcBody, visitor: NpcVisitor, random: () => number): Point {
  const side = directionFrom(visitor, monk, random);
  const gap = span(random, APPROACH_GAP_M);
  return resolveWalkable(visitor.x + side.x * gap, visitor.z + side.z * gap, monk);
}

// The other zones in the order a roaming monk tries them: a draw by seatWeight, then another among those left, and so on.
// With a single other zone there is nothing to draw.
export function weightedOrder<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T[] {
  const pool = [...items];
  const order: T[] = [];
  while (pool.length > 1) {
    let pick = random() * pool.reduce((sum, item) => sum + weight(item), 0);
    let index = 0;
    while (index < pool.length - 1 && pick >= weight(pool[index] as T)) {
      pick -= weight(pool[index] as T);
      index += 1;
    }
    order.push(...pool.splice(index, 1));
  }
  return [...order, ...pool];
}

const SEAT_WEIGHT = perZone((venue) => venue.npc.seatWeight);

function pickSeat(persona: Persona, monk: NpcBody, world: NpcWorld): { zone: Zone; spot: SeatSpot } | undefined {
  const here = world.zone;
  const away = ZONES.filter((zone) => zone !== here && SEAT_WEIGHT[zone] > 0);
  const roams = world.random() < OTHER_ZONE_SEAT_CHANCE * persona.restless;
  const others = weightedOrder(away, (zone) => SEAT_WEIGHT[zone], world.random);
  const order = roams ? [...others, here] : [here, ...others];
  for (const zone of order) {
    const spot = pickSpotIn(zone, persona, monk, world);
    if (spot) return { zone, spot };
  }
  return undefined;
}

// "In front" is the half of the zone's rows nearest the Buddha.
const FRONT_DEPTH = perZone((venue) => {
  const depths = venue.seats.spots.map(venue.seats.depth);
  return (Math.min(...depths) + Math.max(...depths)) / 2;
});

const isFront = (zone: Zone, spot: SeatSpot): boolean => SEAT_DEPTH[zone](spot) <= FRONT_DEPTH[zone];
const seatDistance = (spot: SeatSpot, monk: NpcBody): number => Math.hypot(spot.x - monk.x, spot.z - monk.z);

// The front half comes first when the monk wants it, then a mat close by, then any free one.
function pickSpotIn(zone: Zone, persona: Persona, monk: NpcBody, world: NpcWorld): SeatSpot | undefined {
  const free = ZONE_SEATS[zone].filter((spot) => world.isFree(zone, spot.id));
  const front = world.random() < persona.frontRow ? free.filter((spot) => isFront(zone, spot)) : free;
  const pool = front.length > 0 ? front : free;
  const near = world.random() < NEAR_SEAT_CHANCE ? pool.filter((spot) => seatDistance(spot, monk) <= NEAR_SEAT_M) : [];
  const from = near.length > 0 ? near : pool;
  return from[Math.floor(world.random() * from.length)];
}

// A free mat two or three metres off in the zone the monk kneels in, in the front half if it wants that and one is there.
function pickNearbySpot(persona: Persona, monk: NpcBody, world: NpcWorld): SeatSpot | undefined {
  const zone = world.zone;
  const near = ZONE_SEATS[zone].filter((spot) => {
    const distance = seatDistance(spot, monk);
    return spot.id !== monk.seatId && distance >= SHIFT_REACH_M[0] && distance <= SHIFT_REACH_M[1] && world.isFree(zone, spot.id);
  });
  const front = world.random() < persona.frontRow ? near.filter((spot) => isFront(zone, spot)) : near;
  const pool = front.length > 0 ? front : near;
  return pool[Math.floor(world.random() * pool.length)];
}

function pickStrollTarget(monk: NpcBody, random: () => number): Point {
  if (random() < FAR_STROLL_CHANCE) return randomWalkable(random);
  const angle = random() * Math.PI * 2;
  const reach = span(random, STROLL_REACH_M);
  const dx = Math.cos(angle) * reach;
  const dz = Math.sin(angle) * reach;
  const ahead = resolveNearby(monk.x + dx, monk.z + dz, monk);
  if (Math.hypot(ahead.x - monk.x, ahead.z - monk.z) >= reach / 2) return ahead;
  return resolveNearby(monk.x - dx, monk.z - dz, monk);
}

function rollBows(brain: NpcBrain, random: () => number): number {
  if (random() >= 0.35 + 0.65 * brain.persona.devotion) return 0;
  return random() < 0.6 * brain.persona.devotion ? BOW_MAX_TIMES : 1;
}

// The more devout the monk, the sooner it bows again.
function devoutMs(brain: NpcBrain, random: () => number): number {
  const mix = Math.min(1, random() * 0.6 + (1 - brain.persona.devotion) * 0.6);
  return DEVOUT_MS[0] + (DEVOUT_MS[1] - DEVOUT_MS[0]) * mix;
}

// The more restless the monk, the sooner it moves on to another mat.
function shiftMs(brain: NpcBrain, random: () => number): number {
  return span(random, SHIFT_MS) * (1.3 - 0.7 * brain.persona.restless);
}

function sitMs(brain: NpcBrain, random: () => number): number {
  const mix = Math.min(1, random() * 0.5 + brain.persona.devotion * 0.5);
  return SIT_MS[0] + (SIT_MS[1] - SIT_MS[0]) * mix;
}
