import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORLDS_PATH, type WorldListResponse } from "@dongjane/shared";
import { type GameServer, startGameServer } from "../src/server.ts";
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
