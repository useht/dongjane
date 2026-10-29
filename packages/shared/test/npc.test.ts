import { describe, expect, it } from "vitest";
import { CHANT_MS, NPC_PER_HALL, TICK_MS } from "../src/constants.ts";
import { WALK_BOUNDS } from "../src/layout.ts";
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

  constructor(seed: number, options: { npcCount?: number; start?: number; random?: () => number } = {}) {
    this.now = options.start ?? QUIET_START;
    this.sim = new TempleSim({
      clock: () => this.now,
      random: options.random ?? seededRandom(seed),
      npcCount: options.npcCount ?? NPC_PER_HALL,
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
