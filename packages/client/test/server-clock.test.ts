import { describe, expect, it } from "vitest";
import { ServerClock } from "../src/net/server-clock.ts";

describe("ServerClock", () => {
  const SERVER = 1_800_000_000_000;

  it("has no time until the server has reported one", () => {
    const clock = new ServerClock(() => 5_000);
    expect(clock.now()).toBeNull();
    clock.observe(Number.NaN);
    clock.observe(0);
    clock.observe(-1);
    expect(clock.now()).toBeNull();
  });

  it("follows the server rather than the device clock", () => {
    let device = 1_000_000;
    const clock = new ServerClock(() => device);
    clock.observe(SERVER);
    expect(clock.now()).toBe(SERVER);
    device += 4_500;
    expect(clock.now()).toBe(SERVER + 4_500);
  });

  it("re-anchors whenever the server reports a new time", () => {
    let device = 1_000_000;
    const clock = new ServerClock(() => device);
    clock.observe(SERVER);
    device += 10_000;
    clock.observe(SERVER + 11_000);
    expect(clock.now()).toBe(SERVER + 11_000);
    device += 500;
    expect(clock.now()).toBe(SERVER + 11_500);
  });

  it("ignores a repeated value so a stale server time cannot drag the clock back", () => {
    let device = 1_000_000;
    const clock = new ServerClock(() => device);
    clock.observe(SERVER);
    device += 30_000;
    clock.observe(SERVER);
    expect(clock.now()).toBe(SERVER + 30_000);
  });
});
