import { describe, expect, it } from "vitest";
import { CHANT_MS, NPC_COUNT, TICK_MS, ZONE_CAPACITY } from "../src/constants.ts";
import { GATBAWI_SEATS, ZONES, seatKey, type Zone } from "../src/layout.ts";
import { type NpcActions, type NpcBody, type NpcVisitor, type NpcWorld, createNpcBrain, thinkNpc } from "../src/npc.ts";
import type { Persona } from "../src/persona.ts";
import { TempleSim } from "../src/sim.ts";
import { INTERIOR_AREA, PLAZA_AREA, resolveWalkable, zoneAt } from "../src/walk.ts";

const CHANT_START = 1_800_000_000_000;
const QUIET_START = CHANT_START + 5 * 60_000;
const NPC_TOTAL = NPC_COUNT;
const PLAZA_SPOT = { x: 0, z: 8 };
// Twenty minutes from QUIET_START: long enough for every prayer to end, and over before the next chant begins.
const PRAYER_RUN_MS = 20 * 60_000;

// A computer-driven monk is in the zone its feet are in, and it roams the whole world.
const zoneOf = (monk: { x: number; z: number }): Zone => zoneAt(monk.x, monk.z);

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

class World {
  now: number;
  readonly sim: TempleSim;

  constructor(
    seed: number,
    options: { npcCount?: number; start?: number; random?: () => number; personas?: readonly Persona[] } = {},
  ) {
    this.now = options.start ?? QUIET_START;
    this.sim = new TempleSim({
      clock: () => this.now,
      random: options.random ?? seededRandom(seed),
      npcCount: options.npcCount ?? NPC_COUNT,
      personas: options.personas,
    });
  }

  run(ms: number, each: () => void = () => undefined): void {
    for (let left = ms; left > 0; left -= TICK_MS) {
      this.now += TICK_MS;
      this.sim.tick(TICK_MS);
      this.sim.updateChant();
      each();
    }
  }

  npcs() {
    return [...this.sim.state.monks.values()].filter((monk) => monk.npc);
  }

  holder(zone: Zone, seatId: number): string {
    return this.sim.state.seats.get(seatKey(zone, seatId))?.occupantId ?? "";
  }

  seatZoneOf(id: string): Zone | null {
    for (const seat of this.sim.state.seats.values()) if (seat.occupantId === id) return seat.zone as Zone;
    return null;
  }

  seatProblems(): string[] {
    const problems: string[] = [];
    const held = new Map<string, number[]>();
    for (const seat of this.sim.state.seats.values()) {
      if (seat.occupantId === "") continue;
      held.set(seat.occupantId, [...(held.get(seat.occupantId) ?? []), seat.id]);
      const owner = this.sim.state.monks.get(seat.occupantId);
      if (owner?.seatId !== seat.id) {
        problems.push(`seat ${seat.zone}:${seat.id} points at ${seat.occupantId} who sits elsewhere`);
      }
    }
    for (const [id, seats] of held) if (seats.length > 1) problems.push(`${id} holds two seats`);
    for (const monk of this.sim.state.monks.values()) {
      if (monk.seatId < 0) continue;
      const seats = held.get(monk.id) ?? [];
      if (seats.length !== 1 || seats[0] !== monk.seatId) problems.push(`${monk.id} claims seat ${monk.seatId} it does not hold`);
    }
    return problems;
  }
}

// How an npc's time divides between walking, standing about and praying (kneeling or bowing on a mat).
interface Shares {
  walk: number;
  stand: number;
  seated: number;
}

function sharesOver(world: World, ms: number): Shares {
  const ticks = { walk: 0, stand: 0, seated: 0 };
  world.run(ms, () => {
    for (const npc of world.npcs()) {
      if (npc.mode === "walk") ticks.walk += 1;
      else if (npc.mode === "stand") ticks.stand += 1;
      else ticks.seated += 1;
    }
  });
  const total = ticks.walk + ticks.stand + ticks.seated;
  return { walk: ticks.walk / total, stand: ticks.stand / total, seated: ticks.seated / total };
}

function snapshot(world: World): string {
  return [...world.sim.state.monks.values()]
    .map((monk) => [monk.id, zoneOf(monk), monk.mode, monk.seatId, monk.bowCount, monk.x.toFixed(3), monk.z.toFixed(3)].join(":"))
    .join("|");
}

describe("npc spawning", () => {
  it("adds flagged monks without a slot that do not count as visitors", () => {
    const world = new World(1);
    const npcs = world.npcs();
    expect(npcs).toHaveLength(NPC_TOTAL);
    expect(world.sim.humanCount).toBe(0);
    expect(new Set(npcs.map((npc) => npc.id)).size).toBe(NPC_TOTAL);
    for (const zone of ZONES) expect(world.sim.zoneCount(zone)).toBe(0);
    for (const npc of npcs) {
      expect(npc.slot).toBe(0);
      expect(npc.id).toMatch(/^npc-\d+$/);
      expect(npc.mode).toBe("stand");
      expect(npc.hue).toBeGreaterThanOrEqual(0);
      expect(npc.hue).toBeLessThan(360);
    }

    const human = world.sim.join("session-1", 10);
    expect(human.npc).toBe(false);
    expect(human.slot).toBe(1);
    expect(world.sim.humanCount).toBe(1);
    expect(world.sim.zoneCount("dharma")).toBe(1);
    expect(world.sim.zoneCount("gatbawi")).toBe(0);
    expect(world.sim.state.monks.size).toBe(NPC_TOTAL + 1);
    world.sim.leave("session-1");
    expect(world.sim.humanCount).toBe(0);
  });

  it("starts every npc inside the 법당 room, spread over its floor", () => {
    for (const seed of [1, 2, 3]) {
      const npcs = new World(seed).npcs();
      expect(npcs).toHaveLength(NPC_COUNT);
      for (const npc of npcs) {
        expect(zoneOf(npc)).toBe("dharma");
        expect(npc.x).toBeGreaterThanOrEqual(INTERIOR_AREA.minX);
        expect(npc.x).toBeLessThanOrEqual(INTERIOR_AREA.maxX);
        expect(npc.z).toBeGreaterThanOrEqual(INTERIOR_AREA.minZ);
        expect(npc.z).toBeLessThanOrEqual(INTERIOR_AREA.maxZ);
      }
      expect(new Set(npcs.map((npc) => `${npc.x.toFixed(2)},${npc.z.toFixed(2)}`)).size).toBe(NPC_COUNT);
    }
  });

  it("spawns nobody and draws no randomness unless asked to", () => {
    let draws = 0;
    const world = new World(1, {
      npcCount: 0,
      random: () => {
        draws += 1;
        return 0.5;
      },
    });
    world.run(60_000);
    expect(world.sim.state.monks.size).toBe(0);
    expect(draws).toBe(0);
  });
});

describe("npc behaviour", () => {
  it("lets every npc sit, bow and stand up on its own after minutes of prayer, finishing each bow plan first", () => {
    const world = new World(7);
    const walked = new Set<string>();
    const sat = new Set<string>();
    const bowed = new Set<string>();
    const firstStoodUp = new Map<string, number>();
    const bowsPerSeating = new Set<number>();
    const before = new Map(world.npcs().map((npc) => [npc.id, { mode: npc.mode, bowsAtSeating: 0 }]));
    const problems: string[] = [];
    let ticks = 0;

    world.run(PRAYER_RUN_MS, () => {
      ticks += 1;
      if (ticks % 20 === 0) problems.push(...world.seatProblems());
      for (const npc of world.npcs()) {
        const last = before.get(npc.id)!;
        if (npc.mode === "walk") walked.add(npc.id);
        if (npc.mode === "kneel" && last.mode !== "kneel" && last.mode !== "bow") {
          sat.add(npc.id);
          last.bowsAtSeating = npc.bowCount;
        }
        if (npc.mode === "bow") bowed.add(npc.id);
        if (npc.mode === "stand" && (last.mode === "kneel" || last.mode === "bow")) {
          if (!firstStoodUp.has(npc.id)) firstStoodUp.set(npc.id, world.now - QUIET_START);
          bowsPerSeating.add(npc.bowCount - last.bowsAtSeating);
        }
        last.mode = npc.mode;
      }
    });

    expect(problems).toEqual([]);
    expect(walked.size).toBe(NPC_TOTAL);
    expect(sat.size).toBe(NPC_TOTAL);
    expect(bowed.size).toBeGreaterThan(0);
    expect(firstStoodUp.size).toBe(NPC_TOTAL);
    expect([...bowsPerSeating].every((count) => [0, 1, 3].includes(count))).toBe(true);
    expect(world.sim.humanCount).toBe(0);

    // Every monk prays for at least five minutes, and for its own length of time.
    const times = [...firstStoodUp.values()];
    expect(Math.min(...times)).toBeGreaterThan(5 * 60_000);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(3 * 60_000);
    expect(new Set(times.map((time) => Math.round(time / 1000))).size).toBeGreaterThan(NPC_TOTAL / 2);
  });

  it("keeps almost every npc at prayer: walking is the rare exception, not the day's work", () => {
    for (const seed of [1, 2, 3]) {
      const shares = sharesOver(new World(seed), PRAYER_RUN_MS);
      expect(shares.walk, `seed ${seed} walks`).toBeLessThanOrEqual(0.05);
      expect(shares.seated, `seed ${seed} prays`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("lets the npcs wander out of the 법당 into the plaza and back, always on walkable ground", () => {
    const world = new World(13);
    const lastZone = new Map(world.npcs().map((npc) => [npc.id, zoneOf(npc)]));
    const wentOut = new Set<string>();
    const cameBack = new Set<string>();
    const problems: string[] = [];

    world.run(PRAYER_RUN_MS, () => {
      for (const npc of world.npcs()) {
        const zone = zoneOf(npc);
        const solid = resolveWalkable(npc.x, npc.z);
        if (Math.hypot(solid.x - npc.x, solid.z - npc.z) > 1e-4) problems.push(`${npc.id} stands in a wall at ${npc.x}, ${npc.z}`);
        if (npc.mode === "kneel" && world.seatZoneOf(npc.id) !== zone) {
          problems.push(`${npc.id} kneels in ${zone} on a ${world.seatZoneOf(npc.id)} seat`);
        }
        const before = lastZone.get(npc.id);
        if (before === "dharma" && zone === "gatbawi") wentOut.add(npc.id);
        if (before === "gatbawi" && zone === "dharma") cameBack.add(npc.id);
        lastZone.set(npc.id, zone);
      }
    });

    expect(problems).toEqual([]);
    expect(wentOut.size).toBeGreaterThan(0);
    expect(cameBack.size).toBeGreaterThan(0);
    const zones = new Set(world.npcs().map(zoneOf));
    expect(zones.has("gatbawi")).toBe(true);
    expect(zones.has("dharma")).toBe(true);
  }, 30_000);

  it("gives each npc its own rhythm instead of moving in lockstep", () => {
    const world = new World(11);
    const firstMove = new Map<string, number>();
    world.run(10_000, () => {
      for (const npc of world.npcs()) {
        if (npc.mode !== "stand" && !firstMove.has(npc.id)) firstMove.set(npc.id, world.now);
      }
    });
    expect(firstMove.size).toBe(NPC_TOTAL);
    expect(new Set(firstMove.values()).size).toBeGreaterThan(NPC_TOTAL / 2);

    world.run(50_000);
    expect(new Set(world.npcs().map((npc) => `${zoneOf(npc)}:${npc.x.toFixed(2)},${npc.z.toFixed(2)}`)).size).toBe(NPC_TOTAL);
  });

  it("keeps praying through the chant: far fewer npcs stand up while it is on than in a quiet stretch", () => {
    // Six minutes in, the first prayers begin to end. Same seed and same minute of prayer, with and without a chant.
    const standUps = (start: number, seed: number): number => {
      const world = new World(seed, { start });
      world.run(6 * 60_000);
      const last = new Map(world.npcs().map((npc) => [npc.id, npc.mode]));
      let stood = 0;
      world.run(CHANT_MS, () => {
        for (const npc of world.npcs()) {
          const before = last.get(npc.id);
          if (npc.mode === "stand" && (before === "kneel" || before === "bow")) stood += 1;
          last.set(npc.id, npc.mode);
        }
      });
      return stood;
    };
    const beforeChant = CHANT_START - 6 * 60_000;
    let chant = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 5; seed += 1) {
      expect(new World(seed, { start: beforeChant }).sim.state.chant.startsAt).toBe(CHANT_START);
      expect(new World(seed, { start: QUIET_START }).sim.state.chant.startsAt).toBeGreaterThan(QUIET_START + 6 * 60_000 + CHANT_MS);
      chant += standUps(beforeChant, seed);
      quiet += standUps(QUIET_START, seed);
    }
    expect(quiet).toBeGreaterThan(20);
    expect(chant).toBeLessThan(quiet * 0.6);
  });

  it("repeats the same day for the same seed and a different one for another", () => {
    const trace = (seed: number) => {
      const world = new World(seed);
      world.sim.join("guest", 40);
      const frames: string[] = [];
      world.run(90_000, () => frames.push(snapshot(world)));
      return frames;
    };
    expect(trace(3)).toEqual(trace(3));
    expect(trace(3)).not.toEqual(trace(4));
  });
});

describe("npc and visitor seats", () => {
  it("keeps one monk per seat while visitors and npcs fight over seats", () => {
    const world = new World(21);
    const visitorChoice = seededRandom(99);
    const guests = ["a", "b", "c", "d"];
    for (const id of guests) world.sim.join(id, 0);
    const problems: string[] = [];
    let ticks = 0;
    let seatedTicks = 0;
    let evictions = 0;

    world.run(6 * 60_000, () => {
      problems.push(...world.seatProblems());
      if (guests.some((id) => world.sim.state.monks.get(id)!.seatId >= 0)) seatedTicks += 1;
      ticks += 1;
      if (ticks % 40 !== 0) return;
      const id = guests[Math.floor(visitorChoice() * guests.length)]!;
      const roll = visitorChoice();
      if (roll < 0.7) {
        const held = world.npcs().filter((npc) => zoneOf(npc) === "gatbawi" && npc.seatId >= 0);
        const seatId =
          held.length > 0 && visitorChoice() < 0.6
            ? held[Math.floor(visitorChoice() * held.length)]!.seatId
            : Math.floor(visitorChoice() * GATBAWI_SEATS.length);
        const holder = world.sim.state.monks.get(world.holder("gatbawi", seatId));
        if (!world.sim.sit(id, "gatbawi", seatId) || !holder?.npc) return;
        evictions += 1;
        expect(holder.seatId).toBe(-1);
        expect(holder.mode).toBe("stand");
        expect(world.sim.state.monks.get(id)!.seatId).toBe(seatId);
      } else if (roll < 0.85) world.sim.stand(id);
      else world.sim.move(id, visitorChoice() * 8 - 4, visitorChoice() * 6 - 2);
    });

    expect(problems).toEqual([]);
    expect(world.sim.humanCount).toBe(guests.length);
    expect(seatedTicks).toBeGreaterThan(0);
    expect(evictions).toBeGreaterThan(0);
  });

  it("evicts an npc from its seat when a visitor sits there, and the npc carries on", () => {
    const world = new World(5);
    world.run(60_000);
    const seated = world.npcs().find((npc) => npc.seatId >= 0);
    expect(seated).toBeDefined();
    const npc = seated!;
    const zone = zoneOf(npc);
    const seatId = npc.seatId;

    world.sim.join("guest", 0);
    expect(world.sim.sit("guest", zone, seatId)).toBe(true);
    expect(npc.mode).toBe("stand");
    expect(npc.seatId).toBe(-1);
    expect(world.holder(zone, seatId)).toBe("guest");
    expect(world.sim.state.monks.get("guest")?.seatId).toBe(seatId);
    expect(world.seatProblems()).toEqual([]);

    const problems: string[] = [];
    const modes = new Set<string>();
    world.run(90_000, () => {
      problems.push(...world.seatProblems());
      modes.add(npc.mode);
      expect(world.holder(zone, seatId)).toBe("guest");
    });
    expect(problems).toEqual([]);
    expect(modes.has("walk")).toBe(true);
  });

  it("never lets an npc take a seat that anyone holds, in either zone", () => {
    const world = new World(5, { npcCount: 3 });
    world.sim.join("guest", 0);
    expect(world.sim.sit("guest", "gatbawi", 0)).toBe(true);
    expect(world.sim.sit("npc-1", "gatbawi", 0)).toBe(false);
    expect(world.holder("gatbawi", 0)).toBe("guest");

    expect(world.sim.sit("npc-1", "gatbawi", 3)).toBe(true);
    expect(world.sim.sit("npc-2", "gatbawi", 3)).toBe(false);
    expect(world.holder("gatbawi", 3)).toBe("npc-1");
    expect(world.sim.state.monks.get("npc-2")?.seatId).toBe(-1);

    expect(world.sim.sit("npc-3", "dharma", 5)).toBe(true);
    expect(world.sim.sit("npc-2", "dharma", 5)).toBe(false);
    expect(world.holder("dharma", 5)).toBe("npc-3");

    world.sim.join("second", 0);
    expect(world.sim.sit("second", "gatbawi", 0)).toBe(false);
    expect(world.seatProblems()).toEqual([]);
  });

  it("does not count npcs toward a zone's headcount, and gives a newcomer a seat an npc holds", () => {
    const world = new World(5);
    world.sim.join("guest", 0);
    world.sim.move("guest", PLAZA_SPOT.x, PLAZA_SPOT.z);
    for (let n = 1; n < ZONE_CAPACITY; n += 1) {
      world.sim.join(`s${n}`, 0);
      expect(world.sim.sit(`s${n}`, "dharma", n - 1)).toBe(true);
    }
    world.run(40_000);
    expect(world.sim.zoneCount("dharma")).toBe(ZONE_CAPACITY - 1);
    expect(world.sim.zoneCount("gatbawi")).toBe(1);

    expect(world.sim.sit("guest", "dharma", ZONE_CAPACITY - 1)).toBe(true);
    world.run(40_000);
    expect(world.sim.zoneCount("dharma")).toBe(ZONE_CAPACITY);
    expect(world.seatProblems()).toEqual([]);

    const guest = world.sim.state.monks.get("guest")!;
    expect(guest.seatId).toBe(ZONE_CAPACITY - 1);
    expect(world.holder("dharma", ZONE_CAPACITY - 1)).toBe("guest");
  });
});

const BASE: Persona = { devotion: 1, restless: 0.5, sociability: 0, shyness: 0, frontRow: 0.5 };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
// The front half of the mats is the five rows nearest the statue; a mat three rows back is out of earshot of mat 2.
const FRONT_SEATS = GATBAWI_SEATS.filter((spot) => spot.row < 5).length;
const FAR_SEAT = 17;

function bowedBack(seed: number, persona: Persona, guestSeat: number): number | null {
  const world = new World(seed, { npcCount: 1, personas: [persona] });
  const npc = world.npcs()[0]!;
  const guest = world.sim.join("guest", 0);
  Object.assign(npc, PLAZA_SPOT);
  world.sim.sit("npc-1", "gatbawi", 2);
  world.sim.sit("guest", "gatbawi", guestSeat);
  world.run(18_000);
  if (npc.mode !== "kneel" || guest.mode !== "kneel") return null;

  const before = npc.bowCount;
  expect(world.sim.bow("guest", 1)).toBe(true);
  world.run(10_000);
  expect(world.seatProblems()).toEqual([]);
  return npc.bowCount - before;
}

describe("npc sociability", () => {
  it("bows back at a visitor's bow from the next mat", () => {
    const sociable: Persona = { ...BASE, sociability: 0.9 };
    const answers = SEEDS.map((seed) => bowedBack(seed, sociable, 1)).filter((answer) => answer !== null);
    expect(answers.length).toBeGreaterThan(SEEDS.length / 2);
    expect(answers.filter((answer) => answer === 1).length).toBeGreaterThan(answers.length / 2);
    expect(answers.every((answer) => answer <= 1)).toBe(true);
  });

  it("stays quiet when it is not sociable or the visitor bows out of earshot", () => {
    for (const seed of SEEDS) {
      expect(bowedBack(seed, { ...BASE, sociability: 0 }, 1) ?? 0).toBe(0);
      expect(bowedBack(seed, { ...BASE, sociability: 1 }, FAR_SEAT) ?? 0).toBe(0);
    }
  });
});

describe("npc shyness and approach", () => {
  const meet = (seed: number, persona: Persona, visitorX: number) => {
    const world = new World(seed, { npcCount: 1, personas: [persona] });
    const npc = world.npcs()[0]!;
    const visitor = world.sim.join("guest", 0);
    npc.x = 0;
    npc.z = 2;
    visitor.x = visitorX;
    visitor.z = 2;
    return { world, npc, visitor, gap: () => Math.hypot(npc.x - visitor.x, npc.z - visitor.z) };
  };

  it("walks away from a visitor standing one metre off", () => {
    let steppedAway = 0;
    for (const seed of SEEDS) {
      const { world, npc, gap } = meet(seed, { ...BASE, shyness: 0.9 }, 1);
      let walking = false;
      let firstWalkGap: number | null = null;
      world.run(7000, () => {
        if (npc.mode === "walk") walking = true;
        else if (walking && firstWalkGap === null) firstWalkGap = gap();
      });
      if (firstWalkGap !== null && firstWalkGap >= 2.9) steppedAway += 1;
    }
    expect(steppedAway).toBeGreaterThan(SEEDS.length * 0.75);
  });

  it("walks up to a visitor a few metres off far more often when it is sociable and not shy", () => {
    // A standing monk gets about one think before it walks off to a mat, and approaches with a 50% chance at most,
    // so the claim is a clear lead over a non-sociable monk across many seeds.
    const approaches = (sociability: number): number => {
      let approached = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const { world, gap } = meet(seed, { ...BASE, sociability }, 2.5);
        let closest = Infinity;
        world.run(8000, () => {
          closest = Math.min(closest, gap());
        });
        if (closest <= 1.6) approached += 1;
      }
      return approached;
    };
    const sociable = approaches(1);
    expect(sociable).toBeGreaterThan(approaches(0) * 1.5);
    expect(sociable).toBeGreaterThan(40 / 2);
  });
});

describe("npc front row preference", () => {
  const sits = (seed: number, persona: Persona, guests = 0): number[] => {
    const world = new World(seed, { npcCount: 1, start: CHANT_START, personas: [persona] });
    for (let n = 0; n < guests; n += 1) {
      world.sim.join(`g${n}`, 0);
      world.sim.sit(`g${n}`, "gatbawi", n);
    }
    const npc = world.npcs()[0]!;
    Object.assign(npc, PLAZA_SPOT);
    const picked: number[] = [];
    let last = -1;
    let ticks = 0;
    world.run(CHANT_MS - 10_000, () => {
      if (npc.seatId >= 0 && npc.seatId !== last && world.seatZoneOf(npc.id) === "gatbawi") picked.push(npc.seatId);
      last = npc.seatId;
      // a prayer now lasts minutes, so rise from the mat every ten seconds to make it choose again
      ticks += 1;
      if (ticks % 200 === 0 && npc.mode === "kneel") world.sim.stand(npc.id);
    });
    return picked;
  };

  it("always picks the front half when it only wants the front", () => {
    const picked = SEEDS.flatMap((seed) => sits(seed, { ...BASE, frontRow: 1 }));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((id) => id < FRONT_SEATS)).toBe(true);
  });

  it("sits in the back half too when it has no preference", () => {
    const picked = SEEDS.flatMap((seed) => sits(seed, { ...BASE, frontRow: 0 }));
    expect(picked.some((id) => id < FRONT_SEATS)).toBe(true);
    expect(picked.some((id) => id >= FRONT_SEATS)).toBe(true);
  });

  it("falls back to the back half once the front half is full", () => {
    const picked = SEEDS.flatMap((seed) => sits(seed, { ...BASE, frontRow: 1 }, FRONT_SEATS));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((id) => id >= FRONT_SEATS)).toBe(true);
  });
});

describe("npc brain reactions", () => {
  function rig(visitorX: number, random: () => number, persona: Persona, start = { x: 0, z: 0 }, seated = true) {
    const body = { id: "npc-1", mode: seated ? "kneel" : "stand", ...start, seatId: seated ? 2 : -1, bowCount: 0 };
    const world: NpcWorld = {
      zone: "gatbawi",
      now: 0,
      random,
      chantEndsAt: null,
      visitors: [{ id: "v", x: visitorX, z: start.z, bowCount: 0 }],
      isFree: () => false,
    };
    const calls = { bows: [] as number[], moves: [] as { x: number; z: number }[], stands: 0 };
    const refuse = { bows: false };
    const actions: NpcActions = {
      move: (_id, x, z) => {
        calls.moves.push({ x, z });
        return true;
      },
      sit: () => true,
      stand: () => {
        calls.stands += 1;
        return true;
      },
      bow: (_id, times) => {
        calls.bows.push(times);
        return !refuse.bows;
      },
    };
    const brain = createNpcBrain(persona, random, 0);
    return {
      body,
      brain,
      calls,
      refuse,
      think: (now: number) => {
        world.now = now;
        thinkNpc(brain, body as NpcBody, world, actions);
      },
      visitorBows: (count: number) => {
        world.visitors = world.visitors.map((visitor): NpcVisitor => ({ ...visitor, bowCount: count }));
      },
    };
  }

  const noPlan = () => 0.99;
  const calm: Persona = { ...BASE, devotion: 0.3, sociability: 1 };

  it("does not greet a visitor whose bows it is only now learning about", () => {
    const { think, calls, visitorBows } = rig(1, noPlan, calm);
    visitorBows(5);
    for (let now = 0; now <= 10_000; now += 500) think(now);
    expect(calls.bows).toEqual([]);
  });

  it("does not greet a bow from beyond earshot", () => {
    const { think, calls, visitorBows } = rig(5, noPlan, calm);
    think(0);
    visitorBows(1);
    for (let now = 500; now <= 10_000; now += 500) think(now);
    expect(calls.bows).toEqual([]);
  });

  it("holds on to a greeting the sim refused and answers it on the next try", () => {
    const { think, calls, visitorBows, refuse, brain } = rig(1, noPlan, calm);
    think(0);
    visitorBows(1);
    refuse.bows = true;
    think(1000);
    think(2000);
    expect(calls.bows).toEqual([]);
    think(3000);
    expect(calls.bows).toEqual([1]);
    expect(brain.nextThinkAt).toBe(3400);
    think(3100);
    expect(calls.bows).toEqual([1]);

    refuse.bows = false;
    think(3400);
    expect(calls.bows).toEqual([1, 1]);
    expect(brain.greetAt).toBe(0);
    think(4400);
    think(5400);
    expect(calls.bows).toEqual([1, 1]);
  });

  it("waits out its settling time before asking for its bows, however often it re-thinks", () => {
    const { think, calls } = rig(1, () => 0.5, BASE);
    think(0);
    for (let now = 250; now < 2000; now += 250) think(now);
    expect(calls.bows).toEqual([]);
    think(2000);
    expect(calls.bows).toEqual([3]);
  });

  describe("a standing monk", () => {
    const other = (zone: Zone): Zone => (zone === "dharma" ? "gatbawi" : "dharma");

    // Every roll is 0.5 unless a list says otherwise, in order, from the first roll the think makes.
    const think = (zone: Zone, options: { rolls?: number[]; chantEndsAt?: number | null; free?: (zone: Zone) => boolean } = {}) => {
      const rolls = [...(options.rolls ?? [])];
      const random = () => rolls.shift() ?? 0.5;
      const sits: [Zone, number][] = [];
      const moves: { x: number; z: number }[] = [];
      const world: NpcWorld = {
        zone,
        now: 0,
        random,
        chantEndsAt: options.chantEndsAt ?? null,
        visitors: [],
        isFree: (seatZone) => options.free?.(seatZone) ?? true,
      };
      const actions: NpcActions = {
        move: (_id, x, z) => {
          moves.push({ x, z });
          return true;
        },
        sit: (_id, seatZone, seatId) => {
          sits.push([seatZone, seatId]);
          return true;
        },
        stand: () => true,
        bow: () => true,
      };
      const brain = createNpcBrain(BASE, () => 0.5, 0);
      thinkNpc(brain, { id: "npc-1", mode: "stand", x: 0, z: 0, seatId: -1, bowCount: 0 }, world, actions);
      return { sits, moves };
    };

    it("asks for a seat in the zone it stands in", () => {
      for (const zone of ZONES) expect(think(zone).sits.map(([seatZone]) => seatZone)).toEqual([zone]);
    });

    it("now and then asks for a seat in the other zone, and walks there to pray", () => {
      for (const zone of ZONES) {
        const { sits } = think(zone, { rolls: [0.1, 0.1] });
        expect(sits.map(([seatZone]) => seatZone)).toEqual([other(zone)]);
      }
    });

    it("takes a seat in the other zone when its own has none free", () => {
      for (const zone of ZONES) {
        const { sits, moves } = think(zone, { free: (seatZone) => seatZone !== zone });
        expect(sits.map(([seatZone]) => seatZone)).toEqual([other(zone)]);
        expect(moves).toEqual([]);
      }
    });

    it("sits down on nearly every think and strolls only on a rare bad roll", () => {
      // BASE sits on any roll under 0.9 + 0.06 * 0.5 + 0.03 = 0.96.
      expect(think("gatbawi", { rolls: [0.9] }).sits).toHaveLength(1);
      expect(think("gatbawi", { rolls: [0.95] }).sits).toHaveLength(1);
      const stroll = think("gatbawi", { rolls: [0.99] });
      expect(stroll.sits).toEqual([]);
      expect(stroll.moves).toHaveLength(1);
    });

    it("sits for certain while the chant is on", () => {
      expect(think("gatbawi", { rolls: [0.99] }).sits).toEqual([]);
      expect(think("gatbawi", { rolls: [0.99], chantEndsAt: 180_000 }).sits).toHaveLength(1);
    });
  });

  it("walks on as usual when a shy retreat would go nowhere because it is cornered", () => {
    const corner = { x: PLAZA_AREA.minX, z: PLAZA_AREA.minZ };
    const { think, calls } = rig(corner.x + 1, () => 0.5, { ...BASE, shyness: 1 }, corner, false);
    think(0);
    expect(calls.moves).toHaveLength(1);
    const [move] = calls.moves;
    expect(Math.hypot(move!.x - corner.x, move!.z - corner.z)).toBeGreaterThan(0.5);
  });

  it("does not count its greeting bow towards the bows it planned before standing up", () => {
    const { think, calls, visitorBows, body } = rig(1, () => 0.5, { ...BASE, sociability: 1 });
    think(0);
    think(2000);
    expect(calls.bows).toEqual([3]);
    visitorBows(1);
    think(3000);
    think(4000);
    expect(calls.bows).toEqual([3, 1]);

    body.bowCount = 3;
    think(100_000);
    think(300_000);
    expect(calls.stands).toBe(0);

    body.bowCount = 4;
    think(300_500);
    expect(calls.stands).toBe(0);
    think(400_000);
    expect(calls.stands).toBe(0);
    think(1_100_000);
    expect(calls.stands).toBe(1);
  });
});

describe("npc personas with visitors around", () => {
  it("keeps one monk per seat over twenty minutes of bowing, sitting and wandering visitors", () => {
    const world = new World(31);
    const choice = seededRandom(77);
    const guests = ["a", "b", "c", "d"];
    for (const id of guests) world.sim.join(id, 0);
    const problems: string[] = [];
    const wasSeated = new Map(world.npcs().map((npc) => [npc.id, false]));
    let ticks = 0;
    let npcSittings = 0;

    world.run(PRAYER_RUN_MS, () => {
      problems.push(...world.seatProblems());
      for (const npc of world.npcs()) {
        const seated = npc.seatId >= 0;
        if (seated && !wasSeated.get(npc.id)) npcSittings += 1;
        wasSeated.set(npc.id, seated);
      }
      ticks += 1;
      if (ticks % 40 !== 0) return;
      const id = guests[Math.floor(choice() * guests.length)]!;
      const roll = choice();
      if (roll < 0.35) world.sim.sit(id, "gatbawi", Math.floor(choice() * GATBAWI_SEATS.length));
      else if (roll < 0.6) world.sim.bow(id, 1 + Math.floor(choice() * 3));
      else if (roll < 0.7) world.sim.stand(id);
      else world.sim.move(id, choice() * 8 - 4, choice() * 6 - 2);
    });

    expect(problems).toEqual([]);
    expect(world.sim.humanCount).toBe(guests.length);
    expect(npcSittings).toBeGreaterThan(NPC_TOTAL);
  });
});
