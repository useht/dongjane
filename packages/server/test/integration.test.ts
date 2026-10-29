import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BOW_MS,
  CHANT_MS,
  HALL_CAPACITY,
  HALL_COUNT,
  NAME_MAX_LENGTH,
  isHallFullError,
} from "@dongjane/shared";
import { type GameServer, startGameServer } from "../src/server.ts";
import { type HallClientRoom, TestRig, eventually, sleep, waitFor } from "./helpers.ts";

let game: GameServer;
let rig: TestRig;

beforeAll(async () => {
  game = await startGameServer({ port: 0, handleSignals: false });
  rig = new TestRig(game.port);
});

afterEach(async () => {
  await rig.closeAll();
  await sleep(50);
});

afterAll(async () => {
  await rig.closeAll();
  await game.stop();
});

describe("hall list", () => {
  it("exposes eight named halls with counts and capacity", async () => {
    const halls = await rig.halls();
    expect(halls).toHaveLength(HALL_COUNT);
    expect(halls.map((hall) => hall.hall)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const hall of halls) {
      expect(hall.roomId).toEqual(expect.any(String));
      expect(hall.capacity).toBe(HALL_CAPACITY);
      expect(hall.clients).toBe(0);
      expect(hall.full).toBe(false);
    }
  });

  it("reflects joins in the client count", async () => {
    await rig.enter(2);
    await rig.enter(2);
    const hall = await eventually(() => rig.hall(2), (info) => info.clients === 2, "two clients counted");
    expect(hall.full).toBe(false);
  });
});

describe("two clients in one hall", () => {
  it("shows A sitting and bowing to B within the time budget", async () => {
    const a = await rig.enter(1, { name: "가온", hue: 40 });
    const b = await rig.enter(1, { name: "나래", hue: 200 });

    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;
    expect(seenByB.name).toBe("가온");
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
    const a = await rig.enter(3);
    const b = await rig.enter(3);
    await waitFor(() => b.state.monks.has(a.sessionId), "B sees A");
    const seenByB = b.state.monks.get(a.sessionId)!;

    a.send("sit", { cushionId: 6 });
    await waitFor(() => seenByB.mode === "kneel", "A kneels", 6000);
    a.send("bow", { times: 3 });
    await waitFor(() => seenByB.mode === "bow", "first bow", 1000);
    await waitFor(() => seenByB.bowCount === 3, "three bows", 3 * BOW_MS + 3000, 25);
    await waitFor(() => seenByB.mode === "kneel", "back to kneel", 1000);
  }, 20_000);

  it("rejects a bow while standing and keeps bowCount at zero", async () => {
    const a = await rig.enter(4);
    a.send("bow", { times: 1 });
    await sleep(300);
    const monk = a.state.monks.get(a.sessionId)!;
    expect(monk.mode).toBe("stand");
    expect(monk.bowCount).toBe(0);
  });

  it("removes a monk and frees the cushion when its client leaves", async () => {
    const a = await rig.enter(5);
    const b = await rig.enter(5);
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
    const rooms = await Promise.all(Array.from({ length: 10 }, () => rig.enter(6)));
    for (const room of rooms) room.send("sit", { cushionId: 2 });
    const observer = rooms[0]!;
    await waitFor(() => observer.state.cushions.get("2")?.occupantId !== "", "cushion claimed");
    await sleep(300);

    const owners = [...observer.state.monks.values()].filter((monk) => monk.cushionId === 2);
    expect(owners).toHaveLength(1);
    expect(observer.state.cushions.get("2")?.occupantId).toBe(owners[0]!.id);
    const others = [...observer.state.monks.values()].filter((monk) => monk.cushionId !== 2);
    expect(others).toHaveLength(9);
    for (const monk of others) expect(monk.cushionId).toBe(-1);
  });

  it("hands the cushion to the next monk after the owner stands", async () => {
    const a = await rig.enter(7);
    const b = await rig.enter(7);
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
  it("fills a hall to 30, rejects the 31st, and reopens when someone leaves", async () => {
    const entered: HallClientRoom[] = [];
    for (let batch = 0; batch < 3; batch += 1) {
      entered.push(...(await Promise.all(Array.from({ length: 10 }, () => rig.enter(8)))));
    }
    expect(entered).toHaveLength(HALL_CAPACITY);

    const full = await eventually(() => rig.hall(8), (info) => info.full, "hall 8 reported full");
    expect(full.clients).toBe(HALL_CAPACITY);
    expect((await rig.halls()).filter((hall) => hall.full).map((hall) => hall.hall)).toEqual([8]);

    const rejection = await rig.client.joinById(full.roomId as string, {}, undefined).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    expect(isHallFullError(rejection)).toBe(true);

    await entered[0]!.leave(true);
    await waitFor(() => entered[1]!.state.monks.size === HALL_CAPACITY - 1, "leave propagated");
    const reopened = await rig.enter(8);
    expect(reopened.state.monks.size).toBe(HALL_CAPACITY);
  }, 30_000);
});

describe("hardening", () => {
  it("does not let clients create rooms", async () => {
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

  it("rate-limits message floods", async () => {
    const a = await rig.enter(2, { name: "시작" });
    const monk = a.state.monks.get(a.sessionId)!;
    for (let i = 0; i < 50; i += 1) a.send("setName", { name: `n${i}` });
    await sleep(500);
    const index = Number(monk.name.slice(1));
    expect(monk.name).toMatch(/^n\d+$/);
    expect(index).toBeGreaterThanOrEqual(15);
    expect(index).toBeLessThan(30);
  });

  it("sanitizes names from join options and setName", async () => {
    const a = await rig.enter(3, { name: "\u0000  긴이름이정말정말길어요‮  " });
    const monk = a.state.monks.get(a.sessionId)!;
    expect(monk.name).toBe("긴이름이정말정말");
    expect(Array.from(monk.name).length).toBeLessThanOrEqual(NAME_MAX_LENGTH);

    a.send("setName", { name: "a\u0007b​c" });
    await waitFor(() => monk.name === "abc", "control characters stripped");
    a.send("setName", { name: " \u0000 " });
    await sleep(150);
    expect(monk.name).toBe("abc");

    const b = await rig.enter(3, { name: 12345 as unknown as string });
    expect(b.state.monks.get(b.sessionId)?.name).toMatch(/^동자\d{2}$/);
  });

  it("clamps hue from join options", async () => {
    const a = await rig.enter(4, { hue: 725 });
    expect(a.state.monks.get(a.sessionId)?.hue).toBe(5);
    const b = await rig.enter(4, { hue: Number.NaN });
    const hue = b.state.monks.get(b.sessionId)!.hue;
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});

describe("chant", () => {
  it("publishes the next chant time to clients", async () => {
    const a = await rig.enter(5);
    const chant = a.state.chant;
    expect(chant.durationMs).toBe(CHANT_MS);
    expect(chant.label).toMatch(/^\d{2}:\d{2} 예불$/);
    expect(chant.startsAt + chant.durationMs).toBeGreaterThan(Date.now());
    expect(chant.startsAt % (30 * 60 * 1000)).toBe(0);
  });
});
