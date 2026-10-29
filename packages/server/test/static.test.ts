import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORLDS_PATH, type WorldListResponse } from "@dongjane/shared";
import { type GameServer, startGameServer } from "../src/server.ts";
import { parseRange } from "../src/static.ts";
import { TestRig } from "./helpers.ts";

const INDEX = "<!doctype html><title>동자네</title>";

let dir: string;
let game: GameServer;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dongjane-client-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), INDEX);
  writeFileSync(join(dir, "assets", "app-abc.js"), "console.log(1);");
  writeFileSync(join(dir, "manifest.webmanifest"), "{}");
  writeFileSync(join(dir, "assets", "sutra-abc.mp3"), "0123456789");
  game = await startGameServer({ port: 0, handleSignals: false, clientDir: dir });
  base = `http://127.0.0.1:${game.port}`;
});

afterAll(async () => {
  await game.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("client static serving", () => {
  it("serves index.html at the root instead of the Colyseus banner", async () => {
    const response = await fetch(`${base}/?world=2`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe(INDEX);
  });

  it("serves hashed assets as immutable with the right type", async () => {
    const response = await fetch(`${base}/assets/app-abc.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe("console.log(1);");

    const manifest = await fetch(`${base}/manifest.webmanifest`);
    expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
  });

  it("answers a byte range with 206 and the matching slice", async () => {
    const response = await fetch(`${base}/assets/sutra-abc.mp3`, { headers: { range: "bytes=2-5" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(await response.text()).toBe("2345");

    const tail = await fetch(`${base}/assets/sutra-abc.mp3`, { headers: { range: "bytes=7-" } });
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("789");

    const last = await fetch(`${base}/assets/sutra-abc.mp3`, { headers: { range: "bytes=-3" } });
    expect(last.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await last.text()).toBe("789");
  });

  it("offers ranges, serves the whole file without one and refuses a range past the end", async () => {
    const whole = await fetch(`${base}/assets/sutra-abc.mp3`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(await whole.text()).toBe("0123456789");

    const past = await fetch(`${base}/assets/sutra-abc.mp3`, { headers: { range: "bytes=40-50" } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");
    await past.arrayBuffer();
  });

  it("falls back to the app shell for routes but not for missing files or api paths", async () => {
    expect(await (await fetch(`${base}/some/route`)).text()).toBe(INDEX);
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it("does not escape the client directory", async () => {
    const response = await fetch(`${base}/..%2F..%2Fpackage.json`);
    expect(response.status).toBe(404);
  });

  it("keeps the world list and matchmaking working on the same origin", async () => {
    const before = Date.now();
    const empty = (await (await fetch(`${base}${WORLDS_PATH}`)).json()) as WorldListResponse;
    expect(empty.worlds).toEqual([]);
    expect(empty.serverTime).toBeGreaterThanOrEqual(before);
    expect(empty.serverTime).toBeLessThanOrEqual(Date.now());

    const rig = new TestRig(game.port);
    const room = await rig.enter(1);
    const body = (await (await fetch(`${base}${WORLDS_PATH}`)).json()) as WorldListResponse;
    expect(body.worlds).toHaveLength(1);
    expect(room.roomId).toBe(body.worlds[0]!.roomId);
    expect(room.state.serverTime).toBeGreaterThan(0);
    expect(Math.abs(room.state.serverTime - Date.now())).toBeLessThan(5000);
    await rig.closeAll();
  });
});

describe("parseRange", () => {
  it("reads the single-range forms", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps an end past the file", () => {
    expect(parseRange("bytes=10-5000", 1000)).toEqual({ start: 10, end: 999 });
  });

  it("flags a start past the end as unsatisfiable", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("ignores what it cannot serve and sends the whole file instead", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("items=0-5", 1000)).toBeNull();
    expect(parseRange("bytes=0-5,10-15", 1000)).toBeNull();
    expect(parseRange("bytes=9-3", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
  });
});
