import { beforeEach, describe, expect, it } from "vitest";
import {
  BOW_COOLDOWN_MS,
  BOW_MS,
  CHANT_EVERY_MS,
  CHANT_MS,
  EMOTE_COOLDOWN_MS,
  TICK_MS,
  WALK_SPEED,
} from "../src/constants.ts";
import { EMOTE_COUNT } from "../src/emote.ts";
import { CUSHION_SPOTS, SPAWN_POINT, WALK_BOUNDS } from "../src/layout.ts";
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

  seat(id: string, cushionId: number): void {
    this.sim.join(id, 10);
    expect(this.sim.sit(id, cushionId)).toBe(true);
    this.advance(8000);
    expect(this.sim.state.monks.get(id)?.mode).toBe("kneel");
  }

  monk(id: string) {
    const monk = this.sim.state.monks.get(id);
    if (!monk) throw new Error(`no monk ${id}`);
    return monk;
  }

  cushion(id: number) {
    const cushion = this.sim.state.cushions.get(String(id));
    if (!cushion) throw new Error(`no cushion ${id}`);
    return cushion;
  }
}

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe("join and movement", () => {
  it("creates eight free cushions and spawns monks standing at the entrance", () => {
    expect(h.sim.state.cushions.size).toBe(8);
    h.sim.join("a", 120);
    const a = h.monk("a");
    expect(a.mode).toBe("stand");
    expect(a.z).toBe(SPAWN_POINT.z);
    expect(a.cushionId).toBe(-1);
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
    h.advance(20_000);
    expect(h.monk("a").x).toBeCloseTo(WALK_BOUNDS.maxX, 4);
    expect(h.monk("a").z).toBeCloseTo(WALK_BOUNDS.minZ, 4);
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

describe("cushions", () => {
  it("claims a cushion, walks over, and kneels facing the Buddha", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", 5)).toBe(true);
    expect(h.cushion(5).occupantId).toBe("a");
    expect(h.monk("a").mode).toBe("walk");
    h.advance(8000);
    const spot = CUSHION_SPOTS[5]!;
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").x).toBeCloseTo(spot.x, 4);
    expect(h.monk("a").z).toBeCloseTo(spot.z, 4);
    expect(h.monk("a").yaw).toBe(0);
    expect(h.monk("a").cushionId).toBe(5);
  });

  it("gives a contested cushion to exactly one monk", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    const results = [h.sim.sit("a", 2), h.sim.sit("b", 2)];
    expect(results).toEqual([true, false]);
    expect(h.cushion(2).occupantId).toBe("a");
    expect(h.monk("b").cushionId).toBe(-1);
  });

  it("keeps a seated monk where they are when the cushion they ask for is taken", () => {
    h.seat("a", 0);
    h.seat("b", 1);
    expect(h.sim.sit("a", 1)).toBe(false);
    expect(h.cushion(0).occupantId).toBe("a");
    expect(h.cushion(1).occupantId).toBe("b");
    expect(h.monk("a").cushionId).toBe(0);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("b").cushionId).toBe(1);
  });

  it("rejects invalid cushion ids", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", 8)).toBe(false);
    expect(h.sim.sit("a", -1)).toBe(false);
    expect(h.sim.sit("a", 1.5)).toBe(false);
  });

  it("frees the old cushion when moving to another", () => {
    h.seat("a", 0);
    expect(h.sim.sit("a", 1)).toBe(true);
    expect(h.cushion(0).occupantId).toBe("");
    expect(h.cushion(1).occupantId).toBe("a");
  });

  it("frees the cushion on stand", () => {
    h.seat("a", 3);
    expect(h.sim.stand("a")).toBe(true);
    expect(h.cushion(3).occupantId).toBe("");
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").cushionId).toBe(-1);
    h.sim.join("b", 0);
    expect(h.sim.sit("b", 3)).toBe(true);
  });

  it("frees the cushion when the monk walks away", () => {
    h.seat("a", 4);
    h.sim.move("a", 0, 4);
    expect(h.cushion(4).occupantId).toBe("");
    expect(h.monk("a").cushionId).toBe(-1);
    expect(h.monk("a").mode).toBe("walk");
  });

  it("frees the cushion when the monk leaves, even mid-walk", () => {
    h.sim.join("a", 0);
    h.sim.sit("a", 6);
    h.advance(300);
    h.sim.leave("a");
    expect(h.cushion(6).occupantId).toBe("");
    expect(h.sim.state.monks.size).toBe(0);
  });

  it("never leaves two cushions owned by one monk or two monks on one cushion", () => {
    for (let i = 0; i < 12; i += 1) h.sim.join(`m${i}`, i);
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < 12; i += 1) h.sim.sit(`m${i}`, (i + round * 3) % 8);
      h.advance(500);
      const owners = new Map<string, number>();
      for (const [, cushion] of h.sim.state.cushions) {
        if (cushion.occupantId === "") continue;
        owners.set(cushion.occupantId, (owners.get(cushion.occupantId) ?? 0) + 1);
        expect(h.monk(cushion.occupantId).cushionId).toBe(cushion.id);
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
    const before = { mode: h.monk("a").mode, cushionId: h.monk("a").cushionId, x: h.monk("a").x, z: h.monk("a").z };
    expect(before.mode).toBe(mode);
    expect(h.monk("a").emoteSeq).toBe(0);

    expect(h.sim.emote("a", 5)).toBe(true);
    expect(h.monk("a").emote).toBe(5);
    expect(h.monk("a").emoteSeq).toBe(1);
    expect(h.monk("a").mode).toBe(before.mode);
    expect(h.monk("a").cushionId).toBe(before.cushionId);
    expect([h.monk("a").x, h.monk("a").z]).toEqual([before.x, before.z]);
    if (before.cushionId >= 0) expect(h.cushion(before.cushionId).occupantId).toBe("a");
  });

  it("lets a monk keep walking to its cushion after an emoticon and then kneel there", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", 5)).toBe(true);
    h.advance(300);
    expect(h.sim.emote("a", 1)).toBe(true);
    expect(h.monk("a").mode).toBe("walk");
    h.advance(8000);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").cushionId).toBe(5);
    expect(h.cushion(5).occupantId).toBe("a");
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
    const sim = new TempleSim({ clock: () => h.now, random: () => 0.5, npcCount: 6 });
    for (let t = 0; t < 10 * 60 * 1000; t += TICK_MS) {
      h.now += TICK_MS;
      sim.tick(TICK_MS);
    }
    const npcs = [...sim.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(6);
    for (const npc of npcs) expect(npc.emoteSeq).toBe(0);
  });
});

describe("bowing", () => {
  it("rejects bows unless kneeling on a cushion", () => {
    h.sim.join("a", 0);
    expect(h.sim.bow("a", 1)).toBe(false);
    h.sim.sit("a", 0);
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

  it("numbers a full hall 1 through its capacity", () => {
    for (let i = 0; i < 12; i += 1) h.sim.join(`m${i}`, i);
    const slots = Array.from(h.sim.state.monks.values(), (monk) => monk.slot).sort((x, y) => x - y);
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
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
