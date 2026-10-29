import { describe, expect, it } from "vitest";
import { QUIET_PAUSE_MS, aimAhead, loopPosition } from "../src/audio/music.ts";
import {
  PLAYER_ORIGIN,
  PLAY_NEEDED_MS,
  READY_TIMEOUT_MS,
  STAGE_VIDEO_ID,
  StageVideoController,
  type StageStatus,
  UNMUTE_CHECK_MS,
  embedUrl,
  listeningMessage,
  parsePlayerMessage,
  playerCommand,
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
  const plays: boolean[] = [];
  const audible: boolean[] = [];
  const controller = new StageVideoController(
    {
      send: (func, args = []) => sent.push({ func, args }),
      status: (status, reason) => statuses.push({ status, code: reason?.code }),
      tapNeeded: (needed) => taps.push(needed),
      playNeeded: (needed) => plays.push(needed),
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
    plays,
    audible,
    advance(ms: number) {
      clock += ms;
      server += ms;
    },
    funcs: () => sent.map((entry) => entry.func),
    clear: () => sent.splice(0),
  };
}

const info = (fields: Partial<{ time: number; duration: number; muted: boolean; state: number }>) => ({ kind: "info" as const, ...fields });

describe("embedUrl", () => {
  it("asks for a muted, looping, chrome-free player that can be steered by postMessage", () => {
    const url = new URL(embedUrl("https://dongjane.example"));
    expect(url.origin).toBe(PLAYER_ORIGIN);
    expect(url.pathname).toBe(`/embed/${STAGE_VIDEO_ID}`);
    expect(url.searchParams.get("autoplay")).toBe("1");
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

describe("StageVideoController opening", () => {
  it("starts loading, and starts the video once the player says anything", () => {
    const t = rig();
    t.controller.open();
    expect(t.controller.status).toBe("loading");
    t.controller.receive({ kind: "ready" });
    expect(t.funcs()).toContain("playVideo");
    t.controller.receive(info({ state: 1, duration: 100, time: 0 }));
    expect(t.controller.status).toBe("playing");
    expect(t.statuses.map((entry) => entry.status)).toEqual(["loading", "playing"]);
  });

  it("treats a delivery as readiness even if onReady never arrived", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive(info({ muted: true, state: -1 }));
    expect(t.funcs()).toContain("playVideo");
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

describe("StageVideoController sound", () => {
  const playing = (t: ReturnType<typeof rig>, muted = true) => {
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 1, duration: 100, time: 0, muted }));
    t.clear();
  };

  it("stays muted until someone has touched the page", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0.6);
    expect(t.funcs()).not.toContain("unMute");
    expect(t.audible).toEqual([]);
  });

  it("unmutes at the chosen volume after the first gesture", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0.6);
    t.controller.userGesture();
    expect(t.sent).toEqual([
      { func: "setVolume", args: [60] },
      { func: "unMute", args: [] },
    ]);
  });

  it("reports the video audible only when the player confirms it is unmuted and playing", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0.5);
    t.controller.userGesture();
    expect(t.audible).toEqual([]);
    t.controller.receive(info({ muted: false, state: 1 }));
    expect(t.audible).toEqual([true]);
    t.controller.setSound(false, 0.5);
    expect(t.funcs()).toContain("mute");
    expect(t.audible).toEqual([true, false]);
  });

  it("follows the volume slider", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0.5);
    t.controller.userGesture();
    t.clear();
    t.controller.setSound(true, 0.25);
    expect(t.sent).toEqual([{ func: "setVolume", args: [25] }]);
    t.clear();
    t.controller.setSound(true, 0.25);
    expect(t.sent).toEqual([]);
  });

  it("treats a zero volume as sound off", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0);
    t.controller.userGesture();
    expect(t.funcs()).not.toContain("unMute");
  });

  it("asks for a tap on the player when it is still muted a second after the request", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0.5);
    t.controller.userGesture();
    t.clear();
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
    playing(t);
    t.controller.setSound(true, 0.5);
    t.controller.userGesture();
    t.advance(UNMUTE_CHECK_MS);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    t.controller.receive(info({ muted: false, state: 1 }));
    expect(t.taps).toEqual([true, false]);
    expect(t.audible).toEqual([true]);
  });

  it("never asks for a tap when the sound is off", () => {
    const t = rig();
    playing(t);
    t.advance(UNMUTE_CHECK_MS * 5);
    t.controller.tick();
    expect(t.taps).toEqual([]);
  });
});

describe("StageVideoController playback", () => {
  it("restarts a video that a tap or the end of the clip stopped", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 1, duration: 100, time: 0 }));
    t.clear();
    t.controller.receive(info({ state: 2 }));
    expect(t.funcs()).toContain("playVideo");
    t.clear();
    t.controller.receive(info({ state: 0 }));
    expect(t.funcs()).toContain("playVideo");
  });

  it("retries playVideo every few seconds while it is not playing", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.clear();
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
    t.advance(4000);
    t.controller.tick();
    expect(t.funcs()).toEqual(["playVideo"]);
  });

  it("pauses while the tab is hidden and resumes when it is back", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 1, duration: 100, time: 0 }));
    t.clear();
    t.controller.setHidden(true);
    expect(t.funcs()).toEqual(["pauseVideo"]);
    t.controller.receive(info({ state: 2 }));
    expect(t.funcs()).toEqual(["pauseVideo"]);
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual(["pauseVideo"]);
    t.clear();
    t.controller.setHidden(false);
    expect(t.funcs()).toContain("playVideo");
  });

  it("sends nothing about the tab before the player is ready", () => {
    const t = rig();
    t.controller.open();
    t.controller.setHidden(true);
    t.controller.setHidden(false);
    expect(t.sent).toEqual([]);
  });
});

describe("StageVideoController loop position", () => {
  it("moves a player that starts elsewhere to the server's place in the loop", () => {
    const t = rig(1_000_000);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.clear();
    t.controller.receive(info({ state: 1, duration: 300, time: 0 }));
    const target = loopPosition(1_000_000, 300);
    const seek = t.sent.find((entry) => entry.func === "seekTo");
    expect(seek).toBeDefined();
    expect(seek?.args[0]).toBeCloseTo(aimAhead(target, 300), 6);
    expect(seek?.args[1]).toBe(true);
  });

  it("leaves a player that is already in the right place alone", () => {
    const t = rig(1_000_000);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.clear();
    t.controller.receive(info({ state: 1, duration: 300, time: loopPosition(1_000_000, 300) + 0.2 }));
    expect(t.funcs()).not.toContain("seekTo");
  });

  it("does not drag a player across the seam of the loop", () => {
    // 299.8 s is only 0.4 s from 0.2 s once the loop wraps.
    const t = rig(300_200);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.clear();
    t.controller.receive(info({ state: 1, duration: 300, time: 299.8 }));
    expect(t.funcs()).not.toContain("seekTo");
  });

  it("corrects drift beyond one second, but not more often than every ten", () => {
    const t = rig(1_000_000);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
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
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.clear();
    t.controller.receive(info({ state: 1, duration: 0, time: 12 }));
    expect(t.funcs()).not.toContain("seekTo");
  });
});

describe("StageVideoController level", () => {
  const listening = (t: ReturnType<typeof rig>, volume = 0.5) => {
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 1, duration: 100, time: loopPosition(1_000_000, 100), muted: true }));
    t.controller.setSound(true, volume);
    t.controller.userGesture();
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

  it("pauses the video after twenty seconds at level 0, and leaves it paused", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0);
    t.clear();
    t.advance(QUIET_PAUSE_MS - 1);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.funcs()).toEqual(["pauseVideo"]);
    t.clear();
    t.controller.receive(info({ state: 2 }));
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual([]);
  });

  it("plays again and moves to the loop's place when the level rises after a pause", () => {
    const t = rig();
    listening(t);
    t.controller.setLevel(0);
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    t.controller.receive(info({ state: 2, time: 10 }));
    t.advance(90_000);
    t.clear();
    t.controller.setLevel(0.5);
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
  });

  it("counts the twenty seconds from the start when it is opened at level 0", () => {
    const t = rig();
    t.controller.setLevel(0);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 1, duration: 100, time: loopPosition(1_000_000, 100) }));
    t.clear();
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    expect(t.funcs()).toEqual(["pauseVideo"]);
  });
});

describe("StageVideoController play prompt", () => {
  const playing = (t: ReturnType<typeof rig>) => {
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 1, duration: 100, time: loopPosition(1_000_000, 100), muted: true }));
  };

  const stall = (t: ReturnType<typeof rig>) => {
    playing(t);
    t.controller.receive(info({ state: 2 }));
  };

  it("asks for a play button only after the video has sat unplayed for a few seconds", () => {
    const t = rig();
    stall(t);
    t.advance(PLAY_NEEDED_MS - 1);
    t.controller.tick();
    expect(t.plays).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.plays).toEqual([true]);
    t.advance(10_000);
    t.controller.tick();
    expect(t.plays).toEqual([true]);
  });

  it("counts from the moment the player was ready when it never starts", () => {
    const t = rig();
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.advance(PLAY_NEEDED_MS - 1);
    t.controller.tick();
    expect(t.plays).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.plays).toEqual([true]);
  });

  it("does not flash for a player that is not ready yet", () => {
    const t = rig();
    t.controller.open();
    t.advance(READY_TIMEOUT_MS - 1);
    t.controller.tick();
    expect(t.plays).toEqual([]);
  });

  it("does not flash for a short pause that the retry cures", () => {
    const t = rig();
    stall(t);
    t.advance(PLAY_NEEDED_MS - 1);
    t.controller.tick();
    t.controller.receive(info({ state: 1 }));
    t.advance(PLAY_NEEDED_MS);
    t.controller.tick();
    expect(t.plays).toEqual([]);
  });

  it("takes the button back as soon as the player reports playing", () => {
    const t = rig();
    stall(t);
    t.advance(PLAY_NEEDED_MS);
    t.controller.tick();
    t.controller.receive(info({ state: 1 }));
    expect(t.plays).toEqual([true, false]);
  });

  it("starts a new wait when it stalls again", () => {
    const t = rig();
    stall(t);
    t.advance(PLAY_NEEDED_MS);
    t.controller.tick();
    t.controller.receive(info({ state: 1 }));
    t.controller.receive(info({ state: 2 }));
    t.advance(PLAY_NEEDED_MS - 1);
    t.controller.tick();
    expect(t.plays).toEqual([true, false]);
    t.advance(1);
    t.controller.tick();
    expect(t.plays).toEqual([true, false, true]);
  });

  it("never asks while the tab is hidden, and waits afresh when it is back", () => {
    const t = rig();
    playing(t);
    t.controller.setHidden(true);
    t.controller.receive(info({ state: 2 }));
    t.advance(PLAY_NEEDED_MS * 4);
    t.controller.tick();
    expect(t.plays).toEqual([]);
    t.controller.setHidden(false);
    t.advance(PLAY_NEEDED_MS - 1);
    t.controller.tick();
    expect(t.plays).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.plays).toEqual([true]);
  });

  it("takes the button back when the tab is hidden", () => {
    const t = rig();
    stall(t);
    t.advance(PLAY_NEEDED_MS);
    t.controller.tick();
    t.controller.setHidden(true);
    expect(t.plays).toEqual([true, false]);
  });

  it("never asks while the video is paused for nobody being in earshot", () => {
    const t = rig();
    playing(t);
    t.controller.setLevel(0);
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    t.controller.receive(info({ state: 2 }));
    t.advance(PLAY_NEEDED_MS * 10);
    t.controller.tick();
    expect(t.plays).toEqual([]);
  });

  it("takes the button back when the quiet pause begins", () => {
    const t = rig();
    stall(t);
    t.controller.setLevel(0);
    t.advance(PLAY_NEEDED_MS);
    t.controller.tick();
    expect(t.plays).toEqual([true]);
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    expect(t.plays).toEqual([true, false]);
  });

  it("resume plays at once, with the sound a tap allows, and hides the button until another wait passes", () => {
    const t = rig();
    playing(t);
    t.controller.setSound(true, 0.5);
    t.controller.receive(info({ state: 2 }));
    t.advance(PLAY_NEEDED_MS);
    t.controller.tick();
    t.clear();
    t.controller.resume();
    expect(t.sent).toEqual([
      { func: "setVolume", args: [50] },
      { func: "unMute", args: [] },
      { func: "playVideo", args: [] },
    ]);
    expect(t.plays).toEqual([true, false]);
    t.advance(PLAY_NEEDED_MS - 1);
    t.controller.tick();
    expect(t.plays).toEqual([true, false]);
    t.advance(1);
    t.controller.tick();
    expect(t.plays).toEqual([true, false, true]);
  });

  it("resume wakes a video paused for want of listeners", () => {
    const t = rig();
    playing(t);
    t.controller.setLevel(0);
    t.advance(QUIET_PAUSE_MS);
    t.controller.tick();
    t.controller.receive(info({ state: 2 }));
    t.clear();
    t.controller.resume();
    expect(t.funcs()).toContain("playVideo");
    t.clear();
    t.controller.receive(info({ state: 2 }));
    expect(t.funcs()).toContain("playVideo");
  });

  it("takes the button back when the stage is closed or blocked", () => {
    const closed = rig();
    stall(closed);
    closed.advance(PLAY_NEEDED_MS);
    closed.controller.tick();
    closed.controller.close();
    expect(closed.plays).toEqual([true, false]);

    const blocked = rig();
    stall(blocked);
    blocked.advance(PLAY_NEEDED_MS);
    blocked.controller.tick();
    blocked.controller.receive({ kind: "error", code: 150 });
    expect(blocked.plays).toEqual([true, false]);
    blocked.advance(PLAY_NEEDED_MS * 2);
    blocked.controller.tick();
    expect(blocked.plays).toEqual([true, false]);
  });
});
