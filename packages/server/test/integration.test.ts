import { logger } from "@colyseus/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BOW_MS,
  CHANT_MS,
  GATBAWI_SEATS,
  SEAT_COUNT,
  WORLDS_PATH,
  WORLD_BOUNDS,
  WORLD_CAPACITY,
  WORLD_SPARE_AT,
  ZONE_CAPACITY,
  MSG,
  SEAT_PATH,
  isWorldFullError,
} from "@dongjane/shared";
import { WorldRoom } from "../src/world-room.ts";
import { type GameServer, startGameServer } from "../src/server.ts";
import { type WorldClientRoom, TestRig, eventually, sleep, waitFor } from "./helpers.ts";

let game: GameServer;
let rig: TestRig;

beforeAll(async () => {
  game = await startGameServer({ port: 0, handleSignals: false, seatReservationMs: 1500, relocationGraceMs: 600 });
  rig = new TestRig(game.port);
});

afterEach(async () => {
  await rig.closeAll();
  await eventually(() => rig.worlds(), (worlds) => worlds.length === 0, "every world closed", 5000);
});

afterAll(async () => {
  await rig.closeAll();
  await game.stop();
});

describe("world list", () => {
  it("starts with no worlds open", async () => {
    expect(await rig.worlds()).toEqual([]);
  });

  it("opens world 1 for the first visitor and reflects joins in the client count", async () => {
    await rig.enter(1);
    await rig.enter(1);
    const world = await eventually(() => rig.world(1), (info) => info.clients === 2, "two clients counted");
    expect(world.capacity).toBe(WORLD_CAPACITY);
    expect(world.full).toBe(false);
    expect(world.zones).toEqual({ gatbawi: 2, dharma: 0 });
    expect(world.roomId).toEqual(expect.any(String));
    expect((await rig.worlds()).map((info) => info.world)).toEqual([1]);
  });

  it("closes a world once its last visitor leaves", async () => {
    const room = await rig.enter(1);
    await room.leave(true);
    await eventually(() => rig.worlds(), (worlds) => worlds.length === 0, "world 1 closed");
  });
});

describe("seating", () => {
  it("puts the first visitor in world 1 whichever number they ask for", async () => {
    const { seat } = await rig.arrive(7);
    expect(seat).toMatchObject({ world: 1, fellBack: true });
    const { seat: second } = await rig.arrive(null);
    expect(second).toMatchObject({ world: 1, fellBack: false });
  });

  it("opens world 2 when world 1 reaches ninety and closes it again when world 1 falls below ninety", async () => {
    const rooms = await rig.fill(1, WORLD_SPARE_AT - 1);
    expect((await rig.worlds()).map((info) => info.world)).toEqual([1]);

    rooms.push(await rig.enter(1));
    const worlds = await eventually(() => rig.worlds(), (list) => list.length === 2, "world 2 opened");
    expect(worlds.map((info) => [info.world, info.clients])).toEqual([
      [1, WORLD_SPARE_AT],
      [2, 0],
    ]);

    await rooms[0]!.leave(true);
    await eventually(() => rig.worlds(), (list) => list.length === 1, "spare world closed");
  }, 20_000);

  it("takes visitors to the world whose number they give and falls back to the lowest world with room", async () => {
    await rig.fill(1, WORLD_CAPACITY);
    await eventually(() => rig.worlds(), (list) => list.some((info) => info.world === 2), "world 2 opened");
    await rig.enter(2);

    expect(await rig.seat(2)).toMatchObject({ world: 2, fellBack: false });
    expect(await rig.seat(1)).toMatchObject({ world: 2, fellBack: true });
    expect(await rig.seat(9)).toMatchObject({ world: 2, fellBack: true });
    expect(await rig.seat(null)).toMatchObject({ world: 2, fellBack: false });
  }, 20_000);

  it("seats a visitor who asks for the empty spare world in the crowded world and does not merge them back", async () => {
    await rig.fill(1, WORLD_SPARE_AT);
    await eventually(() => rig.worlds(), (list) => list.some((info) => info.world === 2), "world 2 opened");

    const { seat, room } = await rig.arrive(2);
    expect(seat).toMatchObject({ world: 1, fellBack: true });
    const relocations: number[] = [];
    room.onMessage(MSG.relocate, (message: { world: number }) => relocations.push(message.world));
    await sleep(500);

    expect(relocations).toEqual([]);
    expect(room.connection.isOpen).toBe(true);
    expect((await rig.worlds()).map((info) => [info.world, info.clients])).toEqual([
      [1, WORLD_SPARE_AT + 1],
      [2, 0],
    ]);
  }, 20_000);

  it("treats an unusable world number as no preference", async () => {
    const response = await fetch(`http://127.0.0.1:${game.port}${SEAT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ world: "two" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ world: 1, fellBack: false });
    await rig.enter(1);
  });

  it("answers cross-origin requests from the page", async () => {
    const origin = "http://localhost:5173";
    const preflight = await fetch(`http://127.0.0.1:${game.port}${SEAT_PATH}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);

    const list = await fetch(`http://127.0.0.1:${game.port}${WORLDS_PATH}`, { headers: { origin } });
    expect(list.headers.get("access-control-allow-origin")).toBe(origin);

    const seat = await fetch(`http://127.0.0.1:${game.port}${SEAT_PATH}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ world: null }),
    });
    expect(seat.headers.get("access-control-allow-origin")).toBe(origin);
    await rig.join((await seat.json()) as Awaited<ReturnType<TestRig["seat"]>>);
  });
});

describe("merging worlds", () => {
  async function loneVisitorInWorld2() {
    const crowd = await rig.fill(1, WORLD_CAPACITY);
    await eventually(() => rig.worlds(), (list) => list.some((info) => info.world === 2), "world 2 opened");
    const lone = await rig.enter(2);
    const relocations: number[] = [];
    lone.onMessage(MSG.relocate, (message: { world: number }) => relocations.push(message.world));
    const before = await rig.world(2);
    await sleep(300);
    expect(relocations).toEqual([]);
    return { crowd, lone, relocations, before };
  }

  it("leaves a lone visitor alone while no other world has room", async () => {
    const { lone, before } = await loneVisitorInWorld2();
    expect((await rig.world(2)).roomId).toBe(before.roomId);
    expect(lone.connection.isOpen).toBe(true);
  }, 20_000);

  it("moves a lone visitor into the other world once it has room and closes the emptied world", async () => {
    const { crowd, lone, relocations, before } = await loneVisitorInWorld2();

    await crowd[0]!.leave(true);
    await waitFor(() => relocations.length > 0, "relocation notice", 3000);
    expect(relocations).toEqual([1]);

    const seat = await rig.seat(relocations[0]!);
    expect(seat).toMatchObject({ world: 1, fellBack: false });
    await lone.leave(true);
    const moved = await rig.join(seat);
    expect(moved.state.monks.size).toBe(WORLD_CAPACITY);

    const worlds = await eventually(
      () => rig.worlds(),
      (list) => list.every((info) => info.roomId !== before.roomId),
      "emptied world closed",
      4000,
    );
    expect(worlds.find((info) => info.world === 1)?.clients).toBe(WORLD_CAPACITY);
  }, 20_000);

  it("offers the hand-over again after one fails and does not leave the world stuck", async () => {
    const { crowd, relocations } = await loneVisitorInWorld2();
    const lock = vi.spyOn(WorldRoom.prototype, "lock").mockRejectedValueOnce(new Error("lock failed"));
    const reported = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await crowd[0]!.leave(true);
      await waitFor(() => reported.mock.calls.length > 0, "failure reported", 3000);
      expect(lock).toHaveBeenCalledTimes(1);
      expect((await rig.world(2)).clients).toBe(1);
      expect(relocations).toEqual([]);

      await crowd[1]!.leave(true);
      await waitFor(() => relocations.length > 0, "relocation notice after the retry", 3000);
      expect(relocations).toEqual([1]);
    } finally {
      lock.mockRestore();
      reported.mockRestore();
    }
  }, 20_000);

  it("holds a lone visitor back while the last free place in the other world is a seat waiting to be used", async () => {
    await rig.fill(1, WORLD_CAPACITY - 1);
    await eventually(() => rig.worlds(), (list) => list.some((info) => info.world === 2), "world 2 opened");
    await rig.seat(1);
    const lone = await rig.enter(2);
    const relocations: number[] = [];
    lone.onMessage(MSG.relocate, (message: { world: number }) => relocations.push(message.world));

    await sleep(500);
    expect(relocations).toEqual([]);
    expect(lone.connection.isOpen).toBe(true);

    await waitFor(() => relocations.length > 0, "relocation once the seat lapses", 4000);
    expect(relocations).toEqual([1]);
  }, 20_000);

  it("offers the merge again when closing the world fails after the grace period", async () => {
    const { crowd, lone, relocations } = await loneVisitorInWorld2();
    let left = false;
    lone.onLeave(() => {
      left = true;
    });
    const disconnect = vi.spyOn(WorldRoom.prototype, "disconnect").mockRejectedValueOnce(new Error("disconnect failed"));
    const reported = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await crowd[0]!.leave(true);
      await waitFor(() => reported.mock.calls.length > 0, "failure reported", 4000);
      expect(disconnect).toHaveBeenCalledTimes(1);

      await waitFor(() => relocations.length >= 2, "relocation notice sent again", 4000);
      await waitFor(() => left, "server closes the merged world on the retry", 4000, 25);
    } finally {
      disconnect.mockRestore();
      reported.mockRestore();
    }
  }, 20_000);

  it("closes the world on a visitor who does not follow the relocation notice", async () => {
    const { crowd, lone } = await loneVisitorInWorld2();
    let left = false;
    lone.onLeave(() => {
      left = true;
    });
    await crowd[0]!.leave(true);
    await waitFor(() => left, "server closes the merged world", 4000, 25);
  }, 20_000);
});

describe("two clients in one world", () => {
  it("shows A sitting and bowing to B within the time budget", async () => {
    const a = await rig.enter(1, { hue: 40 });
    const b = await rig.enter(1, { hue: 200 });

    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;
    expect(seenByB.slot).toBe(1);
    expect(seenByB.hue).toBe(40);
    expect(seenByB.mode).toBe("stand");
    expect(seenByB.zone).toBe("gatbawi");
    expect(b.state.seats.size).toBe(2 * SEAT_COUNT);

    a.send("sit", { zone: "gatbawi", seatId: 46 });
    await waitFor(() => seenByB.seatId === 46, "B sees A claim mat 46", 1000);
    expect(b.state.seats.get("gatbawi:46")?.occupantId).toBe(a.sessionId);
    await waitFor(() => seenByB.mode === "walk", "B sees A walking", 1000);
    await waitFor(() => seenByB.mode === "kneel", "B sees A kneeling", 6000);
    expect(seenByB.x).toBeCloseTo(GATBAWI_SEATS[46]!.x, 1);
    expect(seenByB.z).toBeCloseTo(GATBAWI_SEATS[46]!.z, 1);

    const sentAt = Date.now();
    a.send("bow", { times: 1 });
    await waitFor(() => seenByB.mode === "bow", "B sees A bowing", 1000);
    expect(Date.now() - sentAt).toBeLessThan(1000);

    await waitFor(() => seenByB.bowCount === 1, "B sees bowCount 1", BOW_MS + 1000);
    expect(seenByB.mode).toBe("kneel");
    expect(a.state.monks.get(a.sessionId)?.bowCount).toBe(1);
  });

  it("seats a full zone of fifty visitors on fifty different mats", async () => {
    const crowd = await rig.fill(1, ZONE_CAPACITY);
    const watcher = crowd[0]!;
    await waitFor(() => watcher.state.monks.size === ZONE_CAPACITY, "everyone is in view", 3000);

    crowd.forEach((room, index) => room.send("sit", { zone: "gatbawi", seatId: index }));
    await waitFor(
      () => [...watcher.state.monks.values()].filter((monk) => monk.mode === "kneel").length === ZONE_CAPACITY,
      "all fifty kneel",
      15_000,
    );

    const mats = new Set([...watcher.state.monks.values()].map((monk) => monk.seatId));
    expect(mats.size).toBe(ZONE_CAPACITY);
    expect([...mats].sort((a, b) => a - b)).toEqual(Array.from({ length: SEAT_COUNT }, (_, id) => id));
    for (const seat of watcher.state.seats.values()) {
      if (seat.zone === "gatbawi") expect(seat.occupantId).not.toBe("");
      else expect(seat.occupantId).toBe("");
    }
  }, 30_000);

  it("performs 삼배 as three bows visible to the other client", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;

    a.send("sit", { zone: "gatbawi", seatId: 47 });
    await waitFor(() => seenByB.mode === "kneel", "A kneels", 6000);
    a.send("bow", { times: 3 });
    await waitFor(() => seenByB.mode === "bow", "first bow", 1000);
    await waitFor(() => seenByB.bowCount === 3, "three bows", 3 * BOW_MS + 3000, 25);
    await waitFor(() => seenByB.mode === "kneel", "back to kneel", 1000);
  }, 20_000);

  it("rejects a bow while standing and keeps bowCount at zero", async () => {
    const a = await rig.enter(1);
    a.send("bow", { times: 1 });
    await sleep(300);
    const monk = a.state.monks.get(a.sessionId)!;
    expect(monk.mode).toBe("stand");
    expect(monk.bowCount).toBe(0);
  });

  it("removes a monk and frees the seat when its client leaves", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    a.send("sit", { zone: "gatbawi", seatId: 5 });
    await waitFor(() => b.state.seats.get("gatbawi:5")?.occupantId === a.sessionId, "A holds seat 5");
    const leaverId = a.sessionId;
    await a.leave(true);
    await waitFor(() => !b.state.monks.has(leaverId), "A removed");
    await waitFor(() => b.state.seats.get("gatbawi:5")?.occupantId === "", "seat freed");
  });
});

describe("seat exclusivity", () => {
  it("gives a mat that ten clients grab at once to exactly one of them", async () => {
    const rooms = await Promise.all(Array.from({ length: 10 }, () => rig.enter(1)));
    for (const room of rooms) room.send("sit", { zone: "gatbawi", seatId: 2 });
    const observer = rooms[0]!;
    await waitFor(() => observer.state.seats.get("gatbawi:2")?.occupantId !== "", "mat claimed");
    await sleep(300);

    const owners = [...observer.state.monks.values()].filter((monk) => monk.seatId === 2);
    expect(owners).toHaveLength(1);
    expect(observer.state.seats.get("gatbawi:2")?.occupantId).toBe(owners[0]!.id);
    const others = [...observer.state.monks.values()].filter((monk) => monk.seatId !== 2);
    expect(others).toHaveLength(9);
    for (const monk of others) expect(monk.seatId).toBe(-1);
  });

  it("hands the mat to the next monk after the owner stands", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    a.send("sit", { zone: "gatbawi", seatId: 0 });
    await waitFor(() => b.state.seats.get("gatbawi:0")?.occupantId === a.sessionId, "A claims");
    b.send("sit", { zone: "gatbawi", seatId: 0 });
    await sleep(200);
    expect(b.state.seats.get("gatbawi:0")?.occupantId).toBe(a.sessionId);
    expect(b.state.monks.get(b.sessionId)?.seatId).toBe(-1);

    a.send("stand", {});
    await waitFor(() => b.state.seats.get("gatbawi:0")?.occupantId === "", "A stands, mat freed");
    b.send("sit", { zone: "gatbawi", seatId: 0 });
    await waitFor(() => b.state.seats.get("gatbawi:0")?.occupantId === b.sessionId, "B claims");
  });

  it("ignores a seat in the zone the visitor is not in", async () => {
    const a = await rig.enter(1);
    a.send("sit", { zone: "dharma", seatId: 0 });
    a.send("sit", { zone: "gatbawi", seatId: 99 });
    a.send("sit", { zone: "garden", seatId: 0 });
    a.send("sit", { ["mat" + "Id"]: 0 }); // the field name an older cached client still sends
    await sleep(300);
    expect(a.state.monks.get(a.sessionId)?.seatId).toBe(-1);
    expect([...a.state.seats.values()].every((seat) => seat.occupantId === "")).toBe(true);
  });
});

describe("zones", () => {
  it("places a visitor in the zone they ask for and sends them to its entrance", async () => {
    const { room } = await rig.arrive(1, { zone: "dharma" });
    const monk = room.state.monks.get(room.sessionId)!;
    expect(monk.zone).toBe("dharma");
    expect(monk.z).toBeCloseTo(7.4, 3);
    expect(await eventually(() => rig.world(1), (info) => info.zones.dharma === 1, "dharma counted")).toMatchObject({
      zones: { gatbawi: 0, dharma: 1 },
    });
  });

  it("puts a visitor with no valid zone in Gatbawi", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1, { zone: "garden" as never });
    expect(a.state.monks.get(a.sessionId)?.zone).toBe("gatbawi");
    expect(b.state.monks.get(b.sessionId)?.zone).toBe("gatbawi");
  });

  it("moves a visitor to the best seat of the other zone and back", async () => {
    const a = await rig.enter(1);
    a.send("zone", { zone: "dharma" });
    await waitFor(() => a.state.monks.get(a.sessionId)?.zone === "dharma", "A is in the dharma zone", 1000);
    expect(a.state.monks.get(a.sessionId)?.seatId).toBe(4);
    expect(a.state.seats.get("dharma:4")?.occupantId).toBe(a.sessionId);

    a.send("zone", { zone: "gatbawi" });
    await sleep(300);
    expect(a.state.monks.get(a.sessionId)?.zone).toBe("dharma");

    await sleep(1800);
    a.send("zone", { zone: "gatbawi" });
    await waitFor(() => a.state.monks.get(a.sessionId)?.zone === "gatbawi", "A is back outdoors", 1000);
    expect(a.state.seats.get("dharma:4")?.occupantId).toBe("");
    expect(a.state.monks.get(a.sessionId)?.seatId).toBe(2);
  }, 20_000);

  it("ignores a zone change message that names no zone", async () => {
    const a = await rig.enter(1);
    a.send("zone", { zone: "garden" });
    a.send("zone", null);
    await sleep(300);
    expect(a.state.monks.get(a.sessionId)?.zone).toBe("gatbawi");
  });
});

describe("capacity", () => {
  it("fills a world to 100 and seats the 101st visitor in the next world", async () => {
    const entered = await Promise.all(Array.from({ length: WORLD_CAPACITY }, () => rig.enter(1)));
    expect(entered).toHaveLength(WORLD_CAPACITY);

    const full = await eventually(() => rig.world(1), (info) => info.full, "world 1 reported full");
    expect(full.clients).toBe(WORLD_CAPACITY);

    const rejection = await rig.client.joinById(full.roomId, {}, undefined).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    expect(isWorldFullError(rejection)).toBe(true);

    const { seat } = await rig.arrive(1);
    expect(seat).toMatchObject({ world: 2, fellBack: true });
    const worlds = await eventually(() => rig.worlds(), (list) => list.find((info) => info.world === 2)?.clients === 1, "world 2 counted");
    expect(worlds.map((info) => info.world)).toEqual([1, 2]);
    expect(worlds.filter((info) => info.full).map((info) => info.world)).toEqual([1]);
  }, 30_000);
});

describe("hardening", () => {
  it("does not let clients create rooms", async () => {
    await rig.enter(1);
    const before = await rig.worlds();
    const outcome = (attempt: Promise<unknown>) =>
      attempt.then(
        () => "created",
        (error: { code?: number }) => `rejected:${error.code}`,
      );
    const attempts = await Promise.all([
      outcome(rig.client.create("world", { world: 1 })),
      outcome(rig.client.create("world", { world: 1, key: "guess" })),
      outcome(rig.client.create("world", { world: 99 })),
    ]);
    expect(attempts).toEqual(["rejected:403", "rejected:403", "rejected:403"]);
    const after = await rig.worlds();
    expect(after.map((world) => world.roomId)).toEqual(before.map((world) => world.roomId));
  });

  it("ignores NaN and Infinity move targets", async () => {
    const a = await rig.enter(1);
    const monk = a.state.monks.get(a.sessionId)!;
    const { x, z } = monk;
    a.send("move", { x: Number.NaN, z: 0 });
    a.send("move", { x: 0, z: Number.POSITIVE_INFINITY });
    a.send("move", { x: "1", z: 0 });
    a.send("move", null);
    await sleep(300);
    expect(monk.mode).toBe("stand");
    expect(monk.x).toBe(x);
    expect(monk.z).toBe(z);
    expect(Number.isFinite(monk.x) && Number.isFinite(monk.z)).toBe(true);

    a.send("move", { x: 1e9, z: 1e9 });
    await waitFor(() => monk.mode === "walk", "valid move accepted");
    await waitFor(
      () => monk.x > WORLD_BOUNDS.maxX - 0.1 && monk.z > WORLD_BOUNDS.maxZ - 0.1,
      "clamped to the walkable corner",
      8000,
    );
    expect(monk.x).toBeLessThanOrEqual(Math.fround(WORLD_BOUNDS.maxX));
    expect(monk.z).toBeLessThanOrEqual(Math.fround(WORLD_BOUNDS.maxZ));
  }, 15_000);

  it("keeps serving a client after a message flood passes the rate window", async () => {
    const a = await rig.enter(1);
    for (let i = 0; i < 50; i += 1) a.send("stand");
    await sleep(1200);
    a.send("sit", { zone: "gatbawi", seatId: 47 });
    await waitFor(() => a.state.monks.get(a.sessionId)?.mode === "kneel", "sit accepted after the flood", 6000);
  });

  it("ignores any name a client sends and numbers visitors by arrival", async () => {
    const a = await rig.enter(1, { name: "무시됨" } as unknown as { hue: number });
    const b = await rig.enter(1);
    const monkA = a.state.monks.get(a.sessionId)!;
    expect(monkA.slot).toBe(1);
    expect(b.state.monks.get(b.sessionId)?.slot).toBe(2);
    expect("name" in monkA).toBe(false);
  });

  it("clamps hue from join options", async () => {
    const a = await rig.enter(1, { hue: 725 });
    expect(a.state.monks.get(a.sessionId)?.hue).toBe(5);
    const b = await rig.enter(1, { hue: Number.NaN });
    const hue = b.state.monks.get(b.sessionId)!.hue;
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});

describe("chant", () => {
  it("publishes the next chant time to clients", async () => {
    const a = await rig.enter(1);
    const chant = a.state.chant;
    expect(chant.durationMs).toBe(CHANT_MS);
    expect(chant.label).toMatch(/^\d{2}:\d{2} 예불$/);
    expect(chant.startsAt + chant.durationMs).toBeGreaterThan(Date.now());
    expect(chant.startsAt % (30 * 60 * 1000)).toBe(0);
  });
});
