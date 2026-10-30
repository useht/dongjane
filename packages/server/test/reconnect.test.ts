import { CloseCode } from "@colyseus/sdk";
import { WORLD_CAPACITY, MSG, TempleState } from "@dongjane/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type GameServer, startGameServer } from "../src/server.ts";
import { TestRig, eventually, sleep, waitFor } from "./helpers.ts";

const RECONNECT_SECONDS = 2;

let game: GameServer;
let rig: TestRig;

beforeAll(async () => {
  game = await startGameServer({ port: 0, handleSignals: false, reconnectSeconds: RECONNECT_SECONDS });
  rig = new TestRig(game.port);
});

afterEach(async () => {
  await rig.closeAll();
  await eventually(() => rig.worlds(), (worlds) => worlds.length === 0, "every world closed", RECONNECT_SECONDS * 1000 + 3000);
});

afterAll(async () => {
  await rig.closeAll();
  await game.stop();
});

describe("reconnection window", () => {
  it("tells a visitor who comes back into a world that is being merged to move on", async () => {
    const crowd = await rig.fill(1, WORLD_CAPACITY);
    await eventually(() => rig.worlds(), (worlds) => worlds.some((info) => info.world === 2), "world 2 opened");
    const lone = await rig.enter(2);
    const token = lone.reconnectionToken;
    lone.reconnection.enabled = false;
    lone.connection.close(CloseCode.MAY_TRY_RECONNECT);
    await sleep(200);

    await crowd[0]!.leave(true);
    await eventually(() => rig.worlds(), (worlds) => worlds.every((info) => info.world !== 2), "world 2 hidden while merging");

    const back = await rig.client.reconnect(token, TempleState);
    rig.rooms.push(back);
    const relocations: number[] = [];
    back.onMessage(MSG.relocate, (message: { world: number }) => relocations.push(message.world));
    await waitFor(() => relocations.length > 0, "relocation notice after reconnecting", 3000);
    expect(relocations).toEqual([1]);
  }, 20_000);

  it("keeps a world open while its only visitor is reconnecting", async () => {
    const a = await rig.enter(1);
    const sessionId = a.sessionId;
    let reconnected = false;
    a.onReconnect(() => {
      reconnected = true;
    });
    a.connection.close(CloseCode.MAY_TRY_RECONNECT);

    await sleep(400);
    expect((await rig.world(1)).clients).toBe(1);

    await waitFor(() => reconnected, "client reconnects", 5000);
    expect(a.sessionId).toBe(sessionId);
    expect((await rig.world(1)).clients).toBe(1);
  }, 20_000);

  it("keeps the seat and identity when the socket drops and comes back in time", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    a.send("sit", { zone: "gatbawi", seatId: 47 });
    await waitFor(() => b.state.monks.get(a.sessionId)?.mode === "kneel", "A kneels", 15_000);

    const sessionId = a.sessionId;
    let reconnected = false;
    a.onReconnect(() => {
      reconnected = true;
    });
    a.connection.close(CloseCode.MAY_TRY_RECONNECT);

    await waitFor(() => reconnected, "client reconnects", 5000);
    expect(a.sessionId).toBe(sessionId);
    expect(b.state.monks.has(sessionId)).toBe(true);
    expect(b.state.seats.get("gatbawi:47")?.occupantId).toBe(sessionId);

    a.send("bow", { times: 1 });
    await waitFor(() => b.state.monks.get(sessionId)?.mode === "bow", "bow works after reconnect", 1500);
  }, 20_000);

  it("keeps the monk visible to others during the window, then removes it and frees the seat", async () => {
    const a = await rig.enter(1);
    const b = await rig.enter(1);
    a.send("sit", { zone: "gatbawi", seatId: 1 });
    await waitFor(() => b.state.seats.get("gatbawi:1")?.occupantId === a.sessionId, "A claims");
    const sessionId = a.sessionId;

    a.reconnection.enabled = false;
    a.connection.close(CloseCode.MAY_TRY_RECONNECT);

    await sleep(500);
    expect(b.state.monks.has(sessionId)).toBe(true);

    await waitFor(() => !b.state.monks.has(sessionId), "dropped monk removed", RECONNECT_SECONDS * 1000 + 2500, 50);
    expect(b.state.seats.get("gatbawi:1")?.occupantId).toBe("");
    const world = await eventually(() => rig.world(1), (info) => info.clients === 1, "client count back to 1");
    expect(world.full).toBe(false);
  }, 20_000);
});
