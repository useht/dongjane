import { CloseCode } from "@colyseus/sdk";
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
  await sleep(50);
});

afterAll(async () => {
  await rig.closeAll();
  await game.stop();
});

describe("reconnection window", () => {
  it("keeps the seat and identity when the socket drops and comes back in time", async () => {
    const a = await rig.enter(1, { name: "돌아옴" });
    const b = await rig.enter(1);
    a.send("sit", { cushionId: 7 });
    await waitFor(() => b.state.monks.get(a.sessionId)?.mode === "kneel", "A kneels", 6000);

    const sessionId = a.sessionId;
    let reconnected = false;
    a.onReconnect(() => {
      reconnected = true;
    });
    a.connection.close(CloseCode.MAY_TRY_RECONNECT);

    await waitFor(() => reconnected, "client reconnects", 5000);
    expect(a.sessionId).toBe(sessionId);
    expect(b.state.monks.has(sessionId)).toBe(true);
    expect(b.state.cushions.get("7")?.occupantId).toBe(sessionId);

    a.send("bow", { times: 1 });
    await waitFor(() => b.state.monks.get(sessionId)?.mode === "bow", "bow works after reconnect", 1500);
  }, 20_000);

  it("keeps the monk visible to others during the window, then removes it and frees the cushion", async () => {
    const a = await rig.enter(2);
    const b = await rig.enter(2);
    a.send("sit", { cushionId: 1 });
    await waitFor(() => b.state.cushions.get("1")?.occupantId === a.sessionId, "A claims");
    const sessionId = a.sessionId;

    a.reconnection.enabled = false;
    a.connection.close(CloseCode.MAY_TRY_RECONNECT);

    await sleep(500);
    expect(b.state.monks.has(sessionId)).toBe(true);

    await waitFor(() => !b.state.monks.has(sessionId), "dropped monk removed", RECONNECT_SECONDS * 1000 + 2500, 50);
    expect(b.state.cushions.get("1")?.occupantId).toBe("");
    const hall = await eventually(() => rig.hall(2), (info) => info.clients === 1, "client count back to 1");
    expect(hall.full).toBe(false);
  }, 20_000);
});
