import { logger } from "@colyseus/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BOW_MS,
  CHANT_MS,
  EMOTE_COOLDOWN_MS,
  HALLS_PATH,
  HALL_CAPACITY,
  HALL_SPARE_AT,
  MSG,
  NPC_PER_HALL,
  SEAT_PATH,
  isHallFullError,
} from "@dongjane/shared";
import { HallRoom } from "../src/hall-room.ts";
import { type GameServer, startGameServer } from "../src/server.ts";
import { type HallClientRoom, TestRig, eventually, sleep, waitFor } from "./helpers.ts";

let game: GameServer;
let rig: TestRig;

const humansIn = (room: HallClientRoom) => [...room.state.monks.values()].filter((monk) => !monk.npc);

beforeAll(async () => {
  game = await startGameServer({ port: 0, handleSignals: false, seatReservationMs: 1500, relocationGraceMs: 600 });
  rig = new TestRig(game.port);
});

afterEach(async () => {
  await rig.closeAll();
  await eventually(() => rig.halls(), (halls) => halls.length === 0, "every hall closed", 5000);
});

afterAll(async () => {
  await rig.closeAll();
  await game.stop();
});

describe("hall list", () => {
  it("starts with no halls open", async () => {
    expect(await rig.halls()).toEqual([]);
  });

  it("opens hall 1 for the first visitor and reflects joins in the client count", async () => {
    await rig.enter(1);
    await rig.enter(1);
    const hall = await eventually(() => rig.hall(1), (info) => info.clients === 2, "two clients counted");
    expect(hall.capacity).toBe(HALL_CAPACITY);
    expect(hall.full).toBe(false);
    expect(hall.roomId).toEqual(expect.any(String));
    expect((await rig.halls()).map((info) => info.hall)).toEqual([1]);
  });

  it("fills the hall with npc monks that the visitor count and seat numbers ignore", async () => {
    const room = await rig.enter(1);
    const monks = [...room.state.monks.values()];
    expect(monks.filter((monk) => monk.npc)).toHaveLength(NPC_PER_HALL);
    expect(monks.filter((monk) => monk.npc).every((monk) => monk.slot === 0)).toBe(true);
    expect(room.state.monks.get(room.sessionId)).toMatchObject({ npc: false, slot: 1 });
    const hall = await eventually(() => rig.hall(1), (info) => info.clients === 1, "one visitor counted");
    expect(hall.full).toBe(false);
  });

  it("closes a hall once its last visitor leaves", async () => {
    const room = await rig.enter(1);
    await room.leave(true);
    await eventually(() => rig.halls(), (halls) => halls.length === 0, "hall 1 closed");
  });
});

describe("seating", () => {
  it("puts the first visitor in hall 1 whichever number they ask for", async () => {
    const { seat } = await rig.arrive(7);
    expect(seat).toMatchObject({ hall: 1, fellBack: true });
    const { seat: second } = await rig.arrive(null);
    expect(second).toMatchObject({ hall: 1, fellBack: false });
  });

  it("opens hall 2 when hall 1 reaches ten and closes it again when hall 1 falls below ten", async () => {
    const rooms = await rig.fill(1, HALL_SPARE_AT - 1);
    expect((await rig.halls()).map((info) => info.hall)).toEqual([1]);

    rooms.push(await rig.enter(1));
    const halls = await eventually(() => rig.halls(), (list) => list.length === 2, "hall 2 opened");
    expect(halls.map((info) => [info.hall, info.clients])).toEqual([
      [1, HALL_SPARE_AT],
      [2, 0],
    ]);

    await rooms[0]!.leave(true);
    await eventually(() => rig.halls(), (list) => list.length === 1, "spare hall closed");
  }, 20_000);

  it("takes visitors to the hall whose number they give and falls back to the lowest hall with room", async () => {
    await rig.fill(1, HALL_CAPACITY);
    await eventually(() => rig.halls(), (list) => list.some((info) => info.hall === 2), "hall 2 opened");
    await rig.enter(2);

    expect(await rig.seat(2)).toMatchObject({ hall: 2, fellBack: false });
    expect(await rig.seat(1)).toMatchObject({ hall: 2, fellBack: true });
    expect(await rig.seat(9)).toMatchObject({ hall: 2, fellBack: true });
    expect(await rig.seat(null)).toMatchObject({ hall: 2, fellBack: false });
  }, 20_000);

  it("seats a visitor who asks for the empty spare hall in the crowded hall and does not merge them back", async () => {
    await rig.fill(1, HALL_SPARE_AT);
    await eventually(() => rig.halls(), (list) => list.some((info) => info.hall === 2), "hall 2 opened");

    const { seat, room } = await rig.arrive(2);
    expect(seat).toMatchObject({ hall: 1, fellBack: true });
    const relocations: number[] = [];
    room.onMessage(MSG.relocate, (message: { hall: number }) => relocations.push(message.hall));
    await sleep(500);

    expect(relocations).toEqual([]);
    expect(room.connection.isOpen).toBe(true);
    expect((await rig.halls()).map((info) => [info.hall, info.clients])).toEqual([
      [1, HALL_SPARE_AT + 1],
      [2, 0],
    ]);
  }, 20_000);

  it("treats an unusable hall number as no preference", async () => {
    const response = await fetch(`http://127.0.0.1:${game.port}${SEAT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hall: "two" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hall: 1, fellBack: false });
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

    const list = await fetch(`http://127.0.0.1:${game.port}${HALLS_PATH}`, { headers: { origin } });
    expect(list.headers.get("access-control-allow-origin")).toBe(origin);

    const seat = await fetch(`http://127.0.0.1:${game.port}${SEAT_PATH}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ hall: null }),
    });
    expect(seat.headers.get("access-control-allow-origin")).toBe(origin);
    await rig.join((await seat.json()) as Awaited<ReturnType<TestRig["seat"]>>);
  });
});

describe("merging halls", () => {
  async function loneVisitorInHall2() {
    const crowd = await rig.fill(1, HALL_CAPACITY);
    await eventually(() => rig.halls(), (list) => list.some((info) => info.hall === 2), "hall 2 opened");
    const lone = await rig.enter(2);
    const relocations: number[] = [];
    lone.onMessage(MSG.relocate, (message: { hall: number }) => relocations.push(message.hall));
    const before = await rig.hall(2);
    await sleep(300);
    expect(relocations).toEqual([]);
    return { crowd, lone, relocations, before };
  }

  it("leaves a lone visitor alone while no other hall has room", async () => {
    const { lone, before } = await loneVisitorInHall2();
    expect((await rig.hall(2)).roomId).toBe(before.roomId);
    expect(lone.connection.isOpen).toBe(true);
  }, 20_000);

  it("moves a lone visitor into the other hall once it has room and closes the emptied hall", async () => {
    const { crowd, lone, relocations, before } = await loneVisitorInHall2();

    await crowd[0]!.leave(true);
    await waitFor(() => relocations.length > 0, "relocation notice", 3000);
    expect(relocations).toEqual([1]);

    const seat = await rig.seat(relocations[0]!);
    expect(seat).toMatchObject({ hall: 1, fellBack: false });
    await lone.leave(true);
    const moved = await rig.join(seat);
    expect(humansIn(moved)).toHaveLength(HALL_CAPACITY);

    const halls = await eventually(
      () => rig.halls(),
      (list) => list.every((info) => info.roomId !== before.roomId),
      "emptied hall closed",
      4000,
    );
    expect(halls.find((info) => info.hall === 1)?.clients).toBe(HALL_CAPACITY);
  }, 20_000);

  it("offers the hand-over again after one fails and does not leave the hall stuck", async () => {
    const { crowd, relocations } = await loneVisitorInHall2();
    const lock = vi.spyOn(HallRoom.prototype, "lock").mockRejectedValueOnce(new Error("lock failed"));
    const reported = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await crowd[0]!.leave(true);
      await waitFor(() => reported.mock.calls.length > 0, "failure reported", 3000);
      expect(lock).toHaveBeenCalledTimes(1);
      expect((await rig.hall(2)).clients).toBe(1);
      expect(relocations).toEqual([]);

      await crowd[1]!.leave(true);
      await waitFor(() => relocations.length > 0, "relocation notice after the retry", 3000);
      expect(relocations).toEqual([1]);
    } finally {
      lock.mockRestore();
      reported.mockRestore();
    }
  }, 20_000);

  it("holds a lone visitor back while the last free place in the other hall is a seat waiting to be used", async () => {
    await rig.fill(1, HALL_CAPACITY - 1);
    await eventually(() => rig.halls(), (list) => list.some((info) => info.hall === 2), "hall 2 opened");
    await rig.seat(1);
    const lone = await rig.enter(2);
    const relocations: number[] = [];
    lone.onMessage(MSG.relocate, (message: { hall: number }) => relocations.push(message.hall));

    await sleep(500);
    expect(relocations).toEqual([]);
    expect(lone.connection.isOpen).toBe(true);

    await waitFor(() => relocations.length > 0, "relocation once the seat lapses", 4000);
    expect(relocations).toEqual([1]);
  }, 20_000);

  it("offers the merge again when closing the hall fails after the grace period", async () => {
    const { crowd, lone, relocations } = await loneVisitorInHall2();
    let left = false;
    lone.onLeave(() => {
      left = true;
    });
    const disconnect = vi.spyOn(HallRoom.prototype, "disconnect").mockRejectedValueOnce(new Error("disconnect failed"));
    const reported = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await crowd[0]!.leave(true);
      await waitFor(() => reported.mock.calls.length > 0, "failure reported", 4000);
      expect(disconnect).toHaveBeenCalledTimes(1);

      await waitFor(() => relocations.length >= 2, "relocation notice sent again", 4000);
      await waitFor(() => left, "server closes the merged hall on the retry", 4000, 25);
    } finally {
      disconnect.mockRestore();
      reported.mockRestore();
    }
  }, 20_000);

  it("closes the hall on a visitor who does not follow the relocation notice", async () => {
    const { crowd, lone } = await loneVisitorInHall2();
    let left = false;
    lone.onLeave(() => {
      left = true;
    });
    await crowd[0]!.leave(true);
    await waitFor(() => left, "server closes the merged hall", 4000, 25);
  }, 20_000);
});

describe("two clients in one hall", () => {
  it("shows A sitting and bowing to B within the time budget", async () => {
    const a = await rig.enter(1, { hue: 40 });
    const b = await rig.enter(1, { hue: 200 });

    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;
    expect(seenByB.slot).toBe(1);
    expect(seenByB.hue).toBe(40);
    expect(seenByB.mode).toBe("stand");
    expect(b.state.cushions.size).toBe(8);

    a.send("sit", { cushionId: 7 });
    await waitFor(() => seenByB.cushionId === 7, "B sees A claim cushion 7", 1000);
    expect(b.state.cushions.get("7")?.occupantId).toBe(a.sessionId);
    await waitFor(() => seenByB.mode === "walk", "B sees A walking", 1000);
    await waitFor(() => seenByB.mode === "kneel", "B sees A kneeling", 6000);
    expect(seenByB.x).toBeCloseTo(3, 1);
    expect(seenByB.z).toBeCloseTo(1.2, 1);

    const sentAt = Date.now();
    a.send("bow", { times: 1 });
    await waitFor(() => seenByB.mode === "bow", "B sees A bowing", 1000);
    expect(Date.now() - sentAt).toBeLessThan(1000);

    await waitFor(() => seenByB.bowCount === 1, "B sees bowCount 1", BOW_MS + 1000);
    expect(seenByB.mode).toBe("kneel");
    expect(a.state.monks.get(a.sessionId)?.bowCount).toBe(1);
  });

  it("performs 삼배 as three bows visible to the other client", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;

    a.send("sit", { cushionId: 6 });
    await waitFor(() => seenByB.mode === "kneel", "A kneels", 6000);
    a.send("bow", { times: 3 });
    await waitFor(() => seenByB.mode === "bow", "first bow", 1000);
    await waitFor(() => seenByB.bowCount === 3, "three bows", 3 * BOW_MS + 3000, 25);
    await waitFor(() => seenByB.mode === "kneel", "back to kneel", 1000);
  }, 20_000);

  it("shows A's emoticon to B and to A, and ignores bad payloads and a repeat inside the cooldown", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;
    const own = a.state.monks.get(a.sessionId)!;
    expect(seenByB.emoteSeq).toBe(0);

    a.send(MSG.emote, { id: 99 });
    a.send(MSG.emote, { id: "1" });
    a.send(MSG.emote, null);
    await sleep(300);
    expect(seenByB.emoteSeq).toBe(0);

    a.send(MSG.emote, { id: 5 });
    await waitFor(() => seenByB.emoteSeq === 1, "B sees A's emoticon", 1000);
    expect(seenByB.emote).toBe(5);
    expect(seenByB.mode).toBe("stand");
    await waitFor(() => own.emoteSeq === 1, "A sees its own emoticon", 1000);

    a.send(MSG.emote, { id: 2 });
    await sleep(300);
    expect(seenByB.emoteSeq).toBe(1);
    expect(seenByB.emote).toBe(5);

    await sleep(EMOTE_COOLDOWN_MS);
    a.send(MSG.emote, { id: 2 });
    await waitFor(() => seenByB.emoteSeq === 2, "B sees the next emoticon", 1000);
    expect(seenByB.emote).toBe(2);
  });

  it("shows A's knocks and chanting to B only while A is seated and clears the chant when A stands", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;

    a.send(MSG.knock, {});
    a.send(MSG.chant, { on: true });
    await sleep(300);
    expect(seenByB.knockSeq).toBe(0);
    expect(seenByB.chanting).toBe(false);

    a.send(MSG.sit, { cushionId: 4 });
    await waitFor(() => seenByB.mode === "kneel", "A kneels", 6000);
    a.send(MSG.chant, { on: "yes" });
    a.send(MSG.chant, null);
    await sleep(300);
    expect(seenByB.chanting).toBe(false);

    a.send(MSG.knock, {});
    await waitFor(() => seenByB.knockSeq === 1, "B sees A's knock", 1000);
    a.send(MSG.chant, { on: true });
    await waitFor(() => seenByB.chanting, "B sees A chanting", 1000);

    a.send(MSG.stand, {});
    await waitFor(() => !seenByB.chanting, "A's chant stops once A stands", 1000);
    expect(seenByB.mode).toBe("stand");
  }, 15_000);

  it("rejects a bow while standing and keeps bowCount at zero", async () => {
    const a = await rig.enter(1);
    a.send("bow", { times: 1 });
    await sleep(300);
    const monk = a.state.monks.get(a.sessionId)!;
    expect(monk.mode).toBe("stand");
    expect(monk.bowCount).toBe(0);
  });

  it("removes a monk and frees the cushion when its client leaves", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    a.send("sit", { cushionId: 5 });
    await waitFor(() => b.state.cushions.get("5")?.occupantId === a.sessionId, "A holds cushion 5");
    const leaverId = a.sessionId;
    await a.leave(true);
    await waitFor(() => !b.state.monks.has(leaverId), "A removed");
    await waitFor(() => b.state.cushions.get("5")?.occupantId === "", "cushion freed");
  });
});

describe("cushion exclusivity", () => {
  it("gives a cushion that ten clients grab at once to exactly one of them", async () => {
    const rooms = await Promise.all(Array.from({ length: 10 }, () => rig.enter(1)));
    for (const room of rooms) room.send("sit", { cushionId: 2 });
    const observer = rooms[0]!;
    await waitFor(() => humansIn(observer).some((monk) => monk.cushionId === 2), "cushion claimed by a client");
    await sleep(300);

    const owners = humansIn(observer).filter((monk) => monk.cushionId === 2);
    expect(owners).toHaveLength(1);
    expect(observer.state.cushions.get("2")?.occupantId).toBe(owners[0]!.id);
    const others = humansIn(observer).filter((monk) => monk.cushionId !== 2);
    expect(others).toHaveLength(9);
    for (const monk of others) expect(monk.cushionId).toBe(-1);
  });

  it("hands the cushion to the next monk after the owner stands", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    a.send("sit", { cushionId: 0 });
    await waitFor(() => b.state.cushions.get("0")?.occupantId === a.sessionId, "A claims");
    b.send("sit", { cushionId: 0 });
    await sleep(200);
    expect(b.state.cushions.get("0")?.occupantId).toBe(a.sessionId);
    expect(b.state.monks.get(b.sessionId)?.cushionId).toBe(-1);

    a.send("stand", {});
    await waitFor(() => b.state.cushions.get("0")?.occupantId === "", "A stands, cushion freed");
    b.send("sit", { cushionId: 0 });
    await waitFor(() => b.state.cushions.get("0")?.occupantId === b.sessionId, "B claims");
  });
});

describe("capacity", () => {
  it("fills a hall to 12 and seats the 13th visitor in the next hall", async () => {
    const entered = await Promise.all(Array.from({ length: HALL_CAPACITY }, () => rig.enter(1)));
    expect(entered).toHaveLength(HALL_CAPACITY);

    const full = await eventually(() => rig.hall(1), (info) => info.full, "hall 1 reported full");
    expect(full.clients).toBe(HALL_CAPACITY);

    const rejection = await rig.client.joinById(full.roomId, {}, undefined).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    expect(isHallFullError(rejection)).toBe(true);

    const { seat } = await rig.arrive(1);
    expect(seat).toMatchObject({ hall: 2, fellBack: true });
    const halls = await eventually(() => rig.halls(), (list) => list.find((info) => info.hall === 2)?.clients === 1, "hall 2 counted");
    expect(halls.map((info) => info.hall)).toEqual([1, 2]);
    expect(halls.filter((info) => info.full).map((info) => info.hall)).toEqual([1]);
  }, 30_000);
});

describe("hardening", () => {
  it("does not let clients create rooms", async () => {
    await rig.enter(1);
    const before = await rig.halls();
    const outcome = (attempt: Promise<unknown>) =>
      attempt.then(
        () => "created",
        (error: { code?: number }) => `rejected:${error.code}`,
      );
    const attempts = await Promise.all([
      outcome(rig.client.create("hall", { hall: 1 })),
      outcome(rig.client.create("hall", { hall: 1, key: "guess" })),
      outcome(rig.client.create("hall", { hall: 99 })),
    ]);
    expect(attempts).toEqual(["rejected:403", "rejected:403", "rejected:403"]);
    const after = await rig.halls();
    expect(after.map((hall) => hall.roomId)).toEqual(before.map((hall) => hall.roomId));
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

    a.send("move", { x: 1e9, z: -1e9 });
    await waitFor(() => monk.mode === "walk", "valid move accepted");
    await waitFor(() => monk.x > 4.9 && monk.z < -2.9, "clamped to the walkable corner", 8000);
    expect(monk.x).toBeLessThanOrEqual(5);
    expect(monk.z).toBeGreaterThanOrEqual(-3);
  }, 15_000);

  it("keeps serving a client after a message flood passes the rate window", async () => {
    const a = await rig.enter(1);
    for (let i = 0; i < 50; i += 1) a.send("stand");
    await sleep(1200);
    a.send("sit", { cushionId: 0 });
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
