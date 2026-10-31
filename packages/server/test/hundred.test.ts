import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ARRIVAL, WORLD_CAPACITY, ZONE_CAPACITY, ZONES, venueAt } from "@dongjane/shared";
import { type GameServer, startGameServer } from "../src/server.ts";
import { type WorldClientRoom, TestRig, eventually, sleep, waitFor } from "./helpers.ts";

let game: GameServer;
let rig: TestRig;

beforeAll(async () => {
  game = await startGameServer({ port: 0, handleSignals: false, seatReservationMs: 5000, relocationGraceMs: 600 });
  rig = new TestRig(game.port);
});

afterEach(async () => {
  await rig.closeAll();
  await eventually(() => rig.worlds(), (worlds) => worlds.length === 0, "every world closed", 10_000);
});

afterAll(async () => {
  await rig.closeAll();
  await game.stop();
});

const humansIn = (room: WorldClientRoom) => [...room.state.monks.values()].filter((monk) => !monk.npc);

describe("a hundred visitors", () => {
  it("lets a hundred arrive in the 법당, then sends the 101st to the next world", async () => {
    const everyone = await rig.fill(1, WORLD_CAPACITY);
    expect(everyone).toHaveLength(WORLD_CAPACITY);
    for (const room of everyone) {
      const monk = room.state.monks.get(room.sessionId)!;
      expect(venueAt(monk.x, monk.z)).toBe("dharma");
      expect(Math.abs(monk.x - ARRIVAL.x)).toBeLessThanOrEqual(ARRIVAL.spread);
    }

    const world = await eventually(() => rig.world(1), (info) => info.clients === WORLD_CAPACITY, "world 1 holds a hundred", 5000);
    expect(world.full).toBe(true);
    expect(world.zones).toEqual({ gatbawi: 0, dharma: WORLD_CAPACITY, bathhouse: 0 });

    const late = await rig.arrive(null);
    expect(late.seat.world).toBe(2);
    const second = await eventually(() => rig.world(2), (info) => info.clients === 1, "world 2 counts the 101st", 3000);
    expect(second.zones).toEqual({ gatbawi: 0, dharma: 1, bathhouse: 0 });

    const watcher = everyone[0]!;
    await waitFor(() => humansIn(watcher).length === WORLD_CAPACITY, "the watcher sees everyone", 5000);
  }, 60_000);

  it("walks fifty to their mats and fifty through the doorway to their 방석, one seat each", async () => {
    const crowd = await rig.fill(1, WORLD_CAPACITY);
    const watcher = crowd[0]!;
    await waitFor(() => humansIn(watcher).length === WORLD_CAPACITY, "everyone is in view", 5000);

    crowd.forEach((room, index) => {
      const zone = ZONES[Math.floor(index / ZONE_CAPACITY)]!;
      room.send("sit", { zone, seatId: index % ZONE_CAPACITY });
    });
    await waitFor(
      () => humansIn(watcher).filter((monk) => monk.mode === "kneel").length === WORLD_CAPACITY,
      "all hundred kneel",
      40_000,
      50,
    );

    const holders = new Set<string>();
    for (const seat of watcher.state.seats.values()) {
      if (seat.occupantId === "" || watcher.state.monks.get(seat.occupantId)?.npc) continue;
      expect(holders.has(seat.occupantId), `${seat.occupantId} holds two seats`).toBe(false);
      holders.add(seat.occupantId);
    }
    expect(holders.size).toBe(WORLD_CAPACITY);

    const world = await eventually(() => rig.world(1), (info) => info.zones.dharma === ZONE_CAPACITY, "fifty counted indoors", 5000);
    expect(world.zones).toEqual({ gatbawi: ZONE_CAPACITY, dharma: ZONE_CAPACITY, bathhouse: 0 });
  }, 90_000);

  it("never double-books a seat when a hundred visitors sit at once", async () => {
    const crowd = await rig.fill(1, WORLD_CAPACITY);
    const watcher = crowd[0]!;
    await waitFor(() => humansIn(watcher).length === WORLD_CAPACITY, "everyone is in view", 5000);

    // Everyone goes for one of the first ten seats of one of the two zones, so most of the requests collide.
    crowd.forEach((room, index) => room.send("sit", { zone: ZONES[index % 2]!, seatId: Math.floor(index / 2) % 10 }));
    await sleep(600);

    const holders = new Map<string, string>();
    for (const [key, seat] of watcher.state.seats) {
      if (seat.occupantId === "" || watcher.state.monks.get(seat.occupantId)?.npc) continue;
      expect(holders.has(seat.occupantId), `${seat.occupantId} holds two seats`).toBe(false);
      holders.set(seat.occupantId, key);
      const monk = watcher.state.monks.get(seat.occupantId)!;
      expect(key).toBe(`${seat.zone}:${monk.seatId}`);
    }
    expect(holders.size).toBe(20);
    expect(humansIn(watcher).filter((monk) => monk.seatId >= 0)).toHaveLength(20);
  }, 60_000);
});
