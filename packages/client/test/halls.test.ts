import { describe, expect, it } from "vitest";
import { HALL_CAPACITY, type HallInfo } from "@dongjane/shared";
import { HallsNotReadyError, HallsUnavailableError, chooseHall, fetchHalls, loadHalls } from "../src/net/halls.ts";

const hall = (n: number, clients: number, roomId: string | null = `room${n}`): HallInfo => ({
  hall: n,
  roomId,
  clients,
  capacity: HALL_CAPACITY,
  full: clients >= HALL_CAPACITY,
});

describe("chooseHall", () => {
  const halls = [hall(1, 12), hall(2, 4), hall(3, HALL_CAPACITY), hall(4, 0, null)];

  it("honours a deep link to a hall with room", () => {
    expect(chooseHall(halls, 1)).toEqual({ hall: 1, roomId: "room1", fellBack: false });
  });

  it("falls back to the roomiest hall when the requested one is full", () => {
    expect(chooseHall(halls, 3)).toEqual({ hall: 2, roomId: "room2", fellBack: true });
  });

  it("falls back when the requested hall has no room yet", () => {
    expect(chooseHall(halls, 4)).toEqual({ hall: 2, roomId: "room2", fellBack: true });
  });

  it("picks the roomiest hall without a request and does not flag a fallback", () => {
    expect(chooseHall(halls, null)).toEqual({ hall: 2, roomId: "room2", fellBack: false });
  });

  it("returns null when every hall is full", () => {
    expect(chooseHall([hall(1, HALL_CAPACITY), hall(2, HALL_CAPACITY)], 1)).toBeNull();
  });
});

describe("fetchHalls", () => {
  const respond = (body: unknown, status = 200) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("parses the hall list", async () => {
    const result = await fetchHalls("http://x", respond({ halls: [hall(1, 3)] }) as typeof fetch);
    expect(result).toEqual([hall(1, 3)]);
  });

  it("drops entries with invalid hall numbers", async () => {
    const result = await fetchHalls("http://x", respond({ halls: [hall(1, 1), { hall: 99 }, null] }) as typeof fetch);
    expect(result.map((info) => info.hall)).toEqual([1]);
  });

  it("reports server errors and malformed bodies as unavailable", async () => {
    await expect(fetchHalls("http://x", respond({}, 500) as typeof fetch)).rejects.toBeInstanceOf(HallsUnavailableError);
    await expect(fetchHalls("http://x", respond({ nope: true }) as typeof fetch)).rejects.toBeInstanceOf(HallsUnavailableError);
  });

  it("reports network failures as unavailable", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(fetchHalls("http://x", failing)).rejects.toBeInstanceOf(HallsUnavailableError);
  });
});

describe("loadHalls", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const quiet = async () => undefined;

  it("waits through a server that is not listening yet and one that has no halls yet", async () => {
    const steps: Array<() => Response> = [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => json({ halls: [hall(1, 0, null), hall(2, 0, null)] }),
      () => json({ halls: [hall(1, 2), hall(2, 0)] }),
    ];
    let calls = 0;
    const fetchFn = (async () => steps[calls++]?.()) as unknown as typeof fetch;
    const retries: number[] = [];
    const halls = await loadHalls("http://x", { fetchFn, sleep: quiet, onRetry: (failures) => retries.push(failures) });
    expect(halls.map((info) => info.roomId)).toEqual(["room1", "room2"]);
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("gives up with HallsUnavailableError after the last delay", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(loadHalls("http://x", { fetchFn, sleep: quiet, delaysMs: [1, 1] })).rejects.toBeInstanceOf(HallsUnavailableError);
    expect(calls).toBe(3);
  });

  it("reports a server that never creates halls as not ready", async () => {
    const fetchFn = (async () => json({ halls: [hall(1, 0, null)] })) as unknown as typeof fetch;
    await expect(loadHalls("http://x", { fetchFn, sleep: quiet, delaysMs: [1] })).rejects.toBeInstanceOf(HallsNotReadyError);
  });
});
