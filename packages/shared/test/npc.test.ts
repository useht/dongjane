import { describe, expect, it } from "vitest";
import { CHANT_MS, NPC_PER_HALL, TICK_MS } from "../src/constants.ts";
import { WALK_BOUNDS } from "../src/layout.ts";
import { type NpcActions, type NpcBody, type NpcVisitor, type NpcWorld, createNpcBrain, thinkNpc } from "../src/npc.ts";
import type { Persona } from "../src/persona.ts";
import { TempleSim } from "../src/sim.ts";

const CHANT_START = 1_800_000_000_000;
const QUIET_START = CHANT_START + 5 * 60_000;

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

class Hall {
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
      npcCount: options.npcCount ?? NPC_PER_HALL,
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

  cushionProblems(): string[] {
    const problems: string[] = [];
    const owners = new Set<string>();
    for (const cushion of this.sim.state.cushions.values()) {
      if (cushion.occupantId === "") continue;
      if (owners.has(cushion.occupantId)) problems.push(`${cushion.occupantId} holds two cushions`);
      owners.add(cushion.occupantId);
      if (this.sim.state.monks.get(cushion.occupantId)?.cushionId !== cushion.id) {
        problems.push(`cushion ${cushion.id} points at ${cushion.occupantId} who sits elsewhere`);
      }
    }
    for (const monk of this.sim.state.monks.values()) {
      if (monk.cushionId >= 0 && this.sim.state.cushions.get(String(monk.cushionId))?.occupantId !== monk.id) {
        problems.push(`${monk.id} claims cushion ${monk.cushionId} it does not hold`);
      }
    }
    return problems;
  }

  seatedTicks(ms: number): number {
    let total = 0;
    this.run(ms, () => {
      for (const npc of this.npcs()) if (npc.cushionId >= 0 && (npc.mode === "kneel" || npc.mode === "bow")) total += 1;
    });
    return total;
  }
}

function snapshot(hall: Hall): string {
  return [...hall.sim.state.monks.values()]
    .map((monk) => [monk.id, monk.mode, monk.cushionId, monk.bowCount, monk.x.toFixed(3), monk.z.toFixed(3)].join(":"))
    .join("|");
}

describe("npc spawning", () => {
  it("adds flagged monks without a seat number that do not count as visitors", () => {
    const hall = new Hall(1);
    const npcs = hall.npcs();
    expect(npcs).toHaveLength(NPC_PER_HALL);
    expect(hall.sim.humanCount).toBe(0);
    expect(new Set(npcs.map((npc) => npc.id)).size).toBe(NPC_PER_HALL);
    for (const npc of npcs) {
      expect(npc.slot).toBe(0);
      expect(npc.id).toMatch(/^npc-\d+$/);
      expect(npc.mode).toBe("stand");
      expect(npc.hue).toBeGreaterThanOrEqual(0);
      expect(npc.hue).toBeLessThan(360);
      expect(npc.x).toBeGreaterThanOrEqual(WALK_BOUNDS.minX);
      expect(npc.x).toBeLessThanOrEqual(WALK_BOUNDS.maxX);
      expect(npc.z).toBeGreaterThanOrEqual(WALK_BOUNDS.minZ);
      expect(npc.z).toBeLessThanOrEqual(WALK_BOUNDS.maxZ);
    }

    const human = hall.sim.join("session-1", 10);
    expect(human.npc).toBe(false);
    expect(human.slot).toBe(1);
    expect(hall.sim.humanCount).toBe(1);
    expect(hall.sim.state.monks.size).toBe(NPC_PER_HALL + 1);
    hall.sim.leave("session-1");
    expect(hall.sim.humanCount).toBe(0);
  });

  it("spawns nobody and draws no randomness unless asked to", () => {
    let draws = 0;
    const hall = new Hall(1, {
      npcCount: 0,
      random: () => {
        draws += 1;
        return 0.5;
      },
    });
    hall.run(60_000);
    expect(hall.sim.state.monks.size).toBe(0);
    expect(draws).toBe(0);
  });
});

describe("npc behaviour", () => {
  it("lets every npc sit, bow and stand up on its own, finishing each bow plan first", () => {
    const hall = new Hall(7);
    const seen = { walked: 0, sat: 0, bowed: 0, stoodUp: 0, bowsPerSeating: new Set<number>() };
    const before = new Map(hall.npcs().map((npc) => [npc.id, { mode: npc.mode, bowsAtSeating: 0 }]));
    const problems: string[] = [];

    hall.run(8 * 60_000, () => {
      problems.push(...hall.cushionProblems());
      for (const npc of hall.npcs()) {
        const last = before.get(npc.id)!;
        if (npc.mode === "walk" && last.mode !== "walk") seen.walked += 1;
        if (npc.mode === "kneel" && last.mode !== "kneel" && last.mode !== "bow") {
          seen.sat += 1;
          last.bowsAtSeating = npc.bowCount;
        }
        if (npc.mode === "bow" && last.mode !== "bow") seen.bowed += 1;
        if (npc.mode === "stand" && (last.mode === "kneel" || last.mode === "bow")) {
          seen.stoodUp += 1;
          seen.bowsPerSeating.add(npc.bowCount - last.bowsAtSeating);
        }
        last.mode = npc.mode;
      }
    });

    expect(problems).toEqual([]);
    expect(seen.walked).toBeGreaterThan(NPC_PER_HALL);
    expect(seen.sat).toBeGreaterThan(NPC_PER_HALL);
    expect(seen.bowed).toBeGreaterThan(0);
    expect(seen.stoodUp).toBeGreaterThan(NPC_PER_HALL);
    expect([...seen.bowsPerSeating].every((count) => [0, 1, 3].includes(count))).toBe(true);
    expect(hall.sim.humanCount).toBe(0);
  });

  it("gives each npc its own rhythm instead of moving in lockstep", () => {
    const hall = new Hall(11);
    const firstMove = new Map<string, number>();
    hall.run(10_000, () => {
      for (const npc of hall.npcs()) {
        if (npc.mode !== "stand" && !firstMove.has(npc.id)) firstMove.set(npc.id, hall.now);
      }
    });
    expect(firstMove.size).toBe(NPC_PER_HALL);
    expect(new Set(firstMove.values()).size).toBeGreaterThan(NPC_PER_HALL / 2);

    hall.run(50_000);
    expect(new Set(hall.npcs().map((npc) => `${npc.x.toFixed(2)},${npc.z.toFixed(2)}`)).size).toBe(NPC_PER_HALL);
  });

  it("sits more while the chant is on", () => {
    let chant = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 5; seed += 1) {
      const during = new Hall(seed, { start: CHANT_START });
      expect(during.sim.state.chant.startsAt).toBe(CHANT_START);
      chant += during.seatedTicks(CHANT_MS - 10_000);
      quiet += new Hall(seed, { start: QUIET_START }).seatedTicks(CHANT_MS - 10_000);
    }
    expect(chant).toBeGreaterThan(quiet * 1.2);
  });

  it("repeats the same day for the same seed and a different one for another", () => {
    const trace = (seed: number) => {
      const hall = new Hall(seed);
      hall.sim.join("guest", 40);
      const frames: string[] = [];
      hall.run(90_000, () => frames.push(snapshot(hall)));
      return frames;
    };
    expect(trace(3)).toEqual(trace(3));
    expect(trace(3)).not.toEqual(trace(4));
  });
});

describe("npc and visitor cushions", () => {
  it("keeps one monk per cushion while visitors and npcs fight over seats", () => {
    const hall = new Hall(21);
    const visitorChoice = seededRandom(99);
    const guests = ["a", "b", "c", "d"];
    for (const id of guests) hall.sim.join(id, 0);
    const problems: string[] = [];
    let ticks = 0;
    let seatedTicks = 0;
    let refusals = 0;

    hall.run(6 * 60_000, () => {
      problems.push(...hall.cushionProblems());
      if (guests.some((id) => hall.sim.state.monks.get(id)!.cushionId >= 0)) seatedTicks += 1;
      ticks += 1;
      if (ticks % 40 !== 0) return;
      const id = guests[Math.floor(visitorChoice() * guests.length)]!;
      const roll = visitorChoice();
      if (roll < 0.7) {
        const cushionId = Math.floor(visitorChoice() * 8);
        const cushion = hall.sim.state.cushions.get(String(cushionId))!;
        const holder = hall.sim.state.monks.get(cushion.occupantId);
        if (!holder?.npc) {
          hall.sim.sit(id, cushionId);
          return;
        }
        const guestCushion = hall.sim.state.monks.get(id)!.cushionId;
        expect(hall.sim.sit(id, cushionId)).toBe(false);
        refusals += 1;
        expect(cushion.occupantId).toBe(holder.id);
        expect(holder.cushionId).toBe(cushionId);
        expect(hall.sim.state.monks.get(id)!.cushionId).toBe(guestCushion);
      } else if (roll < 0.85) hall.sim.stand(id);
      else hall.sim.move(id, visitorChoice() * 8 - 4, visitorChoice() * 6 - 2);
    });

    expect(problems).toEqual([]);
    expect(hall.sim.humanCount).toBe(guests.length);
    expect(seatedTicks).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
  });

  it("refuses a visitor who sits where an npc already is, and the npc stays put", () => {
    const hall = new Hall(5);
    hall.run(60_000);
    const seated = hall.npcs().find((npc) => npc.cushionId >= 0);
    expect(seated).toBeDefined();
    const npc = seated!;
    const cushionId = npc.cushionId;
    const { mode } = npc;

    hall.sim.join("guest", 0);
    expect(hall.sim.sit("guest", cushionId)).toBe(false);
    expect(hall.sim.state.cushions.get(String(cushionId))?.occupantId).toBe(npc.id);
    expect(npc.cushionId).toBe(cushionId);
    expect(npc.mode).toBe(mode);
    expect(hall.sim.state.monks.get("guest")?.cushionId).toBe(-1);
    expect(hall.cushionProblems()).toEqual([]);

    const problems: string[] = [];
    const modes = new Set<string>();
    hall.run(90_000, () => {
      problems.push(...hall.cushionProblems());
      modes.add(npc.mode);
      const holder = hall.sim.state.cushions.get(String(cushionId))?.occupantId;
      if (npc.cushionId === cushionId) expect(holder).toBe(npc.id);
      expect(holder).not.toBe("guest");
    });
    expect(problems).toEqual([]);
    expect(modes.has("walk")).toBe(true);
  });

  it("never lets an npc take a cushion that anyone holds", () => {
    const hall = new Hall(5, { npcCount: 2 });
    hall.sim.join("guest", 0);
    expect(hall.sim.sit("guest", 0)).toBe(true);
    expect(hall.sim.sit("npc-1", 0)).toBe(false);
    expect(hall.sim.state.cushions.get("0")?.occupantId).toBe("guest");

    expect(hall.sim.sit("npc-1", 3)).toBe(true);
    expect(hall.sim.sit("npc-2", 3)).toBe(false);
    expect(hall.sim.state.cushions.get("3")?.occupantId).toBe("npc-1");
    expect(hall.sim.state.monks.get("npc-2")?.cushionId).toBe(-1);

    hall.sim.join("second", 0);
    expect(hall.sim.sit("second", 0)).toBe(false);
    expect(hall.cushionProblems()).toEqual([]);
  });
});

const BASE: Persona = { devotion: 1, restless: 0.5, sociability: 0, shyness: 0, frontRow: 0.5 };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function bowedBack(seed: number, persona: Persona, guestCushion: number): number | null {
  const hall = new Hall(seed, { npcCount: 1, personas: [persona] });
  const npc = hall.npcs()[0]!;
  const guest = hall.sim.join("guest", 0);
  hall.sim.sit("npc-1", 2);
  hall.sim.sit("guest", guestCushion);
  hall.run(18_000);
  if (npc.mode !== "kneel" || guest.mode !== "kneel") return null;

  const before = npc.bowCount;
  expect(hall.sim.bow("guest", 1)).toBe(true);
  hall.run(10_000);
  expect(hall.cushionProblems()).toEqual([]);
  return npc.bowCount - before;
}

describe("npc sociability", () => {
  it("bows back at a visitor's bow from the next cushion", () => {
    const sociable: Persona = { ...BASE, sociability: 0.9 };
    const answers = SEEDS.map((seed) => bowedBack(seed, sociable, 1)).filter((answer) => answer !== null);
    expect(answers.length).toBeGreaterThan(SEEDS.length / 2);
    expect(answers.filter((answer) => answer === 1).length).toBeGreaterThan(answers.length / 2);
    expect(answers.every((answer) => answer <= 1)).toBe(true);
  });

  it("stays quiet when it is not sociable or the visitor bows out of earshot", () => {
    for (const seed of SEEDS) {
      expect(bowedBack(seed, { ...BASE, sociability: 0 }, 1) ?? 0).toBe(0);
      expect(bowedBack(seed, { ...BASE, sociability: 1 }, 4) ?? 0).toBe(0);
    }
  });
});

describe("npc shyness and approach", () => {
  const meet = (seed: number, persona: Persona, visitorX: number) => {
    const hall = new Hall(seed, { npcCount: 1, personas: [persona] });
    const npc = hall.npcs()[0]!;
    const visitor = hall.sim.join("guest", 0);
    npc.x = 0;
    npc.z = 2;
    visitor.x = visitorX;
    visitor.z = 2;
    return { hall, npc, visitor, gap: () => Math.hypot(npc.x - visitor.x, npc.z - visitor.z) };
  };

  it("walks away from a visitor standing one metre off", () => {
    let steppedAway = 0;
    for (const seed of SEEDS) {
      const { hall, npc, gap } = meet(seed, { ...BASE, shyness: 0.9 }, 1);
      let walking = false;
      let firstWalkGap: number | null = null;
      hall.run(7000, () => {
        if (npc.mode === "walk") walking = true;
        else if (walking && firstWalkGap === null) firstWalkGap = gap();
      });
      if (firstWalkGap !== null && firstWalkGap >= 2.9) steppedAway += 1;
    }
    expect(steppedAway).toBeGreaterThan(SEEDS.length * 0.75);
  });

  it("walks up to a visitor a few metres off when it is sociable and not shy", () => {
    let approached = 0;
    for (const seed of SEEDS) {
      const { hall, gap } = meet(seed, { ...BASE, sociability: 1 }, 2.5);
      let closest = Infinity;
      hall.run(8000, () => {
        closest = Math.min(closest, gap());
      });
      if (closest <= 1.6) approached += 1;
    }
    expect(approached).toBeGreaterThan(SEEDS.length * 0.75);
  });
});

describe("npc front row preference", () => {
  const sits = (seed: number, persona: Persona, guests = 0): number[] => {
    const hall = new Hall(seed, { npcCount: 1, start: CHANT_START, personas: [persona] });
    for (let n = 0; n < guests; n += 1) {
      hall.sim.join(`g${n}`, 0);
      hall.sim.sit(`g${n}`, n);
    }
    const npc = hall.npcs()[0]!;
    const picked: number[] = [];
    let last = -1;
    hall.run(CHANT_MS - 10_000, () => {
      if (npc.cushionId >= 0 && npc.cushionId !== last) picked.push(npc.cushionId);
      last = npc.cushionId;
    });
    return picked;
  };

  it("always picks the row nearest the Buddha when it only wants the front", () => {
    const picked = SEEDS.flatMap((seed) => sits(seed, { ...BASE, frontRow: 1 }));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((id) => id <= 3)).toBe(true);
  });

  it("sits in the back row too when it has no preference", () => {
    const picked = SEEDS.flatMap((seed) => sits(seed, { ...BASE, frontRow: 0 }));
    expect(picked.some((id) => id <= 3)).toBe(true);
    expect(picked.some((id) => id >= 4)).toBe(true);
  });

  it("falls back to the back row once the front row is full", () => {
    const picked = SEEDS.flatMap((seed) => sits(seed, { ...BASE, frontRow: 1 }, 4));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((id) => id >= 4)).toBe(true);
  });
});

describe("npc brain reactions", () => {
  function rig(visitorX: number, random: () => number, persona: Persona, start = { x: 0, z: 0 }, seated = true) {
    const body = { id: "npc-1", mode: seated ? "kneel" : "stand", ...start, cushionId: seated ? 2 : -1, bowCount: 0 };
    const world: NpcWorld = {
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

  it("walks on as usual when a shy retreat would go nowhere because it is cornered", () => {
    const corner = { x: -5, z: -3 };
    const { think, calls } = rig(-4, () => 0.5, { ...BASE, shyness: 1 }, corner, false);
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
    expect(calls.stands).toBe(1);
  });
});

describe("npc personas with visitors around", () => {
  it("keeps one monk per cushion over six minutes of bowing, sitting and wandering visitors", () => {
    const hall = new Hall(31);
    const choice = seededRandom(77);
    const guests = ["a", "b", "c", "d"];
    for (const id of guests) hall.sim.join(id, 0);
    const problems: string[] = [];
    const wasSeated = new Map(hall.npcs().map((npc) => [npc.id, false]));
    let ticks = 0;
    let npcSittings = 0;

    hall.run(6 * 60_000, () => {
      problems.push(...hall.cushionProblems());
      for (const npc of hall.npcs()) {
        const seated = npc.cushionId >= 0;
        if (seated && !wasSeated.get(npc.id)) npcSittings += 1;
        wasSeated.set(npc.id, seated);
      }
      ticks += 1;
      if (ticks % 40 !== 0) return;
      const id = guests[Math.floor(choice() * guests.length)]!;
      const roll = choice();
      if (roll < 0.35) hall.sim.sit(id, Math.floor(choice() * 8));
      else if (roll < 0.6) hall.sim.bow(id, 1 + Math.floor(choice() * 3));
      else if (roll < 0.7) hall.sim.stand(id);
      else hall.sim.move(id, choice() * 8 - 4, choice() * 6 - 2);
    });

    expect(problems).toEqual([]);
    expect(hall.sim.humanCount).toBe(guests.length);
    expect(npcSittings).toBeGreaterThan(0);
  });
});
