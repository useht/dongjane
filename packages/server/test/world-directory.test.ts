import { describe, expect, it } from "vitest";
import { WORLD_CAPACITY, WORLD_SPARE_AT } from "@dongjane/shared";
import {
  type DirectoryRoom,
  type WorldSnapshot,
  WorldDirectory,
  WorldsBusyError,
  MAX_PENDING_SEATS,
  chooseSeat,
  planWorlds,
} from "../src/world-directory.ts";

const snap = (world: number, clients: number, extra: Partial<WorldSnapshot> = {}): WorldSnapshot => ({
  world,
  clients,
  pending: 0,
  draining: false,
  ...extra,
});

describe("chooseSeat", () => {
  it("creates world 1 when nothing is open", () => {
    expect(chooseSeat([], null)).toEqual({ world: 1, create: true });
    expect(chooseSeat([], 5)).toEqual({ world: 1, create: true });
  });

  it("honours a requested world that exists and has room", () => {
    expect(chooseSeat([snap(1, 3), snap(2, 4)], 2)).toEqual({ world: 2, create: false });
  });

  it("falls back to the lowest world with room when the request is full, missing or draining", () => {
    const worlds = [snap(1, 5), snap(2, WORLD_CAPACITY), snap(3, 2), snap(4, 6, { draining: true })];
    expect(chooseSeat(worlds, 2)).toEqual({ world: 1, create: false });
    expect(chooseSeat(worlds, 9)).toEqual({ world: 1, create: false });
    expect(chooseSeat(worlds, 4)).toEqual({ world: 1, create: false });
    expect(chooseSeat(worlds, null)).toEqual({ world: 1, create: false });
  });

  it("counts handed-out seats against capacity", () => {
    const worlds = [snap(1, WORLD_CAPACITY - 2, { pending: 2 }), snap(2, 0)];
    expect(chooseSeat(worlds, 1)).toEqual({ world: 2, create: false });
  });

  it("does not honour a request for a world nobody is in, so the visitor is not merged straight back", () => {
    const worlds = [snap(1, WORLD_SPARE_AT), snap(2, 0)];
    expect(chooseSeat(worlds, 2)).toEqual({ world: 1, create: false });
    expect(chooseSeat([snap(1, WORLD_SPARE_AT), snap(2, 0, { pending: 1 })], 2)).toEqual({ world: 1, create: false });
  });

  it("still uses an empty world when it is the only one with room", () => {
    expect(chooseSeat([snap(1, WORLD_CAPACITY), snap(2, 0)], 2)).toEqual({ world: 2, create: false });
    expect(chooseSeat([snap(1, WORLD_CAPACITY), snap(2, 0)], null)).toEqual({ world: 2, create: false });
  });

  it("opens the next number after the highest world when every world is full", () => {
    const worlds = [snap(1, WORLD_CAPACITY), snap(3, WORLD_CAPACITY), snap(4, 2, { draining: true })];
    expect(chooseSeat(worlds, 1)).toEqual({ world: 5, create: true });
  });
});

describe("planWorlds", () => {
  it("plans nothing for an empty server", () => {
    expect(planWorlds([])).toEqual({ create: null, dispose: [], relocation: null });
  });

  it("disposes worlds with nobody in them", () => {
    expect(planWorlds([snap(1, 0), snap(2, 4), snap(3, 0)]).dispose).toEqual([1, 3]);
  });

  it("keeps a world that has a seat handed out", () => {
    expect(planWorlds([snap(1, 0, { pending: 1 })]).dispose).toEqual([]);
  });

  it("opens the next world when the busiest world reaches ten and keeps it empty", () => {
    expect(planWorlds([snap(1, WORLD_SPARE_AT - 1)])).toEqual({ create: null, dispose: [], relocation: null });
    expect(planWorlds([snap(1, WORLD_SPARE_AT)]).create).toBe(2);
    expect(planWorlds([snap(1, WORLD_SPARE_AT), snap(2, 0)])).toEqual({ create: null, dispose: [], relocation: null });
  });

  it("counts only visitors toward the spare threshold, not seats still waiting", () => {
    expect(planWorlds([snap(1, WORLD_SPARE_AT - 1, { pending: 1 })]).create).toBeNull();
    expect(planWorlds([snap(1, WORLD_SPARE_AT - 1), snap(2, 0, { pending: 3 })])).toEqual({
      create: null,
      dispose: [],
      relocation: null,
    });
  });

  it("measures the spare rule from the highest world that has visitors", () => {
    const plan = planWorlds([snap(1, WORLD_CAPACITY), snap(2, WORLD_SPARE_AT), snap(3, 0)]);
    expect(plan.dispose).toEqual([]);
    expect(planWorlds([snap(1, WORLD_CAPACITY), snap(2, 5), snap(3, 0)]).dispose).toEqual([3]);
  });

  it("closes the spare world again once the busiest world drops below ten", () => {
    expect(planWorlds([snap(1, WORLD_SPARE_AT - 1), snap(2, 0)]).dispose).toEqual([2]);
  });

  it("always disposes an emptied world that is being merged", () => {
    const plan = planWorlds([snap(1, WORLD_SPARE_AT), snap(2, 0, { draining: true })]);
    expect(plan.dispose).toEqual([2]);
    expect(plan.create).toBeNull();
  });

  it("re-opens the spare world only after the draining world with that number is gone", () => {
    expect(planWorlds([snap(1, WORLD_CAPACITY), snap(2, 1, { draining: true })]).create).toBeNull();
    expect(planWorlds([snap(1, WORLD_CAPACITY)]).create).toBe(2);
  });

  describe("merging", () => {
    it("moves the visitor of a lone world into the lowest other world with room", () => {
      const plan = planWorlds([snap(1, 5), snap(2, 3), snap(3, 1)]);
      expect(plan.relocation).toEqual({ source: 3, target: 1 });
    });

    it("never targets an empty world or a full one", () => {
      expect(planWorlds([snap(1, 0), snap(2, 1)]).relocation).toBeNull();
      expect(planWorlds([snap(1, WORLD_CAPACITY), snap(2, 1)]).relocation).toBeNull();
      expect(planWorlds([snap(1, WORLD_CAPACITY - 1), snap(2, 1)]).relocation).toEqual({ source: 2, target: 1 });
    });

    it("needs a visitor already inside the target and room that counts seats still waiting", () => {
      expect(planWorlds([snap(1, 1), snap(2, 0, { pending: 1 })]).relocation).toBeNull();
      expect(planWorlds([snap(1, WORLD_CAPACITY - 2, { pending: 1 }), snap(2, 1)]).relocation).toEqual({
        source: 2,
        target: 1,
      });
      expect(planWorlds([snap(1, WORLD_CAPACITY - 1, { pending: 1 }), snap(2, 1)]).relocation).toBeNull();
    });

    it("merges the higher of two lone worlds into the lower one", () => {
      expect(planWorlds([snap(1, 1), snap(2, 1)]).relocation).toEqual({ source: 2, target: 1 });
    });

    it("handles the highest-numbered lone world first", () => {
      const plan = planWorlds([snap(1, 6), snap(2, 1), snap(3, 1), snap(4, 1)]);
      expect(plan.relocation).toEqual({ source: 4, target: 1 });
    });

    it("offers a world with a seat already handed out as a target", () => {
      const plan = planWorlds([snap(1, 1), snap(2, WORLD_CAPACITY), snap(3, 1, { pending: 1 })]);
      expect(plan.relocation).toEqual({ source: 1, target: 3 });
    });

    it("does not merge a world with a seat handed out or one that is already draining", () => {
      expect(planWorlds([snap(1, 4), snap(2, 1, { pending: 1 })]).relocation).toBeNull();
      expect(planWorlds([snap(1, 4), snap(2, 1, { draining: true })]).relocation).toBeNull();
    });

    it("runs one relocation at a time", () => {
      const plan = planWorlds([snap(1, 4), snap(2, 1, { draining: true }), snap(3, 1)]);
      expect(plan.relocation).toBeNull();
    });
  });
});

class FakeRoom implements DirectoryRoom {
  population = 0;
  npcs = 6;
  zones = { gatbawi: 0, dharma: 0 };
  draining = false;
  closed = false;
  drainedTo: number | null = null;

  constructor(
    readonly world: number,
    private readonly directory: WorldDirectory,
  ) {
    this.roomId = `room${world}`;
  }

  readonly roomId: string;

  join(): void {
    this.population += 1;
    this.zones.gatbawi += 1;
    this.directory.joined(this);
  }

  leave(): void {
    this.population -= 1;
    this.zones.gatbawi -= 1;
    this.directory.changed();
  }

  drainMode: "ok" | "hang" | "fail" = "ok";

  async drain(target: number): Promise<void> {
    this.draining = true;
    this.drainedTo = target;
    if (this.drainMode === "hang") await new Promise<never>(() => undefined);
    if (this.drainMode === "fail") {
      this.draining = false;
      this.drainedTo = null;
      throw new Error("lock failed");
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.directory.unregister(this);
  }
}

function makeDirectory(reservationMs = 60_000) {
  const rooms = new Map<number, FakeRoom>();
  const errors: unknown[] = [];
  const created: number[] = [];
  const directory: WorldDirectory = new WorldDirectory({
    create: async (world) => {
      created.push(world);
      const room = new FakeRoom(world, directory);
      rooms.set(world, room);
      directory.register(room);
    },
    onError: (error) => errors.push(error),
    reservationMs,
  });
  return { directory, rooms, created, errors };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("WorldDirectory", () => {
  it("opens world 1 for the first seat and keeps it while the seat is waiting to be used", async () => {
    const { directory, created } = makeDirectory();
    const seat = await directory.seat(3);
    expect(seat).toEqual({ world: 1, roomId: "room1", fellBack: true });
    await settle();
    expect(created).toEqual([1]);
    expect(directory.list().map((info) => info.world)).toEqual([1]);
  });

  it("opens worlds one at a time as seats are handed out", async () => {
    const { directory, rooms, created } = makeDirectory();
    const seats = await Promise.all(Array.from({ length: WORLD_CAPACITY + 1 }, () => directory.seat(1)));
    await settle();
    expect(seats.filter((seat) => seat.world === 1)).toHaveLength(WORLD_CAPACITY);
    expect(seats[WORLD_CAPACITY]).toEqual({ world: 2, roomId: "room2", fellBack: true });
    expect(created).toEqual([1, 2]);
    expect([...rooms.keys()]).toEqual([1, 2]);
  });

  it("consumes a reservation when the visitor joins, so the world is not counted twice", async () => {
    const { directory, rooms } = makeDirectory();
    await directory.seat(null);
    rooms.get(1)!.join();
    await settle();
    expect(directory.list()).toEqual([
      { world: 1, roomId: "room1", clients: 1, npcs: 6, capacity: WORLD_CAPACITY, full: false, zones: { gatbawi: 1, dharma: 0 } },
    ]);
  });

  it("closes a world when its last visitor leaves", async () => {
    const { directory, rooms } = makeDirectory();
    await directory.seat(null);
    const room = rooms.get(1)!;
    room.join();
    await settle();
    room.leave();
    await settle();
    expect(room.closed).toBe(true);
    expect(directory.list()).toEqual([]);
  });

  it("closes a world whose seat was never used once the reservation lapses", async () => {
    const { directory, rooms } = makeDirectory(30);
    await directory.seat(null);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(rooms.get(1)!.closed).toBe(true);
    expect(directory.list()).toEqual([]);
  });

  it("opens the spare world at ten and closes it when the world drops below ten", async () => {
    const { directory, rooms, created } = makeDirectory();
    await directory.seat(null);
    const first = rooms.get(1)!;
    for (let i = 0; i < WORLD_SPARE_AT; i += 1) first.join();
    await settle();
    expect(created).toEqual([1, 2]);
    expect(rooms.get(2)!.closed).toBe(false);

    first.leave();
    await settle();
    expect(rooms.get(2)!.closed).toBe(true);
    expect(directory.list().map((info) => info.world)).toEqual([1]);
  });

  it("asks a lone visitor to move once another world has room and hides the draining world", async () => {
    const { directory, rooms } = makeDirectory();
    await directory.seat(null);
    const first = rooms.get(1)!;
    for (let i = 0; i < WORLD_CAPACITY; i += 1) first.join();
    await settle();
    const second = rooms.get(2)!;
    await directory.seat(2);
    second.join();
    await settle();
    expect(second.drainedTo).toBeNull();

    first.leave();
    await settle();
    expect(second.drainedTo).toBe(1);
    expect(directory.list().map((info) => info.world)).toEqual([1]);
    expect(await directory.seat(2)).toMatchObject({ world: 1, fellBack: true });

    second.leave();
    await settle();
    expect(second.closed).toBe(true);
  });

  it("seats a visitor who asks for the empty spare world in the crowded world and leaves them there", async () => {
    const { directory, rooms } = makeDirectory();
    await directory.seat(null);
    const first = rooms.get(1)!;
    for (let i = 0; i < WORLD_SPARE_AT; i += 1) first.join();
    await settle();
    const spare = rooms.get(2)!;

    expect(await directory.seat(2)).toEqual({ world: 1, roomId: "room1", fellBack: true });
    first.join();
    await settle();
    expect(first.drainedTo).toBeNull();
    expect(spare.drainedTo).toBeNull();
    expect(spare.closed).toBe(false);
  });

  describe("hand-overs", () => {
    async function loneVisitorInSecondWorld() {
      const rig = makeDirectory();
      await rig.directory.seat(null);
      const first = rig.rooms.get(1)!;
      for (let i = 0; i < WORLD_CAPACITY; i += 1) first.join();
      await settle();
      const second = rig.rooms.get(2)!;
      await rig.directory.seat(2);
      second.join();
      await settle();
      return { ...rig, first, second };
    }

    it("keeps handing out seats while a world is still locking for its hand-over", async () => {
      const { directory, first, second } = await loneVisitorInSecondWorld();
      second.drainMode = "hang";
      first.leave();
      await settle();
      expect(second.drainedTo).toBe(1);

      const outcome = await Promise.race([directory.seat(null), new Promise<"stalled">((resolve) => setTimeout(() => resolve("stalled"), 500))]);
      expect(outcome).toMatchObject({ world: 1 });
    });

    it("reports a failed hand-over and offers it again on the next change", async () => {
      const { directory, errors, first, second } = await loneVisitorInSecondWorld();
      second.drainMode = "fail";
      first.leave();
      await settle();
      expect(errors).toHaveLength(1);
      expect(second.draining).toBe(false);
      expect(directory.list().map((info) => info.world)).toEqual([1, 2]);

      second.drainMode = "ok";
      first.leave();
      await settle();
      expect(second.drainedTo).toBe(1);
      expect(directory.list().map((info) => info.world)).toEqual([1]);
    });
  });

  it("refuses seats while too many are waiting to be used and accepts again once one is taken", async () => {
    const { directory, rooms } = makeDirectory();
    for (let i = 0; i < MAX_PENDING_SEATS; i += 1) await directory.seat(null);
    await expect(directory.seat(null)).rejects.toBeInstanceOf(WorldsBusyError);

    rooms.get(1)!.join();
    await expect(directory.seat(null)).resolves.toMatchObject({ fellBack: false });
    await expect(directory.seat(null)).rejects.toBeInstanceOf(WorldsBusyError);
  });

  it("refuses seats once the server is shutting down", async () => {
    const { directory } = makeDirectory();
    await directory.close();
    await expect(directory.seat(null)).rejects.toBeInstanceOf(WorldsBusyError);
  });

  it("reports a failed world creation and keeps serving later seats", async () => {
    let attempts = 0;
    const rooms: FakeRoom[] = [];
    const directory: WorldDirectory = new WorldDirectory({
      create: async (world) => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
        const room = new FakeRoom(world, directory);
        rooms.push(room);
        directory.register(room);
      },
    });
    await expect(directory.seat(null)).rejects.toThrow("boom");
    await expect(directory.seat(null)).resolves.toMatchObject({ world: 1 });
    expect(rooms).toHaveLength(1);
  });
});
