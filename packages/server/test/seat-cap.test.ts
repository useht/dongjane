import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORLDS_PATH, SEAT_PATH, type WorldListResponse, type SeatResponse } from "@dongjane/shared";
import { MAX_PENDING_SEATS } from "../src/world-directory.ts";
import { type GameServer, startGameServer } from "../src/server.ts";

let game: GameServer;

beforeAll(async () => {
  game = await startGameServer({ port: 0, handleSignals: false, seatReservationMs: 60_000 });
});

afterAll(async () => {
  await game.stop();
});

const requestSeat = () =>
  fetch(`http://127.0.0.1:${game.port}${SEAT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ world: null }),
  });

describe("seat cap", () => {
  it("answers 503 once too many seats are waiting to be used", async () => {
    const granted: SeatResponse[] = [];
    for (let i = 0; i < MAX_PENDING_SEATS; i += 1) {
      const response = await requestSeat();
      expect(response.status).toBe(200);
      granted.push((await response.json()) as SeatResponse);
    }
    expect(new Set(granted.map((seat) => seat.world)).size).toBeGreaterThan(1);

    const refused = await requestSeat();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "busy" });

    const list = (await (await fetch(`http://127.0.0.1:${game.port}${WORLDS_PATH}`)).json()) as WorldListResponse;
    expect(list.worlds.every((info) => info.clients === 0)).toBe(true);
  }, 60_000);
});
