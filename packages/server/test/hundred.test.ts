import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WORLD_CAPACITY, ZONE_CAPACITY, type Zone } from "@dongjane/shared";
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

const zoneOf = (room: WorldClientRoom): Zone => room.state.monks.get(room.sessionId)!.zone as Zone;
const inZone = (rooms: WorldClientRoom[], zone: Zone) => rooms.filter((room) => zoneOf(room) === zone);
const humansIn = (room: WorldClientRoom) => [...room.state.monks.values()].filter((monk) => !monk.npc);

describe("a hundred visitors", () => {
  it("seats fifty outdoors and fifty indoors, then sends the 101st to the next world", async () => {
    const outdoors = await rig.fill(1, 60, { zone: "gatbawi" });
    expect(inZone(outdoors, "gatbawi")).toHaveLength(ZONE_CAPACITY);
    const turnedAway = inZone(outdoors, "dharma");
    expect(turnedAway).toHaveLength(10);
    for (const room of turnedAway) expect(rig.refusals.get(room)).toEqual(["gatbawi"]);
    for (const room of inZone(outdoors, "gatbawi")) expect(rig.refusals.get(room)).toEqual([]);

    const indoors = await rig.fill(1, 40, { zone: "dharma" });
    for (const room of indoors) {
      expect(zoneOf(room)).toBe("dharma");
      expect(rig.refusals.get(room)).toEqual([]);
    }

    const everyone = [...outdoors, ...indoors];
    expect(everyone).toHaveLength(WORLD_CAPACITY);
    const world = await eventually(() => rig.world(1), (info) => info.clients === WORLD_CAPACITY, "world 1 holds a hundred", 5000);
    expect(world.full).toBe(true);
    expect(world.zones).toEqual({ gatbawi: ZONE_CAPACITY, dharma: ZONE_CAPACITY });

    const late = await rig.arrive(null);
    expect(late.seat.world).toBe(2);
    expect(zoneOf(late.room)).toBe("gatbawi");
    const second = await eventually(() => rig.world(2), (info) => info.clients === 1, "world 2 counts the 101st", 3000);
    expect(second.zones).toEqual({ gatbawi: 1, dharma: 0 });

    const watcher = everyone[0]!;
    await waitFor(() => humansIn(watcher).length === WORLD_CAPACITY, "the watcher sees everyone", 5000);
  }, 60_000);

  it("refuses a move into a full zone and lets it through once someone leaves", async () => {
    const outdoors = await rig.fill(1, 50, { zone: "gatbawi" });
    const indoors = await rig.fill(1, 50, { zone: "dharma" });
    const mover = outdoors[0]!;
    const refusals = rig.refusals.get(mover)!;

    mover.send("zone", { zone: "dharma" });
    await waitFor(() => refusals.length === 1, "the dharma zone answers that it is full", 3000);
    expect(refusals).toEqual(["dharma"]);
    expect(zoneOf(mover)).toBe("gatbawi");

    const leaver = indoors[0]!;
    const leaverId = leaver.sessionId;
    await leaver.leave(true);
    await waitFor(() => !mover.state.monks.has(leaverId), "one visitor leaves the dharma zone", 3000);

    mover.send("zone", { zone: "dharma" });
    await waitFor(() => zoneOf(mover) === "dharma", "the mover is let in", 3000);
    expect(refusals).toEqual(["dharma"]);
    expect(mover.state.monks.get(mover.sessionId)!.seatId).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("never double-books a seat or overfills a zone when a hundred visitors sit at once", async () => {
    const outdoors = await rig.fill(1, 50, { zone: "gatbawi" });
    const indoors = await rig.fill(1, 50, { zone: "dharma" });
    const watcher = outdoors[0]!;
    await waitFor(() => humansIn(watcher).length === WORLD_CAPACITY, "everyone is in view", 5000);

    // Everyone goes for one of the first ten seats of their own zone, so most of the requests collide.
    outdoors.forEach((room, index) => room.send("sit", { zone: "gatbawi", seatId: index % 10 }));
    indoors.forEach((room, index) => room.send("sit", { zone: "dharma", seatId: index % 10 }));
    await sleep(600);

    const holders = new Map<string, string>();
    for (const [key, seat] of watcher.state.seats) {
      if (seat.occupantId === "" || watcher.state.monks.get(seat.occupantId)?.npc) continue;
      expect(holders.has(seat.occupantId), `${seat.occupantId} holds two seats`).toBe(false);
      holders.set(seat.occupantId, key);
      const monk = watcher.state.monks.get(seat.occupantId)!;
      expect(key).toBe(`${monk.zone}:${monk.seatId}`);
    }
    expect(holders.size).toBe(20);
    const perZone: Record<Zone, number> = { gatbawi: 0, dharma: 0 };
    for (const monk of humansIn(watcher)) perZone[monk.zone as Zone] += 1;
    expect(perZone).toEqual({ gatbawi: ZONE_CAPACITY, dharma: ZONE_CAPACITY });
  }, 60_000);
});
