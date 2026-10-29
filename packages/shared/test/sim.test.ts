import { beforeEach, describe, expect, it } from "vitest";
import { BOW_COOLDOWN_MS, BOW_MS, CHANT_EVERY_MS, CHANT_MS, TICK_MS, WALK_SPEED, WORLD_CAPACITY } from "../src/constants.ts";
import { MAT_COUNT, MAT_SPOTS, SPAWN_POINT, WORLD_BOUNDS } from "../src/layout.ts";
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

  seat(id: string, matId: number): void {
    this.sim.join(id, 10);
    expect(this.sim.sit(id, matId)).toBe(true);
    this.advance(8000);
    expect(this.sim.state.monks.get(id)?.mode).toBe("kneel");
  }

  monk(id: string) {
    const monk = this.sim.state.monks.get(id);
    if (!monk) throw new Error(`no monk ${id}`);
    return monk;
  }

  mat(id: number) {
    const mat = this.sim.state.mats.get(String(id));
    if (!mat) throw new Error(`no mat ${id}`);
    return mat;
  }
}

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe("join and movement", () => {
  it("creates twelve free mats and spawns monks standing at the entrance", () => {
    expect(h.sim.state.mats.size).toBe(MAT_COUNT);
    expect(MAT_COUNT).toBe(12);
    h.sim.join("a", 120);
    const a = h.monk("a");
    expect(a.mode).toBe("stand");
    expect(a.z).toBe(SPAWN_POINT.z);
    expect(a.matId).toBe(-1);
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

describe("mats", () => {
  it("claims a mat, walks over, and kneels facing Gatbawi", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", 5)).toBe(true);
    expect(h.mat(5).occupantId).toBe("a");
    expect(h.monk("a").mode).toBe("walk");
    h.advance(8000);
    const spot = MAT_SPOTS[5]!;
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.monk("a").x).toBeCloseTo(spot.x, 4);
    expect(h.monk("a").z).toBeCloseTo(spot.z, 4);
    expect(h.monk("a").yaw).toBe(0);
    expect(h.monk("a").matId).toBe(5);
  });

  it("seats a full world of twelve visitors, each kneeling on a mat of their own", () => {
    for (let slot = 1; slot <= WORLD_CAPACITY; slot += 1) {
      const monk = h.sim.join(`v${slot}`, slot * 20);
      expect(monk.slot).toBe(slot);
      expect(h.sim.sit(`v${slot}`, slot - 1)).toBe(true);
    }
    h.advance(12_000);

    const claimed = new Set<number>();
    for (let slot = 1; slot <= WORLD_CAPACITY; slot += 1) {
      const monk = h.monk(`v${slot}`);
      const spot = MAT_SPOTS[slot - 1]!;
      expect(monk.mode).toBe("kneel");
      expect(monk.yaw).toBe(0);
      expect(monk.x).toBeCloseTo(spot.x, 4);
      expect(monk.z).toBeCloseTo(spot.z, 4);
      claimed.add(monk.matId);
      expect(h.mat(monk.matId).occupantId).toBe(`v${slot}`);
    }
    expect(claimed.size).toBe(WORLD_CAPACITY);
    expect([...h.sim.state.mats.values()].every((mat) => mat.occupantId !== "")).toBe(true);

    h.sim.join("late", 0);
    for (let id = 0; id < MAT_COUNT; id += 1) expect(h.sim.sit("late", id)).toBe(false);
    expect(h.monk("late").matId).toBe(-1);
  });

  it("gives a contested mat to exactly one monk", () => {
    h.sim.join("a", 0);
    h.sim.join("b", 0);
    const results = [h.sim.sit("a", 2), h.sim.sit("b", 2)];
    expect(results).toEqual([true, false]);
    expect(h.mat(2).occupantId).toBe("a");
    expect(h.monk("b").matId).toBe(-1);
  });

  it("rejects invalid mat ids", () => {
    h.sim.join("a", 0);
    expect(h.sim.sit("a", MAT_COUNT)).toBe(false);
    expect(h.sim.sit("a", -1)).toBe(false);
    expect(h.sim.sit("a", 1.5)).toBe(false);
  });

  it("frees the old mat when moving to another", () => {
    h.seat("a", 0);
    expect(h.sim.sit("a", 1)).toBe(true);
    expect(h.mat(0).occupantId).toBe("");
    expect(h.mat(1).occupantId).toBe("a");
  });

  it("frees the mat on stand", () => {
    h.seat("a", 3);
    expect(h.sim.stand("a")).toBe(true);
    expect(h.mat(3).occupantId).toBe("");
    expect(h.monk("a").mode).toBe("stand");
    expect(h.monk("a").matId).toBe(-1);
    h.sim.join("b", 0);
    expect(h.sim.sit("b", 3)).toBe(true);
  });

  it("frees the mat when the monk walks away", () => {
    h.seat("a", 4);
    h.sim.move("a", 0, 4);
    expect(h.mat(4).occupantId).toBe("");
    expect(h.monk("a").matId).toBe(-1);
    expect(h.monk("a").mode).toBe("walk");
  });

  it("frees the mat when the monk leaves, even mid-walk", () => {
    h.sim.join("a", 0);
    h.sim.sit("a", 6);
    h.advance(300);
    h.sim.leave("a");
    expect(h.mat(6).occupantId).toBe("");
    expect(h.sim.state.monks.size).toBe(0);
  });

  it("never leaves two mats owned by one monk or two monks on one mat", () => {
    for (let i = 0; i < 12; i += 1) h.sim.join(`m${i}`, i);
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < 12; i += 1) h.sim.sit(`m${i}`, (i + round * 3) % 8);
      h.advance(500);
      const owners = new Map<string, number>();
      for (const [, mat] of h.sim.state.mats) {
        if (mat.occupantId === "") continue;
        owners.set(mat.occupantId, (owners.get(mat.occupantId) ?? 0) + 1);
        expect(h.monk(mat.occupantId).matId).toBe(mat.id);
      }
      for (const count of owners.values()) expect(count).toBe(1);
    }
  });
});

describe("bowing", () => {
  it("rejects bows unless kneeling on a mat", () => {
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

  it("numbers a full world 1 through its capacity", () => {
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
