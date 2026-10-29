import { describe, expect, it } from "vitest";
import { WORLD_CAPACITY, type WorldInfo, SEAT_PATH } from "@dongjane/shared";
import { WorldsUnavailableError, checkWorldEntry, fetchWorlds, requestSeat } from "../src/net/worlds.ts";

const world = (n: number, clients: number): WorldInfo => ({
  world: n,
  roomId: `room${n}`,
  clients,
  capacity: WORLD_CAPACITY,
  full: clients >= WORLD_CAPACITY,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchWorlds", () => {
  const respond = (body: unknown, status = 200) => async () => json(body, status);

  it("parses the world list", async () => {
    const result = await fetchWorlds("http://x", respond({ worlds: [world(1, 3)] }) as typeof fetch);
    expect(result).toEqual([world(1, 3)]);
  });

  it("hands the server time to the observer when the response carries one", async () => {
    const seen: number[] = [];
    await fetchWorlds("http://x", respond({ worlds: [world(1, 3)], serverTime: 1_800_000_000_000 }) as typeof fetch, 6000, (time) =>
      seen.push(time),
    );
    await fetchWorlds("http://x", respond({ worlds: [world(1, 3)] }) as typeof fetch, 6000, (time) => seen.push(time));
    expect(seen).toEqual([1_800_000_000_000]);
  });

  it("accepts a server with no worlds open", async () => {
    expect(await fetchWorlds("http://x", respond({ worlds: [] }) as typeof fetch)).toEqual([]);
  });

  it("drops entries with invalid world numbers", async () => {
    const result = await fetchWorlds("http://x", respond({ worlds: [world(1, 1), { world: 0 }, null] }) as typeof fetch);
    expect(result.map((info) => info.world)).toEqual([1]);
  });

  it("reports server errors and malformed bodies as unavailable", async () => {
    await expect(fetchWorlds("http://x", respond({}, 500) as typeof fetch)).rejects.toBeInstanceOf(WorldsUnavailableError);
    await expect(fetchWorlds("http://x", respond({ nope: true }) as typeof fetch)).rejects.toBeInstanceOf(WorldsUnavailableError);
    await expect(fetchWorlds("http://x", respond(null) as typeof fetch)).rejects.toBeInstanceOf(WorldsUnavailableError);
  });

  it("reports network failures as unavailable", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(fetchWorlds("http://x", failing)).rejects.toBeInstanceOf(WorldsUnavailableError);
  });
});

describe("requestSeat", () => {
  const quiet = async () => undefined;

  it("posts the requested world and returns the seat", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return json({ world: 2, roomId: "room2", fellBack: true });
    }) as unknown as typeof fetch;
    const seat = await requestSeat("http://x", 5, { fetchFn, sleep: quiet });
    expect(seat).toEqual({ world: 2, roomId: "room2", fellBack: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`http://x${SEAT_PATH}`);
    expect(seen[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ world: 5 });
  });

  it("sends null when no world is requested", async () => {
    let body = "";
    const fetchFn = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return json({ world: 1, roomId: "room1", fellBack: false });
    }) as unknown as typeof fetch;
    await requestSeat("http://x", null, { fetchFn, sleep: quiet });
    expect(JSON.parse(body)).toEqual({ world: null });
  });

  it("waits through a server that is not listening yet and one that is busy", async () => {
    const steps: Array<() => Response> = [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => json({ error: "busy" }, 503),
      () => json({ world: 1, roomId: "room1", fellBack: false }),
    ];
    let calls = 0;
    const fetchFn = (async () => steps[calls++]?.()) as unknown as typeof fetch;
    const retries: number[] = [];
    const seat = await requestSeat("http://x", null, { fetchFn, sleep: quiet, onRetry: (failures: number) => retries.push(failures) });
    expect(seat.roomId).toBe("room1");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("gives up with WorldsUnavailableError after the last delay", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(requestSeat("http://x", null, { fetchFn, sleep: quiet, delaysMs: [1, 1] })).rejects.toBeInstanceOf(WorldsUnavailableError);
    expect(calls).toBe(3);
  });

  it("rejects a malformed seat", async () => {
    const fetchFn = (async () => json({ world: 0, roomId: "" })) as unknown as typeof fetch;
    await expect(requestSeat("http://x", null, { fetchFn, sleep: quiet, delaysMs: [] })).rejects.toBeInstanceOf(WorldsUnavailableError);
  });
});

describe("checkWorldEntry", () => {
  const worlds = [world(1, 4), world(2, WORLD_CAPACITY), world(3, 1)];

  it("accepts an existing world that has room", () => {
    expect(checkWorldEntry(worlds, 1, "3")).toEqual({ ok: true, world: 3 });
    expect(checkWorldEntry(worlds, 1, " 3 ")).toEqual({ ok: true, world: 3 });
  });

  it("refuses text that is not a world number", () => {
    for (const typed of ["", "abc", "0", "-1", "1.5", "12345"]) {
      expect(checkWorldEntry(worlds, 1, typed)).toEqual({ ok: false, reason: "invalid", world: null });
    }
  });

  it("refuses the world the visitor is already in", () => {
    expect(checkWorldEntry(worlds, 1, "1")).toEqual({ ok: false, reason: "current", world: 1 });
  });

  it("refuses a world that is not open", () => {
    expect(checkWorldEntry(worlds, 1, "9")).toEqual({ ok: false, reason: "missing", world: 9 });
  });

  it("refuses a full world", () => {
    expect(checkWorldEntry(worlds, 1, "2")).toEqual({ ok: false, reason: "full", world: 2 });
  });
});
