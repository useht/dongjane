import { beforeEach, describe, expect, it } from "vitest";
import {
  BOW_COOLDOWN_MS,
  BOW_MS,
  CHANT_EVERY_MS,
  CHANT_MS,
  EMOTE_COOLDOWN_MS,
  JUMP_COOLDOWN_MS,
  KNOCK_COOLDOWN_MS,
  NPC_COUNT,
  TICK_MS,
  WALK_SPEED,
  WORLD_CAPACITY,
  ZONE_CAPACITY,
} from "../src/constants.ts";
import { EMOTE_COUNT } from "../src/emote.ts";
import { ITEM_CHANT, ITEM_MOKT, ITEM_NONE } from "../src/item.ts";
import {
  ARRIVAL,
  DHARMA_BOUNDS,
  DHARMA_ORIGIN,
  DHARMA_SEATS,
  GATBAWI_SEATS,
  SEAT_COUNT,
  WORLD_BOUNDS,
  type Zone,
} from "../src/layout.ts";
import { TempleSim } from "../src/sim.ts";
import { COURT_AREA, DOORWAY_AREA, INTERIOR_AREA, resolveWalkable, zoneAt } from "../src/walk.ts";

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
    expect(zoneAt(a.x, a.z)).toBe("gatbawi");
    expect(a.x).toBe(ARRIVAL.x);
    expect(a.z).toBe(ARRIVAL.z);
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
        const monk = h.sim.join(`${zone}${i}`, i * 7);
        expect(h.sim.sit(monk.id, zone, i)).toBe(true);
      }
      h.advance(40_000);
      for (let i = 0; i < ZONE_CAPACITY; i += 1) {
        const monk = h.monk(`${zone}${i}`);
        const spot = seats[i]!;
        expect(monk.mode).toBe("kneel");
        expect(monk.yaw).toBe(0);
        expect(monk.x).toBeCloseTo(spot.x, 4);
        expect(monk.z).toBeCloseTo(spot.z, 4);
        expect(zoneAt(monk.x, monk.z)).toBe(zone);
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
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    expect(h.sim.sit("a", "gatbawi", 7)).toBe(true);
    expect(h.sim.sit("b", "dharma", 7)).toBe(true);
    expect(h.mat(7, "gatbawi").occupantId).toBe("a");
    expect(h.mat(7, "dharma").occupantId).toBe("b");
  });

  it("lets a monk ask for a seat in the other zone from wherever they stand", () => {
    h.sim.join("a", 0);
    expect(zoneAt(h.monk("a").x, h.monk("a").z)).toBe("gatbawi");
    expect(h.sim.sit("a", "dharma", 3)).toBe(true);
    expect(h.mat(3, "dharma").occupantId).toBe("a");
    expect(h.monk("a").seatId).toBe(3);
    expect(h.monk("a").mode).toBe("walk");
    h.advance(40_000);
    expect(h.monk("a").mode).toBe("kneel");
    expect(zoneAt(h.monk("a").x, h.monk("a").z)).toBe("dharma");
    expect(h.monk("a").x).toBeCloseTo(DHARMA_SEATS[3]!.x, 4);
    expect(h.monk("a").z).toBeCloseTo(DHARMA_SEATS[3]!.z, 4);
  });

  it("frees the seat of the right zone when the monk takes another seat of the same number", () => {
    h.sim.join("a", 0);
    h.sim.sit("a", "gatbawi", 7);
    expect(h.sim.sit("a", "dharma", 7)).toBe(true);
    expect(h.mat(7, "gatbawi").occupantId).toBe("");
    expect(h.mat(7, "dharma").occupantId).toBe("a");
    expect(h.sim.stand("a")).toBe(true);
    expect(h.mat(7, "dharma").occupantId).toBe("");
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
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.5, npcCount: NPC_COUNT });
    for (let t = 0; t < 10 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    const npcs = [...sim.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(NPC_COUNT);
    for (const npc of npcs) expect(npc.emoteSeq).toBe(0);
  });
});

describe("held items", () => {
  it("starts every monk empty-handed and silent", () => {
    h.sim.join("a", 0);
    expect(h.monk("a").item).toBe(ITEM_NONE);
    expect(h.monk("a").knockSeq).toBe(0);
    expect(h.monk("a").chanting).toBe(false);
  });

  it("equips only valid items", () => {
    h.sim.join("a", 0);
    expect(h.sim.equip("a", ITEM_MOKT)).toBe(true);
    expect(h.monk("a").item).toBe(ITEM_MOKT);
    expect(h.sim.equip("a", ITEM_CHANT)).toBe(true);
    expect(h.monk("a").item).toBe(ITEM_CHANT);
    expect(h.sim.equip("a", ITEM_NONE)).toBe(true);
    expect(h.monk("a").item).toBe(ITEM_NONE);
    h.sim.equip("a", ITEM_MOKT);
    for (const bad of [3, -1, 1.5, Number.NaN, 255]) {
      expect(h.sim.equip("a", bad)).toBe(false);
      expect(h.monk("a").item).toBe(ITEM_MOKT);
    }
    expect(h.sim.equip("ghost", ITEM_MOKT)).toBe(false);
  });

  it("lets a monk equip anywhere, seated or not", () => {
    h.sim.join("a", 0);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.sim.equip("a", ITEM_CHANT)).toBe(true);
    h.seat("b", 1);
    expect(h.sim.equip("b", ITEM_MOKT)).toBe(true);
    expect(h.monk("b").item).toBe(ITEM_MOKT);
  });

  it("keeps the item per monk", () => {
    h.seat("a", 0);
    h.seat("b", 1);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.monk("b").item).toBe(ITEM_NONE);
  });

  it("rejects a knock without the wooden fish", () => {
    h.seat("a", 0);
    expect(h.sim.knock("a")).toBe(false);
    h.sim.equip("a", ITEM_CHANT);
    expect(h.sim.knock("a")).toBe(false);
    expect(h.monk("a").knockSeq).toBe(0);
  });

  it("rejects a knock unless the monk is kneeling on a seat", () => {
    h.sim.join("a", 0);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.sim.knock("a")).toBe(false);
    h.sim.sit("a", "gatbawi", 0);
    expect(h.monk("a").mode).toBe("walk");
    expect(h.sim.knock("a")).toBe(false);
    expect(h.sim.knock("ghost")).toBe(false);
    expect(h.monk("a").knockSeq).toBe(0);
  });

  it("counts a knock from a seated monk holding the wooden fish without touching mode or seat", () => {
    h.seat("a", 2);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.monk("a").knockSeq).toBe(0);
    expect(h.sim.knock("a")).toBe(true);
    expect(h.monk("a").knockSeq).toBe(1);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").seatId).toBe(2);
  });

  it("rejects a second knock inside the cooldown and accepts one once it has passed", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.sim.knock("a")).toBe(true);
    h.advance(KNOCK_COOLDOWN_MS - TICK_MS);
    expect(h.sim.knock("a")).toBe(false);
    expect(h.monk("a").knockSeq).toBe(1);
    h.advance(TICK_MS);
    expect(h.sim.knock("a")).toBe(true);
    expect(h.monk("a").knockSeq).toBe(2);
  });

  it("keeps the knock cooldown per monk", () => {
    h.seat("a", 0);
    h.seat("b", 1);
    h.sim.equip("a", ITEM_MOKT);
    h.sim.equip("b", ITEM_MOKT);
    expect(h.sim.knock("a")).toBe(true);
    expect(h.sim.knock("b")).toBe(true);
    expect(h.sim.knock("a")).toBe(false);
    expect(h.monk("b").knockSeq).toBe(1);
  });

  it("rejects a knock mid-bow", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.sim.bow("a", 1)).toBe(true);
    expect(h.sim.knock("a")).toBe(false);
    expect(h.monk("a").knockSeq).toBe(0);
    h.advance(BOW_MS + TICK_MS);
    expect(h.sim.knock("a")).toBe(true);
  });

  it("starts chanting only for a seated monk holding the prayer beads", () => {
    h.sim.join("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    expect(h.sim.chant("a", true)).toBe(false);
    h.sim.sit("a", "gatbawi", 0);
    expect(h.sim.chant("a", true)).toBe(false);
    expect(h.monk("a").chanting).toBe(false);
    h.advance(8000);
    expect(h.sim.chant("a", true)).toBe(true);
    expect(h.monk("a").chanting).toBe(true);
    expect(h.sim.chant("ghost", true)).toBe(false);
  });

  it("refuses to chant without the prayer beads", () => {
    h.seat("a", 0);
    expect(h.sim.chant("a", true)).toBe(false);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.sim.chant("a", true)).toBe(false);
    expect(h.monk("a").chanting).toBe(false);
  });

  it("always lets a monk stop chanting", () => {
    h.seat("a", 0);
    expect(h.sim.chant("a", false)).toBe(true);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.chant("a", false)).toBe(true);
    expect(h.monk("a").chanting).toBe(false);
  });

  it("lets the chant be switched on and off mid-bow", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    expect(h.sim.chant("a", true)).toBe(true);
    expect(h.sim.bow("a", 1)).toBe(true);
    expect(h.monk("a").mode).toBe("bow");
    expect(h.monk("a").chanting).toBe(true);
    expect(h.sim.chant("a", false)).toBe(true);
    expect(h.sim.chant("a", true)).toBe(true);
    expect(h.monk("a").chanting).toBe(true);
  });

  it("stops chanting when the monk puts the beads down or swaps them for another item", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.equip("a", ITEM_NONE)).toBe(true);
    expect(h.monk("a").chanting).toBe(false);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.equip("a", ITEM_MOKT)).toBe(true);
    expect(h.monk("a").chanting).toBe(false);
  });

  it("keeps chanting when the monk re-equips the beads already in hand", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.equip("a", ITEM_CHANT)).toBe(true);
    expect(h.monk("a").chanting).toBe(true);
  });

  it("keeps the item but stops chanting when the monk stands up", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.stand("a")).toBe(true);
    expect(h.monk("a").chanting).toBe(false);
    expect(h.monk("a").item).toBe(ITEM_CHANT);
  });

  it("keeps the item but stops chanting when the monk walks away", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.move("a", 0, 4)).toBe(true);
    expect(h.monk("a").chanting).toBe(false);
    expect(h.monk("a").item).toBe(ITEM_CHANT);
    h.advance(8000);
    expect(h.monk("a").chanting).toBe(false);
    expect(h.monk("a").item).toBe(ITEM_CHANT);
  });

  it("keeps the item but stops chanting when the monk moves to another seat", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.sit("a", "gatbawi", 1)).toBe(true);
    expect(h.monk("a").chanting).toBe(false);
    expect(h.monk("a").item).toBe(ITEM_CHANT);
    h.advance(8000);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").chanting).toBe(false);
  });

  it("keeps chanting when the monk asks for the seat it already holds", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.sim.sit("a", "gatbawi", 0)).toBe(true);
    expect(h.monk("a").chanting).toBe(true);
  });

  it("lets a monk who kept the wooden fish knock again after sitting back down", () => {
    h.seat("a", 0);
    h.sim.equip("a", ITEM_MOKT);
    h.sim.stand("a");
    expect(h.sim.knock("a")).toBe(false);
    h.sim.sit("a", "gatbawi", 0);
    h.advance(8000);
    expect(h.sim.knock("a")).toBe(true);
  });

  it("keeps chanting per monk", () => {
    h.seat("a", 0);
    h.seat("b", 1);
    h.sim.equip("a", ITEM_CHANT);
    h.sim.equip("b", ITEM_CHANT);
    h.sim.chant("a", true);
    expect(h.monk("b").chanting).toBe(false);
    h.sim.stand("b");
    expect(h.monk("a").chanting).toBe(true);
  });

  it("never makes npc monks hold items, knock or chant", () => {
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.5, npcCount: NPC_COUNT });
    for (let t = 0; t < 10 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    for (const npc of [...sim.state.monks.values()].filter((monk) => monk.npc)) {
      expect(npc.item).toBe(ITEM_NONE);
      expect(npc.knockSeq).toBe(0);
      expect(npc.chanting).toBe(false);
    }
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
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.5, npcCount: NPC_COUNT });
    for (let t = 0; t < 10 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    const npcs = [...sim.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(NPC_COUNT);
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
    for (let i = 0; i < WORLD_CAPACITY; i += 1) h.sim.join(`m${i}`, i);
    const slots = Array.from(h.sim.state.monks.values(), (monk) => monk.slot).sort((x, y) => x - y);
    expect(slots).toEqual(Array.from({ length: WORLD_CAPACITY }, (_, i) => i + 1));
  });
});

describe("one world", () => {
  const where = (id: string): Zone => zoneAt(h.monk(id).x, h.monk(id).z);

  it("brings every visitor in at the plaza", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    expect(where("a")).toBe("gatbawi");
    expect(where("b")).toBe("gatbawi");
    expect(h.sim.zoneCount("gatbawi")).toBe(2);
    expect(h.sim.zoneCount("dharma")).toBe(0);
  });

  it("keeps a walking visitor inside the world", () => {
    h.sim.join("a", 0);
    h.sim.move("a", 500, -500);
    h.advance(30_000);
    expect(h.monk("a").x).toBeCloseTo(WORLD_BOUNDS.maxX, 4);
    expect(h.monk("a").z).toBeCloseTo(WORLD_BOUNDS.minZ, 4);
  });

  it("walks a visitor through the doorway into the 법당 and counts them there", () => {
    h.sim.join("a", 0);
    h.sim.move("a", DHARMA_ORIGIN.x, DHARMA_ORIGIN.z);
    let through = false;
    for (let t = 0; t < 40_000 && h.monk("a").mode === "walk"; t += TICK_MS) {
      h.advance(TICK_MS);
      const { x, z } = h.monk("a");
      const solid = resolveWalkable(x, z);
      expect(Math.hypot(solid.x - x, solid.z - z)).toBeLessThan(1e-3);
      if (z > DHARMA_BOUNDS.maxZ && z < DOORWAY_AREA.maxZ) through = true;
    }
    expect(through).toBe(true);
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").x).toBeCloseTo(DHARMA_ORIGIN.x, 3);
    expect(h.monk("a").z).toBeCloseTo(DHARMA_ORIGIN.z, 3);
    expect(where("a")).toBe("dharma");
    expect(h.sim.zoneCount("dharma")).toBe(1);
    expect(h.sim.zoneCount("gatbawi")).toBe(0);
  });

  it("stops a visitor at the edge of the court when sent past it", () => {
    h.sim.join("a", 0);
    h.sim.move("a", COURT_AREA.minX - 3, 12);
    h.advance(30_000);
    expect(h.monk("a").x).toBeCloseTo(COURT_AREA.minX, 3);
    expect(h.monk("a").z).toBeCloseTo(12, 3);
    expect(where("a")).toBe("gatbawi");
  });

  it("walks a visitor out of the 법당 and back to the plaza", () => {
    h.sim.join("a", 0);
    h.sim.sit("a", "dharma", 24);
    h.advance(40_000);
    expect(where("a")).toBe("dharma");
    h.sim.move("a", ARRIVAL.x, ARRIVAL.z);
    h.advance(40_000);
    expect(h.monk("a").mode).toBe("stand");
    expect(where("a")).toBe("gatbawi");
    expect(h.mat(24, "dharma").occupantId).toBe("");
  });

  it("frees a dharma seat when its monk leaves", () => {
    h.sim.join("a", 0);
    h.sim.sit("a", "dharma", 9);
    h.sim.leave("a");
    expect(h.mat(9, "dharma").occupantId).toBe("");
  });

  it("starts the computer-driven monks in the 법당 and keeps them on walkable ground as they wander", () => {
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.37, npcCount: NPC_COUNT });
    const npcs = [...sim.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(NPC_COUNT);
    for (const npc of npcs) {
      expect(zoneAt(npc.x, npc.z)).toBe("dharma");
      expect(npc.x).toBeGreaterThanOrEqual(INTERIOR_AREA.minX);
      expect(npc.x).toBeLessThanOrEqual(INTERIOR_AREA.maxX);
      expect(npc.z).toBeGreaterThanOrEqual(INTERIOR_AREA.minZ);
      expect(npc.z).toBeLessThanOrEqual(INTERIOR_AREA.maxZ);
    }

    for (let t = 0; t < 5 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    for (const npc of npcs) {
      const solid = resolveWalkable(npc.x, npc.z);
      expect(Math.hypot(solid.x - npc.x, solid.z - npc.z)).toBeLessThan(1e-4);
    }
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
