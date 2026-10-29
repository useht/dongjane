import { beforeEach, describe, expect, it } from "vitest";
import {
  BOW_COOLDOWN_MS,
  BOW_MS,
  CHANT_EVERY_MS,
  CHANT_MS,
  EMOTE_COOLDOWN_MS,
  JUMP_COOLDOWN_MS,
  TICK_MS,
  WALK_SPEED,
  WORLD_CAPACITY,
  ZONE_CAPACITY,
  ZONE_COOLDOWN_MS,
} from "../src/constants.ts";
import { EMOTE_COUNT } from "../src/emote.ts";
import { DHARMA_BOUNDS, DHARMA_SEATS, GATBAWI_SEATS, SEAT_COUNT, WORLD_BOUNDS, ZONE_SPAWN, type Zone } from "../src/layout.ts";
import { TempleSim } from "../src/sim.ts";

const T0 = 1_800_000_000_000;

class Harness {
  now = T0;
  readonly sim = new TempleSim({ clock: () => this.now, random: () => 0.5 });

  advance(ms: number): void {
    let left = ms;
    while (left > 0) {
      const step = Math.min(TICK_MS, left);
      this.now += step;
      this.sim.tick(step);
      left -= step;
    }
  }

  seat(id: string, seatId: number): void {
    this.sim.join(id, 10);
    expect(this.sim.sit(id, "gatbawi", seatId)).toBe(true);
    this.advance(8000);
    expect(this.sim.state.monks.get(id)?.mode).toBe("kneel");
  }

  monk(id: string) {
    const monk = this.sim.state.monks.get(id);
    if (!monk) throw new Error(`no monk ${id}`);
    return monk;
  }

  mat(id: number, zone: Zone = "gatbawi") {
    const seat = this.sim.state.seats.get(`${zone}:${id}`);
    if (!seat) throw new Error(`no seat ${zone}:${id}`);
    return seat;
  }

  fill(zone: Zone, count: number): void {
    for (let i = 0; i < count; i += 1) this.sim.join(`${zone}${i}`, i, zone);
  }
}

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe("join and movement", () => {
  it("creates a hundred free seats and spawns monks standing at the entrance of Gatbawi", () => {
    expect(h.sim.state.seats.size).toBe(2 * SEAT_COUNT);
    expect([...h.sim.state.seats.values()].every((seat) => seat.occupantId === "")).toBe(true);
    expect(h.sim.state.seats.get("gatbawi:49")?.zone).toBe("gatbawi");
    expect(h.sim.state.seats.get("dharma:0")?.zone).toBe("dharma");
    h.sim.join("a", 120);
    const a = h.monk("a");
    expect(a.mode).toBe("stand");
    expect(a.zone).toBe("gatbawi");
    expect(a.x).toBe(ZONE_SPAWN.gatbawi.x);
    expect(a.z).toBe(ZONE_SPAWN.gatbawi.z);
    expect(a.seatId).toBe(-1);
    expect(a.bowCount).toBe(0);
    expect(a.hue).toBe(120);
  });

  it("walks toward the target at WALK_SPEED and then stands", () => {
    h.sim.join("a", 0);
    const startZ = h.monk("a").z;
    expect(h.sim.move("a", h.monk("a").x, startZ - 4)).toBe(true);
    expect(h.monk("a").mode).toBe("walk");
    h.advance(1000);
    expect(startZ - h.monk("a").z).toBeCloseTo(WALK_SPEED, 1);
    h.advance(1000);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").z).toBeCloseTo(startZ - 4, 4);
    expect(h.monk("a").yaw).toBeCloseTo(0, 4);
  });

  it("clamps targets to the walkable rect", () => {
    h.sim.join("a", 0);
    h.sim.move("a", 500, -500);
    h.advance(30_000);
    expect(h.monk("a").x).toBeCloseTo(WORLD_BOUNDS.maxX, 4);
    expect(h.monk("a").z).toBeCloseTo(WORLD_BOUNDS.minZ, 4);
  });

  it("ignores non-finite targets and unknown ids", () => {
    h.sim.join("a", 0);
    expect(h.sim.move("a", Number.NaN, 0)).toBe(false);
    expect(h.sim.move("a", 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(h.sim.move("ghost", 0, 0)).toBe(false);
    expect(h.monk("a").mode).toBe("stand");
  });

  it("acks the highest move seq it has seen, never going backwards", () => {
    h.sim.join("a", 0);
    expect(h.monk("a").ackSeq).toBe(0);
    h.sim.move("a", 0, 3, 5);
    expect(h.monk("a").ackSeq).toBe(5);
    h.sim.move("a", 0, 2, 3);
    expect(h.monk("a").ackSeq).toBe(5);
    h.sim.move("a", 0, 1, 9);
    expect(h.monk("a").ackSeq).toBe(9);
    h.sim.move("a", 0, 1);
    expect(h.monk("a").ackSeq).toBe(9);
  });

  it("advances the ack even when the move itself is ignored", () => {
    h.sim.join("a", 0);
    const { x, z } = h.monk("a");
    expect(h.sim.move("a", Number.NaN, 0, 4)).toBe(false);
    expect(h.monk("a").ackSeq).toBe(4);
    expect(h.sim.move("a", 0, Number.POSITIVE_INFINITY, 6)).toBe(false);
    expect(h.monk("a").ackSeq).toBe(6);
    expect(h.monk("a").mode).toBe("stand");
    expect([h.monk("a").x, h.monk("a").z]).toEqual([x, z]);
    expect(h.sim.move("ghost", 0, 0, 8)).toBe(false);
  });

  it("acks a move that only snaps the monk onto where it already stands", () => {
    h.sim.join("a", 0);
    const { x, z } = h.monk("a");
    expect(h.sim.move("a", x, z, 2)).toBe(true);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").ackSeq).toBe(2);
  });

  it("acks a move together with the walk it starts, in the same state", () => {
    h.sim.join("a", 0);
    h.sim.move("a", h.monk("a").x, h.monk("a").z - 2, 11);
    expect(h.monk("a").ackSeq).toBe(11);
    expect(h.monk("a").mode).toBe("walk");
    h.advance(2000);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").ackSeq).toBe(11);
  });
});

describe("server clock", () => {
  it("starts at the sim clock and advances with every tick", () => {
    expect(h.sim.state.serverTime).toBe(T0);
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      h.advance(TICK_MS);
      seen.push(h.sim.state.serverTime);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5].map((n) => T0 + n * TICK_MS));
  });

  it("stamps monk positions with the time they were computed at", () => {
    h.sim.join("a", 0);
    const startZ = h.monk("a").z;
    h.sim.move("a", h.monk("a").x, startZ - 4);
    h.advance(1000);
    expect(h.sim.state.serverTime).toBe(T0 + 1000);
    expect(startZ - h.monk("a").z).toBeCloseTo((WALK_SPEED * (h.sim.state.serverTime - T0)) / 1000, 4);
  });
});

describe("seats", () => {
  it("claims a mat, walks over, and kneels facing Gatbawi", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", "gatbawi", 5)).toBe(true);
    expect(h.mat(5).occupantId).toBe("a");
    expect(h.monk("a").mode).toBe("walk");
    h.advance(8000);
    const spot = GATBAWI_SEATS[5]!;
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").x).toBeCloseTo(spot.x, 4);
    expect(h.monk("a").z).toBeCloseTo(spot.z, 4);
    expect(h.monk("a").yaw).toBe(0);
    expect(h.monk("a").seatId).toBe(5);
  });

  it("seats fifty visitors in each zone, each kneeling on a seat of their own", () => {
    for (const zone of ["gatbawi", "dharma"] as const) {
      const seats = zone === "gatbawi" ? GATBAWI_SEATS : DHARMA_SEATS;
      for (let i = 0; i < ZONE_CAPACITY; i += 1) {
        const monk = h.sim.join(`${zone}${i}`, i * 7, zone);
        expect(monk.zone).toBe(zone);
        expect(h.sim.sit(monk.id, zone, i)).toBe(true);
      }
      h.advance(12_000);
      for (let i = 0; i < ZONE_CAPACITY; i += 1) {
        const monk = h.monk(`${zone}${i}`);
        const spot = seats[i]!;
        expect(monk.mode).toBe("kneel");
        expect(monk.yaw).toBe(0);
        expect(monk.x).toBeCloseTo(spot.x, 4);
        expect(monk.z).toBeCloseTo(spot.z, 4);
        expect(h.mat(monk.seatId, zone).occupantId).toBe(monk.id);
      }
    }
    expect(h.sim.state.monks.size).toBe(WORLD_CAPACITY);
    expect([...h.sim.state.seats.values()].every((seat) => seat.occupantId !== "")).toBe(true);
    expect(new Set(Array.from(h.sim.state.monks.values(), (monk) => monk.slot)).size).toBe(WORLD_CAPACITY);
  });

  it("gives a contested seat to exactly one monk", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    const results = [h.sim.sit("a", "gatbawi", 2), h.sim.sit("b", "gatbawi", 2)];
    expect(results).toEqual([true, false]);
    expect(h.mat(2).occupantId).toBe("a");
    expect(h.monk("b").seatId).toBe(-1);
  });

  it("keeps the same seat number in the two zones apart", () => {
    h.sim.join("a", 0, "gatbawi");
    h.sim.join("b", 0, "dharma");
    expect(h.sim.sit("a", "gatbawi", 7)).toBe(true);
    expect(h.sim.sit("b", "dharma", 7)).toBe(true);
    expect(h.mat(7, "gatbawi").occupantId).toBe("a");
    expect(h.mat(7, "dharma").occupantId).toBe("b");
  });

  it("ignores a seat in the other zone", () => {
    h.sim.join("a", 0, "gatbawi");
    expect(h.sim.sit("a", "dharma", 3)).toBe(false);
    expect(h.mat(3, "dharma").occupantId).toBe("");
    expect(h.monk("a").seatId).toBe(-1);
    expect(h.monk("a").mode).toBe("stand");
  });

  it("keeps a seated monk where they are when the seat they ask for is taken", () => {
    h.seat("a", 0);
    h.seat("b", 1);
    expect(h.sim.sit("a", "gatbawi", 1)).toBe(false);
    expect(h.mat(0).occupantId).toBe("a");
    expect(h.mat(1).occupantId).toBe("b");
    expect(h.monk("a").seatId).toBe(0);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("b").seatId).toBe(1);
  });

  it("rejects invalid seat ids", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", "gatbawi", SEAT_COUNT)).toBe(false);
    expect(h.sim.sit("a", "gatbawi", -1)).toBe(false);
    expect(h.sim.sit("a", "gatbawi", 1.5)).toBe(false);
    expect(h.sim.sit("ghost", "gatbawi", 1)).toBe(false);
  });

  it("frees the old seat when moving to another", () => {
    h.seat("a", 0);
    expect(h.sim.sit("a", "gatbawi", 1)).toBe(true);
    expect(h.mat(0).occupantId).toBe("");
    expect(h.mat(1).occupantId).toBe("a");
  });

  it("frees the seat on stand", () => {
    h.seat("a", 3);
    expect(h.sim.stand("a")).toBe(true);
    expect(h.mat(3).occupantId).toBe("");
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").seatId).toBe(-1);
    h.sim.join("b", 0);
    expect(h.sim.sit("b", "gatbawi", 3)).toBe(true);
  });

  it("frees the seat when the monk walks away", () => {
    h.seat("a", 4);
    h.sim.move("a", 0, 4);
    expect(h.mat(4).occupantId).toBe("");
    expect(h.monk("a").seatId).toBe(-1);
    expect(h.monk("a").mode).toBe("walk");
  });

  it("frees the seat when the monk leaves, even mid-walk", () => {
    h.sim.join("a", 0);
    h.sim.sit("a", "gatbawi", 6);
    h.advance(300);
    h.sim.leave("a");
    expect(h.mat(6).occupantId).toBe("");
    expect(h.sim.state.monks.size).toBe(0);
  });

  it("never leaves two seats owned by one monk or two monks on one seat", () => {
    for (let i = 0; i < 40; i += 1) h.sim.join(`m${i}`, i);
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < 40; i += 1) h.sim.sit(`m${i}`, "gatbawi", (i + round * 3) % 30);
      h.advance(500);
      const owners = new Map<string, number>();
      for (const [, seat] of h.sim.state.seats) {
        if (seat.occupantId === "") continue;
        owners.set(seat.occupantId, (owners.get(seat.occupantId) ?? 0) + 1);
        expect(h.monk(seat.occupantId).seatId).toBe(seat.id);
      }
      for (const count of owners.values()) expect(count).toBe(1);
    }
  });
});

describe("emoticons", () => {
  const setups: Record<string, () => void> = {
    stand: () => h.sim.join("a", 0),
    walk: () => {
      h.sim.join("a", 0);
      h.sim.move("a", h.monk("a").x, h.monk("a").z - 4);
    },
    kneel: () => h.seat("a", 2),
    bow: () => {
      h.seat("a", 2);
      expect(h.sim.bow("a", 1)).toBe(true);
    },
  };

  it.each(Object.keys(setups))("records the emoticon while %s without touching mode, seat or target", (mode) => {
    setups[mode]?.();
    const before = { mode: h.monk("a").mode, seatId: h.monk("a").seatId, x: h.monk("a").x, z: h.monk("a").z };
    expect(before.mode).toBe(mode);
    expect(h.monk("a").emoteSeq).toBe(0);

    expect(h.sim.emote("a", 5)).toBe(true);
    expect(h.monk("a").emote).toBe(5);
    expect(h.monk("a").emoteSeq).toBe(1);
    expect(h.monk("a").mode).toBe(before.mode);
    expect(h.monk("a").seatId).toBe(before.seatId);
    expect([h.monk("a").x, h.monk("a").z]).toEqual([before.x, before.z]);
    if (before.seatId >= 0) expect(h.mat(before.seatId).occupantId).toBe("a");
  });

  it("lets a monk keep walking to its seat after an emoticon and then kneel there", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", "gatbawi", 5)).toBe(true);
    h.advance(300);
    expect(h.sim.emote("a", 1)).toBe(true);
    expect(h.monk("a").mode).toBe("walk");
    h.advance(8000);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").seatId).toBe(5);
    expect(h.mat(5).occupantId).toBe("a");
  });

  it("counts every accepted emoticon and keeps the latest index", () => {
    h.sim.join("a", 0);
    expect(h.sim.emote("a", 0)).toBe(true);
    h.advance(EMOTE_COOLDOWN_MS);
    expect(h.sim.emote("a", 0)).toBe(true);
    h.advance(EMOTE_COOLDOWN_MS);
    expect(h.sim.emote("a", EMOTE_COUNT - 1)).toBe(true);
    expect(h.monk("a").emote).toBe(EMOTE_COUNT - 1);
    expect(h.monk("a").emoteSeq).toBe(3);
  });

  it("rejects a second emoticon inside the cooldown and accepts one once it has passed", () => {
    h.sim.join("a", 0);
    expect(h.sim.emote("a", 2)).toBe(true);
    h.advance(EMOTE_COOLDOWN_MS - TICK_MS);
    expect(h.sim.emote("a", 3)).toBe(false);
    expect(h.monk("a").emote).toBe(2);
    expect(h.monk("a").emoteSeq).toBe(1);

    h.advance(TICK_MS);
    expect(h.sim.emote("a", 3)).toBe(true);
    expect(h.monk("a").emote).toBe(3);
    expect(h.monk("a").emoteSeq).toBe(2);
  });

  it("keeps the cooldown per monk", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    expect(h.sim.emote("a", 1)).toBe(true);
    expect(h.sim.emote("b", 4)).toBe(true);
    expect(h.sim.emote("a", 1)).toBe(false);
    expect(h.monk("b").emoteSeq).toBe(1);
  });

  it("rejects unknown monks and invalid indexes without starting a cooldown", () => {
    h.sim.join("a", 0);
    expect(h.sim.emote("ghost", 0)).toBe(false);
    for (const index of [-1, EMOTE_COUNT, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(h.sim.emote("a", index)).toBe(false);
    }
    expect(h.monk("a").emoteSeq).toBe(0);
    expect(h.sim.emote("a", 0)).toBe(true);
  });

  it("starts every monk with no emoticon sent, and a left monk cannot emote", () => {
    h.sim.join("a", 0);
    expect(h.monk("a").emote).toBe(0);
    expect(h.monk("a").emoteSeq).toBe(0);
    h.sim.leave("a");
    expect(h.sim.emote("a", 0)).toBe(false);
  });

  it("never makes npc monks emote", () => {
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.5, npcCount: 3 });
    for (let t = 0; t < 10 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    const npcs = [...sim.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(6);
    for (const npc of npcs) expect(npc.emoteSeq).toBe(0);
  });
});

describe("jumping", () => {
  it("counts a jump while standing without touching mode, seat or position", () => {
    h.sim.join("a", 0);
    const before = { x: h.monk("a").x, z: h.monk("a").z };
    expect(h.monk("a").jumpSeq).toBe(0);

    expect(h.sim.jump("a")).toBe(true);
    expect(h.monk("a").jumpSeq).toBe(1);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").seatId).toBe(-1);
    expect([h.monk("a").x, h.monk("a").z]).toEqual([before.x, before.z]);
  });

  it("lets a monk jump while walking and keeps the walk going", () => {
    h.sim.join("a", 0);
    h.sim.move("a", h.monk("a").x, h.monk("a").z - 4);
    h.advance(300);
    expect(h.monk("a").mode).toBe("walk");

    expect(h.sim.jump("a")).toBe(true);
    expect(h.monk("a").mode).toBe("walk");
    expect(h.monk("a").jumpSeq).toBe(1);
    h.advance(8000);
    expect(h.monk("a").mode).toBe("stand");
  });

  it.each(["kneel", "bow"])("rejects a jump while %s on a seat", (mode) => {
    h.seat("a", 2);
    if (mode === "bow") expect(h.sim.bow("a", 1)).toBe(true);
    expect(h.monk("a").mode).toBe(mode);

    expect(h.sim.jump("a")).toBe(false);
    expect(h.monk("a").jumpSeq).toBe(0);
    expect(h.monk("a").mode).toBe(mode);
  });

  it("rejects a jump as soon as a seat is claimed, even before arriving", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", "gatbawi", 5)).toBe(true);
    h.advance(300);
    expect(h.monk("a").mode).toBe("walk");
    expect(h.sim.jump("a")).toBe(false);
    expect(h.monk("a").jumpSeq).toBe(0);
  });

  it("jumps again after standing up from a seat", () => {
    h.seat("a", 2);
    expect(h.sim.stand("a")).toBe(true);
    expect(h.sim.jump("a")).toBe(true);
    expect(h.monk("a").jumpSeq).toBe(1);
  });

  it("rejects a second jump inside the cooldown and accepts one once it has passed", () => {
    h.sim.join("a", 0);
    expect(h.sim.jump("a")).toBe(true);
    h.advance(JUMP_COOLDOWN_MS - TICK_MS);
    expect(h.sim.jump("a")).toBe(false);
    expect(h.monk("a").jumpSeq).toBe(1);

    h.advance(TICK_MS);
    expect(h.sim.jump("a")).toBe(true);
    expect(h.monk("a").jumpSeq).toBe(2);
  });

  it("keeps the cooldown per monk", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    expect(h.sim.jump("a")).toBe(true);
    expect(h.sim.jump("b")).toBe(true);
    expect(h.sim.jump("a")).toBe(false);
    expect(h.monk("b").jumpSeq).toBe(1);
  });

  it("rejects unknown and departed monks", () => {
    expect(h.sim.jump("ghost")).toBe(false);
    h.sim.join("a", 0);
    h.sim.leave("a");
    expect(h.sim.jump("a")).toBe(false);
  });

  it("never makes npc monks jump", () => {
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.5, npcCount: 3 });
    for (let t = 0; t < 10 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    const npcs = [...sim.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(6);
    for (const npc of npcs) expect(npc.jumpSeq).toBe(0);
  });
});

describe("bowing", () => {
  it("rejects bows unless kneeling on a mat", () => {
    h.sim.join("a", 0);
    expect(h.sim.bow("a", 1)).toBe(false);
    h.sim.sit("a", "gatbawi", 0);
    expect(h.sim.bow("a", 1)).toBe(false);
    expect(h.monk("a").mode).toBe("walk");
  });

  it("rejects invalid bow counts", () => {
    h.seat("a", 0);
    expect(h.sim.bow("a", 0)).toBe(false);
    expect(h.sim.bow("a", 4)).toBe(false);
    expect(h.sim.bow("a", 1.5)).toBe(false);
    expect(h.sim.bow("a", Number.NaN)).toBe(false);
    expect(h.monk("a").mode).toBe("kneel");
  });

  it("bows for BOW_MS, then returns to kneel and counts the bow", () => {
    h.seat("a", 0);
    expect(h.sim.bow("a", 1)).toBe(true);
    expect(h.monk("a").mode).toBe("bow");
    expect(h.monk("a").bowCount).toBe(0);
    h.advance(BOW_MS - TICK_MS * 2);
    expect(h.monk("a").mode).toBe("bow");
    h.advance(TICK_MS * 3);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").bowCount).toBe(1);
  });

  it("ignores a second bow while one is in progress", () => {
    h.seat("a", 0);
    expect(h.sim.bow("a", 1)).toBe(true);
    expect(h.sim.bow("a", 1)).toBe(false);
    h.advance(BOW_MS + TICK_MS);
    expect(h.monk("a").bowCount).toBe(1);
  });

  it("enforces the cooldown after a bow ends", () => {
    h.seat("a", 0);
    h.sim.bow("a", 1);
    h.advance(BOW_MS + TICK_MS);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.sim.bow("a", 1)).toBe(false);
    h.advance(BOW_COOLDOWN_MS);
    expect(h.sim.bow("a", 1)).toBe(true);
  });

  it("performs 삼배 as three timed bows with cooldowns in between", () => {
    h.seat("a", 0);
    expect(h.sim.bow("a", 3)).toBe(true);
    const modes: string[] = [];
    const total = 3 * BOW_MS + 2 * BOW_COOLDOWN_MS + 4 * TICK_MS;
    for (let t = 0; t < total; t += TICK_MS) {
      h.advance(TICK_MS);
      const mode = h.monk("a").mode;
      if (modes[modes.length - 1] !== mode) modes.push(mode);
    }
    expect(modes).toEqual(["bow", "kneel", "bow", "kneel", "bow", "kneel"]);
    expect(h.monk("a").bowCount).toBe(3);
    expect(h.sim.bow("a", 1)).toBe(false);
  });

  it("does not accept another bow request during a queued 삼배", () => {
    h.seat("a", 0);
    h.sim.bow("a", 3);
    h.advance(BOW_MS + TICK_MS * 2);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.sim.bow("a", 2)).toBe(false);
  });

  it("cancels queued bows when the monk stands up", () => {
    h.seat("a", 0);
    h.sim.bow("a", 3);
    h.advance(200);
    h.sim.stand("a");
    h.advance(BOW_MS * 4);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").bowCount).toBe(0);
  });

  it("keeps bowCount per monk", () => {
    h.seat("a", 0);
    h.seat("b", 1);
    h.sim.bow("a", 2);
    h.advance(BOW_MS * 3);
    expect(h.monk("a").bowCount).toBe(2);
    expect(h.monk("b").bowCount).toBe(0);
  });
});

describe("seat numbers", () => {
  it("numbers monks from 1 and reuses the lowest free number after a leave", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    h.sim.join("c", 0);
    expect([h.monk("a").slot, h.monk("b").slot, h.monk("c").slot]).toEqual([1, 2, 3]);
    h.sim.leave("b");
    h.sim.join("d", 0);
    expect(h.monk("d").slot).toBe(2);
  });

  it("numbers a full world 1 through its capacity", () => {
    for (let i = 0; i < WORLD_CAPACITY; i += 1) h.sim.join(`m${i}`, i, i < ZONE_CAPACITY ? "gatbawi" : "dharma");
    const slots = Array.from(h.sim.state.monks.values(), (monk) => monk.slot).sort((x, y) => x - y);
    expect(slots).toEqual(Array.from({ length: WORLD_CAPACITY }, (_, i) => i + 1));
  });
});

describe("zones", () => {
  it("spawns a visitor at the entrance of the zone they asked for", () => {
    h.sim.join("a", 0, "dharma");
    expect(h.monk("a").zone).toBe("dharma");
    expect(h.monk("a").x).toBe(ZONE_SPAWN.dharma.x);
    expect(h.monk("a").z).toBe(ZONE_SPAWN.dharma.z);
    expect(h.sim.zoneCount("dharma")).toBe(1);
    expect(h.sim.zoneCount("gatbawi")).toBe(0);
  });

  it("keeps a walking visitor inside the bounds of their own zone", () => {
    h.sim.join("a", 0, "dharma");
    h.sim.move("a", 500, -500);
    h.advance(20_000);
    expect(h.monk("a").x).toBeCloseTo(DHARMA_BOUNDS.maxX, 4);
    expect(h.monk("a").z).toBeCloseTo(DHARMA_BOUNDS.minZ, 4);
  });

  it("sends a visitor to the other zone when the requested one is full", () => {
    h.fill("gatbawi", ZONE_CAPACITY - 1);
    expect(h.sim.chooseZone("gatbawi")).toEqual({ zone: "gatbawi", redirected: false });
    h.sim.join("last", 0, "gatbawi");
    expect(h.sim.chooseZone("gatbawi")).toEqual({ zone: "dharma", redirected: true });
    expect(h.sim.chooseZone("dharma")).toEqual({ zone: "dharma", redirected: false });
    expect(h.sim.chooseZone(null)).toEqual({ zone: "dharma", redirected: true });
    expect(h.sim.chooseZone(undefined).zone).toBe("dharma");
  });

  it("moves a visitor to the best free seat of the other zone", () => {
    h.seat("a", 20);
    expect(h.sim.changeZone("a", "dharma")).toBe("moved");
    const a = h.monk("a");
    expect(a.zone).toBe("dharma");
    expect(a.seatId).toBe(4);
    expect(a.mode).toBe("walk");
    expect(h.mat(20, "gatbawi").occupantId).toBe("");
    expect(h.mat(4, "dharma").occupantId).toBe("a");
    expect(a.z).toBe(ZONE_SPAWN.dharma.z);
    h.advance(8000);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").x).toBeCloseTo(DHARMA_SEATS[4]!.x, 4);
    expect(h.monk("a").z).toBeCloseTo(DHARMA_SEATS[4]!.z, 4);
  });

  it("fills the front row of the new zone first, middle outward", () => {
    for (let i = 0; i < 3; i += 1) {
      h.sim.join(`v${i}`, 0, "gatbawi");
      h.sim.changeZone(`v${i}`, "dharma");
    }
    expect(["v0", "v1", "v2"].map((id) => h.monk(id).seatId)).toEqual([4, 5, 3]);
  });

  it("does nothing when the visitor is already there", () => {
    h.sim.join("a", 0);
    expect(h.sim.changeZone("a", "gatbawi")).toBe("same");
    expect(h.sim.changeZone("ghost", "dharma")).toBe("unknown");
  });

  it("refuses to move into a full zone and keeps the visitor where they were", () => {
    h.fill("dharma", ZONE_CAPACITY);
    h.seat("a", 5);
    expect(h.sim.changeZone("a", "dharma")).toBe("full");
    expect(h.monk("a").zone).toBe("gatbawi");
    expect(h.monk("a").seatId).toBe(5);
    expect(h.monk("a").mode).toBe("kneel");

    h.sim.leave("dharma0");
    expect(h.sim.changeZone("a", "dharma")).toBe("moved");
    expect(h.sim.zoneCount("dharma")).toBe(ZONE_CAPACITY);
  });

  it("allows one zone change per cooldown", () => {
    h.seat("a", 0);
    expect(h.sim.changeZone("a", "dharma")).toBe("moved");
    expect(h.sim.changeZone("a", "gatbawi")).toBe("cooldown");
    expect(h.monk("a").zone).toBe("dharma");
    h.advance(ZONE_COOLDOWN_MS - TICK_MS);
    expect(h.sim.changeZone("a", "gatbawi")).toBe("cooldown");
    h.advance(TICK_MS);
    expect(h.sim.changeZone("a", "gatbawi")).toBe("moved");
    expect(h.monk("a").zone).toBe("gatbawi");
  });

  it("drops queued bows and the old seat when changing zone", () => {
    h.seat("a", 0);
    h.sim.bow("a", 3);
    h.advance(200);
    expect(h.sim.changeZone("a", "dharma")).toBe("moved");
    h.advance(BOW_MS * 4);
    expect(h.monk("a").bowCount).toBe(0);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").zone).toBe("dharma");
  });

  it("frees a dharma seat when its monk leaves", () => {
    h.sim.join("a", 0, "dharma");
    h.sim.sit("a", "dharma", 9);
    h.sim.leave("a");
    expect(h.mat(9, "dharma").occupantId).toBe("");
  });
});

describe("chant", () => {
  it("publishes the current or next half-hour chant", () => {
    const hour = 3_600_000;
    h.now = Math.floor(T0 / hour) * hour + 10 * 60_000;
    const sim = new TempleSim({ clock: () => h.now });
    const next = Math.floor(h.now / hour) * hour + CHANT_EVERY_MS;
    expect(sim.state.chant.startsAt).toBe(next);
    expect(sim.state.chant.durationMs).toBe(CHANT_MS);
    expect(sim.state.chant.label).toMatch(/^\d{2}:\d{2} 예불$/);
  });

  it("advances to the following chant once the current one is over", () => {
    const hour = 3_600_000;
    h.now = Math.floor(T0 / hour) * hour + 10 * 60_000;
    const sim = new TempleSim({ clock: () => h.now });
    const first = sim.state.chant.startsAt;
    h.now = first + CHANT_MS + 1;
    const wait = sim.updateChant();
    expect(sim.state.chant.startsAt).toBe(first + CHANT_EVERY_MS);
    expect(wait).toBeGreaterThan(0);
  });
});
