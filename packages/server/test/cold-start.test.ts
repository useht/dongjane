import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HallsUnavailableError, fetchHalls, requestSeat } from "../../client/src/net/halls.ts";
import { type GameServer, startGameServer } from "../src/server.ts";
import { sleep } from "./helpers.ts";

// `pnpm dev` serves the page within ~100 ms but the game server needs a couple of seconds to listen, so the
// first hall-list request of a cold start is refused. These tests reproduce that ordering against a real server.
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

let game: GameServer | null = null;

afterEach(async () => {
  await game?.stop();
  game = null;
});

describe("cold start", () => {
  it("a single hall-list request before the server listens is refused", async () => {
    const port = await freePort();
    await expect(fetchHalls(`http://127.0.0.1:${port}`)).rejects.toBeInstanceOf(HallsUnavailableError);
  });

  it("requestSeat rides out a server that starts after the first request and opens hall 1", async () => {
    const port = await freePort();
    const retries: number[] = [];
    const pending = requestSeat(`http://127.0.0.1:${port}`, null, { onRetry: (failures) => retries.push(failures) });
    await sleep(900);
    game = await startGameServer({ port, hostname: "127.0.0.1", handleSignals: false });
    const seat = await pending;
    expect(retries.length).toBeGreaterThan(0);
    expect(seat).toMatchObject({ hall: 1, fellBack: false });
    expect(seat.roomId).toEqual(expect.any(String));
  });
});
