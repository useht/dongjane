import { describe, expect, it } from "vitest";
import { CHANT_MS, NPC_PER_ZONE, TICK_MS, ZONE_CAPACITY } from "../src/constants.ts";
import { GATBAWI_SEATS, ZONES, ZONE_BOUNDS, seatKey, type Zone } from "../src/layout.ts";
import { TempleSim } from "../src/sim.ts";

const CHANT_START = 1_800_000_000_000;
const QUIET_START = CHANT_START + 5 * 60_000;
const NPC_TOTAL = NPC_PER_ZONE * ZONES.length;

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

  constructor(seed: number, options: { npcCount?: number; start?: number; random?: () => number } = {}) {
    this.now = options.start ?? QUIET_START;
    this.sim = new TempleSim({
      clock: () => this.now,
      random: options.random ?? seededRandom(seed),
      npcCount: options.npcCount ?? NPC_PER_ZONE,
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

  seatProblems(): string[] {
    const problems: string[] = [];
    const owners = new Set<string>();
    for (const seat of this.sim.state.seats.values()) {
      if (seat.occupantId === "") continue;
      if (owners.has(seat.occupantId)) problems.push(`${seat.occupantId} holds two seats`);
      owners.add(seat.occupantId);
      const owner = this.sim.state.monks.get(seat.occupantId);
      if (owner?.seatId !== seat.id || owner.zone !== seat.zone) {
        problems.push(`seat ${seat.zone}:${seat.id} points at ${seat.occupantId} who sits elsewhere`);
      }
    }
    for (const monk of this.sim.state.monks.values()) {
      if (monk.seatId >= 0 && this.holder(monk.zone as Zone, monk.seatId) !== monk.id) {
        problems.push(`${monk.id} claims seat ${monk.zone}:${monk.seatId} it does not hold`);
      }
    }
    return problems;
  }

  seatedTicks(ms: number): number {
    let total = 0;
    this.run(ms, () => {
      for (const npc of this.npcs()) if (npc.seatId >= 0 && (npc.mode === "kneel" || npc.mode === "bow")) total += 1;
    });
    return total;
  }
}

function snapshot(world: World): string {
  return [...world.sim.state.monks.values()]
    .map((monk) => [monk.id, monk.zone, monk.mode, monk.seatId, monk.bowCount, monk.x.toFixed(3), monk.z.toFixed(3)].join(":"))
    .join("|");
}

describe("npc spawning", () => {
  it("adds flagged monks to every zone without a slot that do not count as visitors", () => {
    const world = new World(1);
    const npcs = world.npcs();
    expect(npcs).toHaveLength(NPC_TOTAL);
    expect(world.sim.humanCount).toBe(0);
    expect(new Set(npcs.map((npc) => npc.id)).size).toBe(NPC_TOTAL);
    for (const zone of ZONES) {
      expect(npcs.filter((npc) => npc.zone === zone)).toHaveLength(NPC_PER_ZONE);
      expect(world.sim.zoneCount(zone)).toBe(0);
    }
    for (const npc of npcs) {
      const bounds = ZONE_BOUNDS[npc.zone as Zone];
      expect(npc.slot).toBe(0);
      expect(npc.id).toMatch(/^npc-\d+$/);
      expect(npc.mode).toBe("stand");
      expect(npc.hue).toBeGreaterThanOrEqual(0);
      expect(npc.hue).toBeLessThan(360);
      expect(npc.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(npc.x).toBeLessThanOrEqual(bounds.maxX);
      expect(npc.z).toBeGreaterThanOrEqual(bounds.minZ);
      expect(npc.z).toBeLessThanOrEqual(bounds.maxZ);
    }

    const human = world.sim.join("session-1", 10);
    expect(human.npc).toBe(false);
    expect(human.slot).toBe(1);
    expect(world.sim.humanCount).toBe(1);
    expect(world.sim.zoneCount("gatbawi")).toBe(1);
    expect(world.sim.state.monks.size).toBe(NPC_TOTAL + 1);
    world.sim.leave("session-1");
    expect(world.sim.humanCount).toBe(0);
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
  it("lets every npc sit, bow and stand up on its own, finishing each bow plan first", () => {
    const world = new World(7);
    const seen = { walked: 0, sat: 0, bowed: 0, stoodUp: 0, bowsPerSeating: new Set<number>() };
    const before = new Map(world.npcs().map((npc) => [npc.id, { mode: npc.mode, bowsAtSeating: 0 }]));
    const problems: string[] = [];

    world.run(8 * 60_000, () => {
      problems.push(...world.seatProblems());
      for (const npc of world.npcs()) {
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
    expect(seen.walked).toBeGreaterThan(NPC_TOTAL);
    expect(seen.sat).toBeGreaterThan(NPC_TOTAL);
    expect(seen.bowed).toBeGreaterThan(0);
    expect(seen.stoodUp).toBeGreaterThan(NPC_TOTAL);
    expect([...seen.bowsPerSeating].every((count) => [0, 1, 3].includes(count))).toBe(true);
    expect(world.sim.humanCount).toBe(0);
  });

  it("keeps every npc inside the zone it was born in", () => {
    const world = new World(13);
    const born = new Map(world.npcs().map((npc) => [npc.id, npc.zone]));
    world.run(3 * 60_000, () => {
      for (const npc of world.npcs()) {
        const bounds = ZONE_BOUNDS[npc.zone as Zone];
        expect(npc.zone).toBe(born.get(npc.id));
        expect(npc.x).toBeGreaterThanOrEqual(bounds.minX - 1e-4);
        expect(npc.x).toBeLessThanOrEqual(bounds.maxX + 1e-4);
        expect(npc.z).toBeGreaterThanOrEqual(bounds.minZ - 1e-4);
        expect(npc.z).toBeLessThanOrEqual(bounds.maxZ + 1e-4);
      }
    });
  });

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
    expect(new Set(world.npcs().map((npc) => `${npc.zone}:${npc.x.toFixed(2)},${npc.z.toFixed(2)}`)).size).toBe(NPC_TOTAL);
  });

  it("sits more while the chant is on", () => {
    let chant = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 5; seed += 1) {
      const during = new World(seed, { start: CHANT_START });
      expect(during.sim.state.chant.startsAt).toBe(CHANT_START);
      chant += during.seatedTicks(CHANT_MS - 10_000);
      quiet += new World(seed, { start: QUIET_START }).seatedTicks(CHANT_MS - 10_000);
    }
    expect(chant).toBeGreaterThan(quiet * 1.2);
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
        const held = world.npcs().filter((npc) => npc.zone === "gatbawi" && npc.seatId >= 0);
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
    const zone = npc.zone as Zone;
    const seatId = npc.seatId;

    world.sim.join("guest", 0, zone);
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

  it("never lets an npc take a seat that anyone holds or one in another zone", () => {
    const world = new World(5, { npcCount: 2 });
    world.sim.join("guest", 0);
    expect(world.sim.sit("guest", "gatbawi", 0)).toBe(true);
    expect(world.sim.sit("npc-1", "gatbawi", 0)).toBe(false);
    expect(world.holder("gatbawi", 0)).toBe("guest");

    expect(world.sim.sit("npc-1", "gatbawi", 3)).toBe(true);
    expect(world.sim.sit("npc-2", "gatbawi", 3)).toBe(false);
    expect(world.holder("gatbawi", 3)).toBe("npc-1");
    expect(world.sim.state.monks.get("npc-2")?.seatId).toBe(-1);

    expect(world.sim.state.monks.get("npc-3")?.zone).toBe("dharma");
    expect(world.sim.sit("npc-3", "gatbawi", 5)).toBe(false);
    expect(world.sim.sit("npc-3", "dharma", 5)).toBe(true);

    world.sim.join("second", 0);
    expect(world.sim.sit("second", "gatbawi", 0)).toBe(false);
    expect(world.seatProblems()).toEqual([]);
  });

  it("does not count npcs toward a zone's capacity, and gives a newcomer a seat an npc leaves", () => {
    const world = new World(5);
    world.sim.join("guest", 0);
    for (let n = 1; n < ZONE_CAPACITY; n += 1) {
      world.sim.join(`s${n}`, 0, "dharma");
      expect(world.sim.sit(`s${n}`, "dharma", n - 1)).toBe(true);
    }
    expect(world.sim.zoneCount("dharma")).toBe(ZONE_CAPACITY - 1);
    expect(world.sim.chooseZone("dharma")).toEqual({ zone: "dharma", redirected: false });

    world.now += 5_000;
    expect(world.sim.changeZone("guest", "dharma")).toBe("moved");
    expect(world.sim.zoneCount("dharma")).toBe(ZONE_CAPACITY);
    expect(world.sim.chooseZone("dharma")).toEqual({ zone: "gatbawi", redirected: true });
    expect(world.seatProblems()).toEqual([]);

    const guest = world.sim.state.monks.get("guest")!;
    expect(guest.seatId).toBe(ZONE_CAPACITY - 1);
  });
});
