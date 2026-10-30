import { describe, expect, it } from "vitest";
import { QUIET_PAUSE_MS, aimAhead, loopPosition } from "../src/audio/music.ts";
import {
  PLAYER_ORIGIN,
  type HintInput,
  type Playback,
  READY_TIMEOUT_MS,
  STAGE_HINT_REACH,
  STAGE_VIDEO_ID,
  START_TIMEOUT_MS,
  StageVideoController,
  type StageStatus,
  UNMUTE_CHECK_MS,
  embedUrl,
  hintAction,
  listeningMessage,
  parsePlayerMessage,
  playerCommand,
  screenModeFor,
} from "../src/ui/stage-video.ts";

interface Sent {
  func: string;
  args: readonly unknown[];
}

function rig(serverMs = 1_000_000) {
  let clock = 0;
  let server = serverMs;
  const sent: Sent[] = [];
  const statuses: Array<{ status: StageStatus; code?: number }> = [];
  const taps: boolean[] = [];
  const playbacks: Playback[] = [];
  const audible: boolean[] = [];
  const controller = new StageVideoController(
    {
      send: (func, args = []) => sent.push({ func, args }),
      status: (status, reason) => statuses.push({ status, code: reason?.code }),
      tapNeeded: (needed) => taps.push(needed),
      playback: (playback) => playbacks.push(playback),
      audible: (value) => audible.push(value),
    },
    () => clock,
    () => server,
  );
  return {
    controller,
    sent,
    statuses,
    taps,
    playbacks,
    audible,
    advance(ms: number) {
      clock += ms;
      server += ms;
    },
    funcs: () => sent.map((entry) => entry.func),
    clear: () => sent.splice(0),
  };
}

type Rig = ReturnType<typeof rig>;

const info = (fields: Partial<{ time: number; duration: number; muted: boolean; state: number }>) => ({ kind: "info" as const, ...fields });

// Opened and heard from, and left waiting as it should be.
function waiting(t: Rig): void {
  t.controller.open();
  t.controller.receive({ kind: "ready" });
}

// The visitor has pressed play and the player has answered that it plays.
function playing(t: Rig, fields: Partial<{ time: number; duration: number; muted: boolean }> = {}): void {
  waiting(t);
  t.controller.play();
  t.controller.receive(info({ state: 1, duration: 100, time: 0, muted: true, ...fields }));
}

describe("embedUrl", () => {
  it("asks for a muted, looping, chrome-free player that waits and can be steered by postMessage", () => {
    const url = new URL(embedUrl("https://dongjane.example"));
    expect(url.origin).toBe(PLAYER_ORIGIN);
    expect(url.pathname).toBe(`/embed/${STAGE_VIDEO_ID}`);
    expect(url.searchParams.get("autoplay")).toBe("0");
    expect(url.searchParams.get("mute")).toBe("1");
    expect(url.searchParams.get("loop")).toBe("1");
    expect(url.searchParams.get("playlist")).toBe(STAGE_VIDEO_ID);
    expect(url.searchParams.get("enablejsapi")).toBe("1");
    expect(url.searchParams.get("playsinline")).toBe("1");
    expect(url.searchParams.get("controls")).toBe("0");
    expect(url.searchParams.get("origin")).toBe("https://dongjane.example");
  });

  it("uses the cookie-less host", () => {
    expect(embedUrl("http://localhost:5188")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  });
});

describe("messages", () => {
  it("builds the command and the listening handshake the embed understands", () => {
    expect(JSON.parse(playerCommand("seekTo", [12.5, true]))).toMatchObject({ event: "command", func: "seekTo", args: [12.5, true], channel: "widget" });
    expect(JSON.parse(playerCommand("playVideo"))).toMatchObject({ func: "playVideo", args: [] });
    expect(JSON.parse(listeningMessage())).toMatchObject({ event: "listening", channel: "widget" });
  });

  it("reads ready, errors and state changes", () => {
    expect(parsePlayerMessage(JSON.stringify({ event: "onReady" }))).toEqual({ kind: "ready" });
    expect(parsePlayerMessage(JSON.stringify({ event: "onError", info: 150 }))).toEqual({ kind: "error", code: 150 });
    expect(parsePlayerMessage(JSON.stringify({ event: "onStateChange", info: 1 }))).toEqual({ kind: "info", state: 1 });
  });

  it("reads the periodic deliveries and keeps only sane numbers", () => {
    const parsed = parsePlayerMessage(
      JSON.stringify({ event: "infoDelivery", info: { currentTime: 4.5, duration: 200, muted: true, volume: 80, playerState: 1, other: "x" } }),
    );
    expect(parsed).toEqual({ kind: "info", time: 4.5, duration: 200, muted: true, volume: 80, state: 1 });
    expect(parsePlayerMessage(JSON.stringify({ event: "infoDelivery", info: { currentTime: "soon", duration: null } }))).toEqual({ kind: "info" });
    expect(parsePlayerMessage({ event: "initialDelivery", info: { duration: 90 } })).toEqual({ kind: "info", duration: 90 });
  });

  it("ignores everything else on the window", () => {
    expect(parsePlayerMessage("not json")).toBeNull();
    expect(parsePlayerMessage(42)).toBeNull();
    expect(parsePlayerMessage(null)).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: "somethingElse" }))).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: "onError" }))).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: "infoDelivery", info: 3 }))).toBeNull();
  });
});

describe("hintAction and screenModeFor", () => {
  const near: HintInput = { live: true, distance: 4, status: "ready", playback: "waiting" };

  it("offers play while waiting and stop from the press of play on, once the player is ready", () => {
    expect(hintAction(near)).toBe("play");
    expect(hintAction({ ...near, playback: "starting" })).toBe("stop");
    expect(hintAction({ ...near, playback: "playing" })).toBe("stop");
  });

  it("offers nothing before the player can be steered, or when it cannot be shown", () => {
    for (const status of ["idle", "loading", "blocked"] as const) {
      expect(hintAction({ ...near, status })).toBeNull();
      expect(hintAction({ ...near, status, playback: "playing" })).toBeNull();
    }
  });

  it("offers nothing outside a live world", () => {
    expect(hintAction({ ...near, live: false })).toBeNull();
    expect(hintAction({ ...near, live: false, playback: "playing" })).toBeNull();
  });

  it("offers nothing beyond the reach of the stage, whatever the video is doing, but exactly at it", () => {
    expect(hintAction({ ...near, distance: STAGE_HINT_REACH })).toBe("play");
    expect(hintAction({ ...near, distance: STAGE_HINT_REACH + 0.01 })).toBeNull();
    expect(hintAction({ ...near, distance: STAGE_HINT_REACH + 0.01, playback: "playing" })).toBeNull();
    expect(hintAction({ ...near, distance: 0 })).toBe("play");
  });

  it("offers nothing when the visitor's place is not known", () => {
    expect(hintAction({ ...near, distance: null })).toBeNull();
    expect(hintAction({ ...near, distance: Number.NaN })).toBeNull();
  });

  it("shows the poster unless the video is playing, and always the poster with reduced motion", () => {
    expect(screenModeFor("waiting", false)).toBe("poster");
    expect(screenModeFor("starting", false)).toBe("poster");
    expect(screenModeFor("playing", false)).toBe("video");
    expect(screenModeFor("playing", true)).toBe("poster");
  });
});

describe("StageVideoController opening", () => {
  it("starts loading, and then waits for the visitor once the player says anything", () => {
    const t = rig();
    t.controller.open();
    expect(t.controller.status).toBe("loading");
    expect(t.controller.playback).toBe("waiting");
    t.controller.receive({ kind: "ready" });
    expect(t.controller.status).toBe("ready");
    expect(t.controller.playback).toBe("waiting");
    expect(t.funcs()).not.toContain("playVideo");
    expect(t.statuses.map((entry) => entry.status)).toEqual(["loading", "ready"]);
    expect(t.playbacks).toEqual([]);
  });

  it("treats a delivery as readiness even if onReady never arrived", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive(info({ muted: true, state: -1 }));
    expect(t.controller.status).toBe("ready");
    expect(t.funcs()).not.toContain("playVideo");
  });

  it("is blocked when nothing is heard for eight seconds", () => {
    const t = rig();
    t.controller.open();
    t.advance(READY_TIMEOUT_MS - 1);
    t.controller.tick();
    expect(t.controller.status).toBe("loading");
    t.advance(1);
    t.controller.tick();
    expect(t.controller.status).toBe("blocked");
    expect(t.statuses.at(-1)).toEqual({ status: "blocked", code: undefined });
  });

  it("does not time out once the player has spoken", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.advance(READY_TIMEOUT_MS * 3);
    t.controller.tick();
    expect(t.controller.status).not.toBe("blocked");
  });

  it.each([2, 5, 100, 101, 150])("is blocked by player error %i", (code) => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "error", code });
    expect(t.controller.status).toBe("blocked");
    expect(t.statuses.at(-1)?.code).toBe(code);
  });

  it("stays blocked and deaf once blocked, until it is opened again", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "error", code: 101 });
    t.clear();
    t.controller.receive({ kind: "ready" });
    t.controller.tick();
    t.controller.play();
    expect(t.sent).toEqual([]);
    expect(t.controller.status).toBe("blocked");
    t.controller.open();
    expect(t.controller.status).toBe("loading");
  });

  it("goes idle on close", () => {
    const t = rig();
    t.controller.open();
    t.controller.close();
    expect(t.controller.status).toBe("idle");
  });
});

describe("StageVideoController waiting", () => {
  it("never starts the video by itself, however long it waits or whatever the player reports", () => {
    const t = rig();
    waiting(t);
    t.clear();
    for (const state of [-1, 5, 3, 2, 0]) {
      t.controller.receive(info({ state, duration: 100, time: 0, muted: true }));
      t.advance(30_000);
      t.controller.tick();
    }
    expect(t.funcs()).not.toContain("playVideo");
    expect(t.funcs()).not.toContain("seekTo");
    expect(t.controller.playback).toBe("waiting");
  });

  it("does nothing when play is pressed before the player has spoken", () => {
    const t = rig();
    t.controller.open();
    t.controller.play();
    expect(t.sent).toEqual([]);
    expect(t.controller.playback).toBe("waiting");
  });

  it("pauses a player that plays without being asked, not more than once a second", () => {
    const t = rig();
    waiting(t);
    t.clear();
    t.controller.receive(info({ state: 1, duration: 100, time: 0 }));
    t.controller.receive(info({ state: 1, time: 0.2 }));
    expect(t.funcs()).toEqual(["pauseVideo"]);
    expect(t.controller.playback).toBe("waiting");
    t.advance(1000);
    t.controller.receive(info({ state: 1, time: 1.2 }));
    expect(t.funcs()).toEqual(["pauseVideo", "pauseVideo"]);
  });

  it("stays muted and quiet for the sound settings while waiting", () => {
    const t = rig();
    waiting(t);
    t.controller.setSound(true, 0.6);
    t.controller.userGesture();
    t.advance(UNMUTE_CHECK_MS * 5);
    t.controller.tick();
    expect(t.funcs()).not.toContain("unMute");
    expect(t.funcs()).not.toContain("setVolume");
    expect(t.taps).toEqual([]);
    expect(t.audible).toEqual([]);
  });
});

describe("StageVideoController play and stop", () => {
  it("plays on request, unmuted at the chosen volume, and reports it once the player is playing", () => {
    const t = rig();
    waiting(t);
    t.controller.setSound(true, 0.5);
    t.clear();
    t.controller.play();
    expect(t.sent).toEqual([
      { func: "setVolume", args: [50] },
      { func: "unMute", args: [] },
      { func: "playVideo", args: [] },
    ]);
    expect(t.controller.playback).toBe("starting");
    t.controller.receive(info({ state: 3, duration: 100, time: 0 }));
    expect(t.controller.playback).toBe("starting");
    t.controller.receive(info({ state: 1, time: 0 }));
    expect(t.controller.playback).toBe("playing");
    expect(t.playbacks).toEqual(["starting", "playing"]);
  });

  it("moves a player whose length it does not know yet to the server's place in the loop once it plays", () => {
    const t = rig(1_000_000);
    waiting(t);
    t.controller.play();
    expect(t.funcs()).not.toContain("seekTo");
    t.clear();
    t.controller.receive(info({ state: 1, duration: 300, time: 0 }));
    const seek = t.sent.find((entry) => entry.func === "seekTo");
    expect(seek?.args[0]).toBeCloseTo(aimAhead(loopPosition(1_000_000, 300), 300), 6);
    expect(seek?.args[1]).toBe(true);
  });

  it("seeks to the loop's place before it plays, when the length is known, so nothing from the wrong place is heard", () => {
    const t = rig(1_000_000);
    waiting(t);
    t.controller.receive(info({ state: 5, duration: 300, time: 40 }));
    t.controller.setSound(true, 0.5);
    t.clear();
    t.controller.play();
    expect(t.funcs()).toEqual(["setVolume", "unMute", "seekTo", "playVideo"]);
    const seek = t.sent.find((entry) => entry.func === "seekTo");
    expect(seek?.args[0]).toBeCloseTo(aimAhead(loopPosition(1_000_000, 300), 300), 6);
    expect(seek?.args[1]).toBe(true);
  });

  it("does not seek a second time when the first report of playing still carries the old position", () => {
    const t = rig(1_000_000);
    waiting(t);
    t.controller.receive(info({ state: 5, duration: 300, time: 40 }));
    t.controller.play();
    t.clear();
    t.controller.receive(info({ state: 1, time: 40 }));
    t.advance(2000);
    t.controller.receive(info({ state: 1, time: 41 }));
    expect(t.funcs()).toEqual([]);
    expect(t.controller.playback).toBe("playing");
  });

  it("moves to the loop's place again when it is played again after a stop", () => {
    const t = rig(1_000_000);
    t.controller.setSound(true, 0.5);
    playing(t, { duration: 300, time: loopPosition(1_000_000, 300) });
    t.controller.stop();
    t.controller.receive(info({ state: 2, time: 40 }));
    t.advance(120_000);
    t.clear();
    t.controller.play();
    expect(t.funcs()).toEqual(["setVolume", "unMute", "seekTo", "playVideo"]);
    const seek = t.sent.find((entry) => entry.func === "seekTo");
    expect(seek?.args[0]).toBeCloseTo(aimAhead(loopPosition(1_120_000, 300), 300), 6);
  });

  it("stops on request: pauses, mutes and goes back to waiting", () => {
    const t = rig();
    waiting(t);
    t.controller.setSound(true, 0.5);
    t.controller.play();
    t.controller.receive(info({ state: 1, duration: 100, time: 0, muted: false }));
    expect(t.audible).toEqual([true]);
    t.clear();
    t.controller.stop();
    expect(t.funcs()).toEqual(["pauseVideo", "mute"]);
    expect(t.controller.playback).toBe("waiting");
    expect(t.playbacks).toEqual(["starting", "playing", "waiting"]);
    expect(t.audible).toEqual([true, false]);
  });

  it("stops a play that has not yet started", () => {
    const t = rig();
    waiting(t);
    t.controller.play();
    t.clear();
    t.controller.stop();
    expect(t.funcs()).toContain("pauseVideo");
    expect(t.controller.playback).toBe("waiting");
  });

  it("ignores a stop when nothing was asked to play", () => {
    const t = rig();
    waiting(t);
    t.clear();
    t.controller.stop();
    expect(t.sent).toEqual([]);
    expect(t.playbacks).toEqual([]);
  });

  it("keeps a stop: the pause that follows, a later pause or the end of the clip never restart it", () => {
    const t = rig();
    playing(t);
    t.controller.stop();
    t.clear();
    t.controller.receive(info({ state: 2 }));
    t.advance(60_000);
    t.controller.tick();
    t.controller.receive(info({ state: 2 }));
    t.controller.receive(info({ state: 0 }));
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
    expect(t.controller.playback).toBe("waiting");
  });

  it("pauses again when a playing report that was already on its way arrives after the stop, and does not play", () => {
    const t = rig();
    playing(t);
    t.controller.stop();
    t.clear();
    t.advance(2000);
    t.controller.receive(info({ state: 1, time: 3 }));
    expect(t.funcs()).toEqual(["pauseVideo"]);
    expect(t.controller.playback).toBe("waiting");
  });

  it("ends the play, without restarting it, when the player is paused by something else", () => {
    const t = rig();
    waiting(t);
    t.controller.setSound(true, 0.5);
    t.controller.play();
    t.controller.receive(info({ state: 1, duration: 100, time: 0, muted: false }));
    t.clear();
    t.controller.receive(info({ state: 2 }));
    expect(t.funcs()).toEqual(["mute"]);
    expect(t.controller.playback).toBe("waiting");
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual(["mute"]);
    expect(t.audible).toEqual([true, false]);
  });

  it("keeps playing when the loop reports its end: back to the loop's place, and on", () => {
    const t = rig(1_000_000);
    playing(t, { duration: 300, time: loopPosition(1_000_000, 300) });
    t.advance(60_000);
    t.clear();
    t.controller.receive(info({ state: 0, time: 299.9 }));
    expect(t.funcs()).toEqual(["seekTo", "playVideo"]);
    expect(t.sent[0]?.args[0]).toBeCloseTo(aimAhead(loopPosition(1_060_000, 300), 300), 6);
    expect(t.controller.playback).toBe("playing");
    t.controller.receive(info({ state: 1, time: loopPosition(1_060_000, 300) }));
    expect(t.controller.playback).toBe("playing");
  });

  it("goes on playing at every wrap of the loop, and a stop still ends it for good", () => {
    const t = rig(1_000_000);
    playing(t, { duration: 300, time: loopPosition(1_000_000, 300) });
    for (let wrap = 0; wrap < 3; wrap += 1) {
      t.advance(300_000);
      t.controller.receive(info({ state: 0 }));
      t.controller.receive(info({ state: 1, time: loopPosition(1_000_000 + 300_000 * (wrap + 1), 300) }));
    }
    expect(t.funcs().filter((func) => func === "playVideo")).toHaveLength(4);
    expect(t.controller.playback).toBe("playing");
    t.controller.stop();
    t.clear();
    t.controller.receive(info({ state: 0 }));
    expect(t.funcs()).toEqual([]);
    expect(t.controller.playback).toBe("waiting");
  });

  it("plays on, without a seek, when a stream without a length ends", () => {
    const t = rig();
    playing(t, { duration: 0 });
    t.clear();
    t.controller.receive(info({ state: 0 }));
    expect(t.funcs()).toEqual(["playVideo"]);
    expect(t.controller.playback).toBe("playing");
  });

  it("gives up a play that never reaches playing, so the button reads play again", () => {
    const t = rig();
    waiting(t);
    t.controller.setSound(true, 0.5);
    t.controller.play();
    t.controller.receive(info({ state: 3, duration: 100, time: 0 }));
    t.clear();
    t.advance(START_TIMEOUT_MS - 1);
    t.controller.tick();
    expect(t.controller.playback).toBe("starting");
    expect(t.funcs()).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.controller.playback).toBe("waiting");
    expect(t.funcs()).toEqual(["pauseVideo", "mute"]);
    expect(hintAction({ live: true, distance: 3, status: t.controller.status, playback: t.controller.playback })).toBe("play");
    expect(t.playbacks).toEqual(["starting", "waiting"]);
  });

  it("does not give up a play that has reached playing, however long it goes on", () => {
    const t = rig();
    playing(t);
    t.clear();
    t.advance(START_TIMEOUT_MS * 5);
    t.controller.tick();
    expect(t.controller.playback).toBe("playing");
    expect(t.funcs()).toEqual([]);
  });

  it("can be played again after giving up, with a fresh window", () => {
    const t = rig();
    waiting(t);
    t.controller.play();
    t.advance(START_TIMEOUT_MS);
    t.controller.tick();
    expect(t.controller.playback).toBe("waiting");
    t.controller.play();
    expect(t.controller.playback).toBe("starting");
    t.advance(START_TIMEOUT_MS - 1);
    t.controller.tick();
    expect(t.controller.playback).toBe("starting");
  });

  it("pauses a late playing report from a play that was given up", () => {
    const t = rig();
    waiting(t);
    t.controller.play();
    t.advance(START_TIMEOUT_MS);
    t.controller.tick();
    t.clear();
    t.advance(1500);
    t.controller.receive(info({ state: 1, duration: 100, time: 0 }));
    expect(t.funcs()).toEqual(["pauseVideo"]);
    expect(t.controller.playback).toBe("waiting");
  });

  it("is not ended by buffering while it plays, nor by a stale pause before it has started", () => {
    const t = rig();
    waiting(t);
    t.controller.play();
    t.controller.receive(info({ state: 2 }));
    expect(t.controller.playback).toBe("starting");
    t.controller.receive(info({ state: 1, duration: 100, time: 0 }));
    t.controller.receive(info({ state: 3 }));
    expect(t.controller.playback).toBe("playing");
  });

  it("goes back to waiting when the stage is closed or blocked", () => {
    const closed = rig();
    playing(closed);
    closed.controller.close();
    expect(closed.controller.playback).toBe("waiting");
    expect(closed.playbacks).toEqual(["starting", "playing", "waiting"]);

    const blocked = rig();
    playing(blocked);
    blocked.controller.receive({ kind: "error", code: 150 });
    expect(blocked.controller.playback).toBe("waiting");
    expect(blocked.controller.status).toBe("blocked");

    const reopened = rig();
    playing(reopened);
    reopened.controller.close();
    reopened.controller.open();
    reopened.controller.receive({ kind: "ready" });
    expect(reopened.funcs().filter((func) => func === "playVideo")).toHaveLength(1);
    expect(reopened.controller.playback).toBe("waiting");
  });

  it("keeps playing with nothing sent for as long as someone is in earshot", () => {
    const t = rig();
    playing(t);
    t.clear();
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
  });
});

describe("StageVideoController sound", () => {
  const sounding = (t: Rig, volume: number) => {
    t.controller.setSound(true, volume);
    playing(t);
    t.clear();
  };

  it("unmutes at the chosen volume when play is pressed", () => {
    const t = rig();
    t.controller.setSound(true, 0.6);
    waiting(t);
    t.clear();
    t.controller.play();
    expect(t.sent).toEqual([
      { func: "setVolume", args: [60] },
      { func: "unMute", args: [] },
      { func: "playVideo", args: [] },
    ]);
  });

  it("reports the video audible only when the player confirms it is unmuted and playing", () => {
    const t = rig();
    sounding(t, 0.5);
    expect(t.audible).toEqual([]);
    t.controller.receive(info({ muted: false, state: 1 }));
    expect(t.audible).toEqual([true]);
    t.controller.setSound(false, 0.5);
    expect(t.funcs()).toContain("mute");
    expect(t.audible).toEqual([true, false]);
  });

  it("follows the volume slider", () => {
    const t = rig();
    sounding(t, 0.5);
    t.controller.setSound(true, 0.25);
    expect(t.sent).toEqual([{ func: "setVolume", args: [25] }]);
    t.clear();
    t.controller.setSound(true, 0.25);
    expect(t.sent).toEqual([]);
  });

  it("treats a zero volume as sound off", () => {
    const t = rig();
    t.controller.setSound(true, 0);
    waiting(t);
    t.clear();
    t.controller.play();
    expect(t.funcs()).toEqual(["mute", "playVideo"]);
  });

  it("asks for a tap on the player when it is still muted a second after the request", () => {
    const t = rig();
    sounding(t, 0.5);
    t.advance(UNMUTE_CHECK_MS - 1);
    t.controller.tick();
    expect(t.taps).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    expect(t.funcs()).toContain("unMute");
  });

  it("withdraws the request once the sound is out", () => {
    const t = rig();
    sounding(t, 0.5);
    t.advance(UNMUTE_CHECK_MS);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    t.controller.receive(info({ muted: false, state: 1 }));
    expect(t.taps).toEqual([true, false]);
    expect(t.audible).toEqual([true]);
  });

  it("withdraws the request when the video is stopped", () => {
    const t = rig();
    sounding(t, 0.5);
    t.advance(UNMUTE_CHECK_MS);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    t.controller.stop();
    expect(t.taps).toEqual([true, false]);
    t.clear();
    t.advance(UNMUTE_CHECK_MS * 5);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
  });

  it("never asks for a tap when the sound is off", () => {
    const t = rig();
    t.controller.setSound(false, 0.5);
    playing(t);
    t.advance(UNMUTE_CHECK_MS * 5);
    t.controller.tick();
    expect(t.taps).toEqual([]);
  });
});

describe("StageVideoController loop position", () => {
  const start = (t: Rig) => {
    waiting(t);
    t.controller.play();
    t.clear();
  };

  it("moves a player that starts elsewhere to the server's place in the loop", () => {
    const t = rig(1_000_000);
    start(t);
    t.controller.receive(info({ state: 1, duration: 300, time: 0 }));
    const target = loopPosition(1_000_000, 300);
    const seek = t.sent.find((entry) => entry.func === "seekTo");
    expect(seek).toBeDefined();
    expect(seek?.args[0]).toBeCloseTo(aimAhead(target, 300), 6);
    expect(seek?.args[1]).toBe(true);
  });

  it("leaves a player that is already in the right place alone", () => {
    const t = rig(1_000_000);
    start(t);
    t.controller.receive(info({ state: 1, duration: 300, time: loopPosition(1_000_000, 300) + 0.2 }));
    expect(t.funcs()).not.toContain("seekTo");
  });

  it("does not drag a player across the seam of the loop", () => {
    // 299.8 s is only 0.4 s from 0.2 s once the loop wraps.
    const t = rig(300_200);
    start(t);
    t.controller.receive(info({ state: 1, duration: 300, time: 299.8 }));
    expect(t.funcs()).not.toContain("seekTo");
  });

  it("corrects drift beyond one second, but not more often than every ten", () => {
    const t = rig(1_000_000);
    start(t);
    t.controller.receive(info({ state: 1, duration: 300, time: loopPosition(1_000_000, 300) }));
    t.clear();
    t.advance(2000);
    t.controller.receive(info({ state: 1, time: loopPosition(1_002_000, 300) + 2 }));
    expect(t.funcs()).toEqual([]);
    t.advance(9000);
    t.controller.receive(info({ state: 1, time: loopPosition(1_011_000, 300) + 0.9 }));
    expect(t.funcs()).toEqual([]);
    t.controller.receive(info({ state: 1, time: loopPosition(1_011_000, 300) + 2 }));
    expect(t.funcs()).toEqual(["seekTo"]);
  });

  it("leaves a stream without a duration alone", () => {
    const t = rig();
    start(t);
    t.controller.receive(info({ state: 1, duration: 0, time: 12 }));
    expect(t.funcs()).not.toContain("seekTo");
  });

  it("does not seek a video that nobody asked to play", () => {
    const t = rig(1_000_000);
    waiting(t);
    t.clear();
    t.controller.receive(info({ state: 1, duration: 300, time: 0 }));
    expect(t.funcs()).not.toContain("seekTo");
  });
});

describe("StageVideoController level", () => {
  const listening = (t: Rig, volume = 0.5) => {
    t.controller.setSound(true, volume);
    waiting(t);
    t.controller.play();
    t.controller.receive(info({ state: 1, duration: 100, time: loopPosition(1_000_000, 100), muted: true }));
    t.controller.receive(info({ muted: false, state: 1 }));
    t.advance(300);
    t.clear();
  };

  it("scales the volume by the level and does not unmute again", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0.5);
    expect(t.sent).toEqual([{ func: "setVolume", args: [25] }]);
  });

  it("tells the player at most every quarter of a second, and sends the last value on the next tick", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0.8);
    expect(t.sent).toEqual([{ func: "setVolume", args: [40] }]);
    t.clear();
    t.advance(100);
    t.controller.setLevel(0.6);
    t.controller.setLevel(0.4);
    expect(t.sent).toEqual([]);
    t.advance(150);
    t.controller.tick();
    expect(t.sent).toEqual([{ func: "setVolume", args: [20] }]);
    t.clear();
    t.advance(1000);
    t.controller.tick();
    expect(t.sent).toEqual([]);
  });

  it("mutes at level 0 at once, and asks for sound again when the level comes back", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0);
    expect(t.funcs()).toEqual(["mute"]);
    t.clear();
    t.controller.setLevel(0.5);
    expect(t.sent).toEqual([
      { func: "setVolume", args: [25] },
      { func: "unMute", args: [] },
    ]);
  });

  it("pauses the video after twenty seconds at level 0, and goes back to waiting", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0);
    t.clear();
    t.advance(QUIET_PAUSE_MS - 1);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
    expect(t.controller.playback).toBe("playing");
    t.advance(1);
    t.controller.tick();
    expect(t.funcs()).toEqual(["pauseVideo"]);
    expect(t.controller.playback).toBe("waiting");
    t.clear();
    t.controller.receive(info({ state: 2 }));
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
  });

  it("stays paused when the level rises after a pause, and plays from the loop's place when it is asked to", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0);
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    t.controller.receive(info({ state: 2, time: 10 }));
    t.advance(90_000);
    t.clear();
    t.controller.setLevel(0.5);
    expect(t.funcs()).not.toContain("playVideo");
    expect(t.controller.playback).toBe("waiting");
    t.controller.play();
    expect(t.funcs()).toContain("playVideo");
    t.controller.receive(info({ state: 1, time: 50 }));
    const seek = t.sent.find((entry) => entry.func === "seekTo");
    expect(seek?.args[0]).toBeCloseTo(aimAhead(loopPosition(1_000_000 + 300 + QUIET_PAUSE_MS + 90_000, 100), 100), 6);
  });

  it("does not pause for a dip of the level that comes back within twenty seconds", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0);
    t.advance(QUIET_PAUSE_MS - 1000);
    t.controller.setLevel(0.3);
    t.clear();
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    expect(t.funcs()).not.toContain("pauseVideo");
    expect(t.controller.playback).toBe("playing");
  });

  it("does not pause a video that is only waiting, however long the level stays at 0", () => {
    const t = rig();
    t.controller.setLevel(0);
    waiting(t);
    t.clear();
    t.advance(QUIET_PAUSE_MS * 3);
    t.controller.tick();
    expect(t.sent).toEqual([]);
  });

  it("counts the twenty seconds from the press of play when it is pressed at level 0", () => {
    const t = rig();
    t.controller.setLevel(0);
    waiting(t);
    t.advance(QUIET_PAUSE_MS * 3);
    t.controller.tick();
    t.controller.play();
    t.controller.receive(info({ state: 1, duration: 100, time: loopPosition(1_000_000 + QUIET_PAUSE_MS * 3, 100) }));
    t.clear();
    t.advance(QUIET_PAUSE_MS - 1);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.funcs()).toEqual(["pauseVideo"]);
  });
});
