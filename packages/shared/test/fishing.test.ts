import { beforeEach, describe, expect, it } from "vitest";
import { FISH_BITE_MS, FISH_WAIT_MAX_MS, FISH_WAIT_MIN_MS, TICK_MS } from "../src/constants.ts";
import { FISH, NO_FISH, fishById, pickFish } from "../src/fish.ts";
import { ITEM_MOKT, ITEM_NONE, ITEM_ROD } from "../src/item.ts";
import { FISHING_REACH, SEA_LINE_X, yawFromDirection } from "../src/layout.ts";
import { TempleSim } from "../src/sim.ts";

const T0 = 1_800_000_000_000;
const EDGE = { x: SEA_LINE_X - 0.3, z: 6 };

class Harness {
  now = T0;
  draws: number[] = [];
  readonly sim: TempleSim;

  constructor(npcCount = 0) {
    this.sim = new TempleSim({ clock: () => this.now, random: () => this.draws.shift() ?? 0.5, npcCount });
  }

  advance(ms: number): void {
    let left = ms;
    while (left > 0) {
      const step = Math.min(TICK_MS, left);
      this.now += step;
      this.sim.tick(step);
      left -= step;
    }
  }

  monk(id: string) {
    const monk = this.sim.state.monks.get(id);
    if (!monk) throw new Error(`no monk ${id}`);
    return monk;
  }

  angler(id = "a"): void {
    this.sim.join(id, 0);
    this.sim.equip(id, ITEM_ROD);
    this.sim.move(id, EDGE.x, EDGE.z);
    this.advance(30_000);
    expect(this.monk(id).mode).toBe("stand");
    expect(this.monk(id).x).toBeCloseTo(EDGE.x, 3);
  }
}

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

describe("the fish table", () => {
  it("numbers the species from 1 and keeps 0 for the empty hook", () => {
    expect(NO_FISH).toBe(0);
    expect(FISH.map((fish) => fish.id)).toEqual([1, 2, 3, 4]);
    expect(FISH.map((fish) => fish.name)).toEqual(["고등어", "농어", "우럭", "숭어"]);
    expect(fishById(2)?.name).toBe("농어");
    expect(fishById(0)).toBeUndefined();
    expect(fishById(99)).toBeUndefined();
  });

  it("makes the mackerel the commonest and the mullet the rarest", () => {
    const weights = FISH.map((fish) => fish.weight);
    expect(FISH[0]!.weight).toBe(Math.max(...weights));
    expect(FISH[3]!.weight).toBe(Math.min(...weights));
  });

  it("picks a species by weight from one draw", () => {
    const total = FISH.reduce((sum, fish) => sum + fish.weight, 0);
    expect(pickFish(() => 0).id).toBe(1);
    expect(pickFish(() => (FISH[0]!.weight - 0.5) / total).id).toBe(1);
    expect(pickFish(() => (FISH[0]!.weight + 0.5) / total).id).toBe(2);
    expect(pickFish(() => 0.999999).id).toBe(4);
    const counts = new Map<number, number>();
    for (let n = 0; n < total * 10; n += 1) {
      const fish = pickFish(() => (n % total) / total);
      counts.set(fish.id, (counts.get(fish.id) ?? 0) + 1);
    }
    for (const fish of FISH) expect(counts.get(fish.id)).toBe(fish.weight * 10);
  });
});

describe("casting", () => {
  it("starts every monk not fishing and with nothing caught", () => {
    h.sim.join("a", 0);
    expect(h.monk("a")).toMatchObject({ bite: false, catchSeq: 0, lastCatch: 0 });
  });

  it("casts from the water's edge with the rod, facing the sea", () => {
    h.angler();
    expect(h.sim.cast("a")).toBe(true);
    expect(h.monk("a").mode).toBe("fish");
    expect(h.monk("a").bite).toBe(false);
    expect(h.monk("a").yaw).toBeCloseTo(yawFromDirection(1, 0), 5);
    expect(h.monk("a").x).toBeCloseTo(EDGE.x, 3);
  });

  it("refuses to cast away from the shore", () => {
    h.sim.join("a", 0);
    h.sim.equip("a", ITEM_ROD);
    expect(h.sim.cast("a")).toBe(false);
    h.sim.move("a", SEA_LINE_X - FISHING_REACH - 0.5, 6);
    h.advance(30_000);
    expect(h.monk("a").x).toBeLessThan(SEA_LINE_X - FISHING_REACH);
    expect(h.sim.cast("a")).toBe(false);
    expect(h.monk("a").mode).toBe("stand");
  });

  it("casts from exactly FISHING_REACH away from the waterline", () => {
    h.sim.join("a", 0);
    h.sim.equip("a", ITEM_ROD);
    h.sim.move("a", SEA_LINE_X - FISHING_REACH, 6);
    h.advance(30_000);
    expect(h.sim.cast("a")).toBe(true);
  });

  it("refuses to cast without the rod", () => {
    h.angler();
    for (const item of [ITEM_NONE, ITEM_MOKT]) {
      h.sim.equip("a", item);
      expect(h.sim.cast("a")).toBe(false);
      expect(h.monk("a").mode).toBe("stand");
    }
  });

  it("refuses to cast while seated or on the way to a seat", () => {
    h.angler();
    expect(h.sim.sit("a", "gatbawi", 4)).toBe(true);
    expect(h.monk("a").seatId).toBe(4);
    expect(h.sim.cast("a")).toBe(false);
    h.advance(60_000);
    expect(h.monk("a").mode).toBe("kneel");
    expect(h.sim.cast("a")).toBe(false);
  });

  it("refuses a second cast while fishing, and an unknown monk", () => {
    h.angler();
    expect(h.sim.cast("a")).toBe(true);
    expect(h.sim.cast("a")).toBe(false);
    expect(h.sim.cast("ghost")).toBe(false);
  });

  it("stops a walk in progress when it casts at the edge", () => {
    h.sim.join("a", 0);
    h.sim.equip("a", ITEM_ROD);
    h.sim.move("a", SEA_LINE_X, 6);
    for (let n = 0; n < 4000 && h.monk("a").x < SEA_LINE_X - FISHING_REACH + 0.1; n += 1) h.advance(TICK_MS);
    expect(h.monk("a").mode).toBe("walk");
    expect(h.sim.cast("a")).toBe(true);
    const at = h.monk("a").x;
    h.advance(1000);
    expect(h.monk("a").mode).toBe("fish");
    expect(h.monk("a").x).toBe(at);
  });
});

describe("a bite", () => {
  it("comes after the wait the random draw picks, between the shortest and the longest", () => {
    h.angler();
    h.draws = [0];
    h.sim.cast("a");
    h.advance(FISH_WAIT_MIN_MS - TICK_MS);
    expect(h.monk("a").bite).toBe(false);
    h.advance(TICK_MS);
    expect(h.monk("a").bite).toBe(true);
    expect(h.monk("a").mode).toBe("fish");

    h.sim.leave("a");
    h.angler("b");
    h.draws = [1];
    h.sim.cast("b");
    h.advance(FISH_WAIT_MAX_MS - TICK_MS);
    expect(h.monk("b").bite).toBe(false);
    h.advance(TICK_MS);
    expect(h.monk("b").bite).toBe(true);
  });

  it("lets the fish go when the window closes without a reel", () => {
    h.angler();
    h.draws = [0];
    h.sim.cast("a");
    h.advance(FISH_WAIT_MIN_MS);
    expect(h.monk("a").bite).toBe(true);
    h.advance(FISH_BITE_MS - TICK_MS);
    expect(h.monk("a")).toMatchObject({ mode: "fish", bite: true, catchSeq: 0 });
    h.advance(TICK_MS);
    expect(h.monk("a")).toMatchObject({ mode: "stand", bite: false, catchSeq: 1, lastCatch: 0 });
  });

  it("is waited for on a clock of each monk's own", () => {
    h.angler("a");
    h.angler("b");
    h.draws = [0, 1];
    h.sim.cast("a");
    h.sim.cast("b");
    h.advance(FISH_WAIT_MIN_MS);
    expect(h.monk("a").bite).toBe(true);
    expect(h.monk("b").bite).toBe(false);
  });
});

describe("reeling", () => {
  it("lands the species the draw picks when the fish is biting", () => {
    h.angler();
    h.draws = [0];
    h.sim.cast("a");
    h.advance(FISH_WAIT_MIN_MS);
    expect(h.monk("a").bite).toBe(true);
    h.draws = [0.999999];
    expect(h.sim.reel("a")).toBe(true);
    expect(h.monk("a")).toMatchObject({ mode: "stand", bite: false, catchSeq: 1, lastCatch: 4 });
  });

  it("lands the mackerel on a low draw", () => {
    h.angler();
    h.draws = [0];
    h.sim.cast("a");
    h.advance(FISH_WAIT_MIN_MS);
    h.draws = [0];
    h.sim.reel("a");
    expect(h.monk("a")).toMatchObject({ lastCatch: 1, catchSeq: 1 });
  });

  it("catches nothing when it reels before the bite", () => {
    h.angler();
    h.sim.cast("a");
    h.advance(1000);
    expect(h.sim.reel("a")).toBe(true);
    expect(h.monk("a")).toMatchObject({ mode: "stand", bite: false, catchSeq: 1, lastCatch: 0 });
  });

  it("counts every catch and leaves the monk free to cast again", () => {
    h.angler();
    for (let round = 1; round <= 3; round += 1) {
      h.draws = [0];
      expect(h.sim.cast("a")).toBe(true);
      h.advance(FISH_WAIT_MIN_MS);
      h.draws = [0.999999];
      expect(h.sim.reel("a")).toBe(true);
      expect(h.monk("a").catchSeq).toBe(round);
    }
  });

  it("refuses to reel when not fishing, and a reel after the escape", () => {
    h.angler();
    expect(h.sim.reel("a")).toBe(false);
    expect(h.sim.reel("ghost")).toBe(false);
    h.draws = [0];
    h.sim.cast("a");
    h.advance(FISH_WAIT_MIN_MS + FISH_BITE_MS);
    expect(h.monk("a").catchSeq).toBe(1);
    expect(h.sim.reel("a")).toBe(false);
    expect(h.monk("a").catchSeq).toBe(1);
  });

  it("keeps the count per monk", () => {
    h.angler("a");
    h.angler("b");
    h.sim.cast("a");
    h.sim.reel("a");
    expect(h.monk("a").catchSeq).toBe(1);
    expect(h.monk("b").catchSeq).toBe(0);
  });
});

describe("giving up", () => {
  function fishing(): void {
    h.angler();
    h.draws = [0];
    h.sim.cast("a");
    h.advance(FISH_WAIT_MIN_MS);
    expect(h.monk("a")).toMatchObject({ mode: "fish", bite: true });
  }

  it("ends when the monk walks away, without recording a catch", () => {
    fishing();
    expect(h.sim.move("a", 0, 6)).toBe(true);
    expect(h.monk("a")).toMatchObject({ mode: "walk", bite: false, catchSeq: 0, lastCatch: 0 });
    h.advance(FISH_BITE_MS * 3);
    expect(h.monk("a").catchSeq).toBe(0);
  });

  it("ends when the monk stands, sits or puts the rod down", () => {
    fishing();
    h.sim.stand("a");
    expect(h.monk("a")).toMatchObject({ mode: "stand", bite: false, catchSeq: 0 });

    h.draws = [0];
    h.sim.cast("a");
    h.sim.sit("a", "gatbawi", 3);
    expect(h.monk("a")).toMatchObject({ mode: "walk", bite: false, catchSeq: 0 });

    h.sim.stand("a");
    h.sim.move("a", EDGE.x, EDGE.z);
    h.advance(60_000);
    h.draws = [0];
    expect(h.sim.cast("a")).toBe(true);
    h.sim.equip("a", ITEM_MOKT);
    expect(h.monk("a")).toMatchObject({ mode: "stand", bite: false, catchSeq: 0 });
    h.advance(FISH_WAIT_MAX_MS);
    expect(h.monk("a")).toMatchObject({ mode: "stand", bite: false, catchSeq: 0 });
  });

  it("keeps fishing when the monk re-equips the rod", () => {
    fishing();
    h.sim.equip("a", ITEM_ROD);
    expect(h.monk("a")).toMatchObject({ mode: "fish", bite: true });
  });

  it("cannot bow while fishing", () => {
    fishing();
    expect(h.sim.bow("a", 1)).toBe(false);
    expect(h.monk("a").mode).toBe("fish");
  });

  it("starts the next cast with a fresh wait", () => {
    fishing();
    h.sim.move("a", EDGE.x, EDGE.z);
    h.advance(1000);
    h.draws = [1];
    expect(h.sim.cast("a")).toBe(true);
    expect(h.monk("a").bite).toBe(false);
    h.advance(FISH_WAIT_MAX_MS - TICK_MS);
    expect(h.monk("a").bite).toBe(false);
  });
});

describe("computer-driven monks", () => {
  it("never fish, even though they wander out onto the sand", () => {
    const world = new Harness(50);
    for (let n = 0; n < 2400; n += 1) world.advance(TICK_MS);
    for (const monk of world.sim.state.monks.values()) {
      expect(monk.mode).not.toBe("fish");
      expect(monk.item).toBe(ITEM_NONE);
      expect(monk.catchSeq).toBe(0);
    }
    expect(world.sim.cast("npc-1")).toBe(false);
  });
});
