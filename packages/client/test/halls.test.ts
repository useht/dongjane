import { describe, expect, it } from "vitest";
import { HALL_CAPACITY, type HallInfo, SEAT_PATH } from "@dongjane/shared";
import { HallsUnavailableError, checkHallEntry, fetchHalls, requestSeat } from "../src/net/halls.ts";

const hall = (n: number, clients: number): HallInfo => ({
  hall: n,
  roomId: `room${n}`,
  clients,
  capacity: HALL_CAPACITY,
  full: clients >= HALL_CAPACITY,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchHalls", () => {
  const respond = (body: unknown, status = 200) => async () => json(body, status);

  it("parses the hall list", async () => {
    const result = await fetchHalls("http://x", respond({ halls: [hall(1, 3)] }) as typeof fetch);
    expect(result).toEqual([hall(1, 3)]);
  });

  it("accepts a server with no halls open", async () => {
    expect(await fetchHalls("http://x", respond({ halls: [] }) as typeof fetch)).toEqual([]);
  });

  it("drops entries with invalid hall numbers", async () => {
    const result = await fetchHalls("http://x", respond({ halls: [hall(1, 1), { hall: 0 }, null] }) as typeof fetch);
    expect(result.map((info) => info.hall)).toEqual([1]);
  });

  it("reports server errors and malformed bodies as unavailable", async () => {
    await expect(fetchHalls("http://x", respond({}, 500) as typeof fetch)).rejects.toBeInstanceOf(HallsUnavailableError);
    await expect(fetchHalls("http://x", respond({ nope: true }) as typeof fetch)).rejects.toBeInstanceOf(HallsUnavailableError);
    await expect(fetchHalls("http://x", respond(null) as typeof fetch)).rejects.toBeInstanceOf(HallsUnavailableError);
  });

  it("reports network failures as unavailable", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(fetchHalls("http://x", failing)).rejects.toBeInstanceOf(HallsUnavailableError);
  });
});

describe("requestSeat", () => {
  const quiet = async () => undefined;

  it("posts the requested hall and returns the seat", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return json({ hall: 2, roomId: "room2", fellBack: true });
    }) as unknown as typeof fetch;
    const seat = await requestSeat("http://x", 5, { fetchFn, sleep: quiet });
    expect(seat).toEqual({ hall: 2, roomId: "room2", fellBack: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`http://x${SEAT_PATH}`);
    expect(seen[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ hall: 5 });
  });

  it("sends null when no hall is requested", async () => {
    let body = "";
    const fetchFn = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return json({ hall: 1, roomId: "room1", fellBack: false });
    }) as unknown as typeof fetch;
    await requestSeat("http://x", null, { fetchFn, sleep: quiet });
    expect(JSON.parse(body)).toEqual({ hall: null });
  });

  it("waits through a server that is not listening yet and one that is busy", async () => {
    const steps: Array<() => Response> = [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => json({ error: "busy" }, 503),
      () => json({ hall: 1, roomId: "room1", fellBack: false }),
    ];
    let calls = 0;
    const fetchFn = (async () => steps[calls++]?.()) as unknown as typeof fetch;
    const retries: number[] = [];
    const seat = await requestSeat("http://x", null, { fetchFn, sleep: quiet, onRetry: (failures: number) => retries.push(failures) });
    expect(seat.roomId).toBe("room1");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("gives up with HallsUnavailableError after the last delay", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(requestSeat("http://x", null, { fetchFn, sleep: quiet, delaysMs: [1, 1] })).rejects.toBeInstanceOf(HallsUnavailableError);
    expect(calls).toBe(3);
  });

  it("rejects a malformed seat", async () => {
    const fetchFn = (async () => json({ hall: 0, roomId: "" })) as unknown as typeof fetch;
    await expect(requestSeat("http://x", null, { fetchFn, sleep: quiet, delaysMs: [] })).rejects.toBeInstanceOf(HallsUnavailableError);
  });
});

describe("checkHallEntry", () => {
  const halls = [hall(1, 4), hall(2, HALL_CAPACITY), hall(3, 1)];

  it("accepts an existing hall that has room", () => {
    expect(checkHallEntry(halls, 1, "3")).toEqual({ ok: true, hall: 3 });
    expect(checkHallEntry(halls, 1, " 3 ")).toEqual({ ok: true, hall: 3 });
  });

  it("refuses text that is not a hall number", () => {
    for (const typed of ["", "abc", "0", "-1", "1.5", "12345"]) {
      expect(checkHallEntry(halls, 1, typed)).toEqual({ ok: false, reason: "invalid", hall: null });
    }
  });

  it("refuses the hall the visitor is already in", () => {
    expect(checkHallEntry(halls, 1, "1")).toEqual({ ok: false, reason: "current", hall: 1 });
  });

  it("refuses a hall that is not open", () => {
    expect(checkHallEntry(halls, 1, "9")).toEqual({ ok: false, reason: "missing", hall: 9 });
  });

  it("refuses a full hall", () => {
    expect(checkHallEntry(halls, 1, "2")).toEqual({ ok: false, reason: "full", hall: 2 });
  });
});
