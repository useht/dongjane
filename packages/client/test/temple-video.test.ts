import { describe, expect, it } from "vitest";
import { aimAhead, loopPosition } from "../src/audio/music.ts";
import { OWN_PAUSE_MS, PAUSE_GAP_MS, READY_TIMEOUT_MS, START_TIMEOUT_MS, type StageStatus, UNMUTE_CHECK_MS, embedUrl } from "../src/ui/stage-video.ts";
import { TEMPLE_VIDEO_ID, TempleVideoController } from "../src/ui/temple-video.ts";

interface Sent {
  func: string;
  args: readonly unknown[];
}

function rig(serverMs = 1_000_000) {
  let clock = 0;
  let server = serverMs;
  const sent: Sent[] = [];
  const statuses: Array<{ status: StageStatus; code: number | undefined }> = [];
  const taps: boolean[] = [];
  const controller = new TempleVideoController(
    {
      send: (func, args = []) => sent.push({ func, args }),
      status: (status, reason) => statuses.push({ status, code: reason?.code }),
      tapNeeded: (needed) => taps.push(needed),
    },
    () => clock,
    () => server,
  );
  return {
    controller,
    sent,
    statuses,
    taps,
    advance(ms: number) {
      clock += ms;
      server += ms;
    },
    serverNow: () => server,
    funcs: () => sent.map((entry) => entry.func),
    clear: () => sent.splice(0),
  };
}

type Rig = ReturnType<typeof rig>;

const info = (fields: Partial<{ time: number; duration: number; muted: boolean; state: number }>) => ({ kind: "info" as const, ...fields });

// Opened and heard from; the player knows how long the video is and waits.
function ready(t: Rig, duration = 300): void {
  t.controller.open();
  t.controller.receive({ kind: "ready" });
  t.controller.receive(info({ state: 5, duration, time: 0, muted: true }));
}

// Heard from, with a volume, after a gesture, and inside the 법당: so asked to play.
function asked(t: Rig, duration = 300): void {
  ready(t, duration);
  t.controller.setVolume(0.5);
  t.controller.userGesture();
  t.controller.setInside(true);
}

// The player answers that it plays, unmuted, in the right place.
function playing(t: Rig, duration = 300): void {
  asked(t, duration);
  t.controller.receive(info({ state: 1, muted: false, time: loopPosition(t.serverNow(), duration) }));
}

describe("TEMPLE_VIDEO_ID", () => {
  it("is the video the 법당 plays, in the embed address", () => {
    expect(TEMPLE_VIDEO_ID).toBe("10TrBnVkPgc");
    const url = new URL(embedUrl("https://dongjane.example", TEMPLE_VIDEO_ID));
    expect(url.pathname).toBe("/embed/10TrBnVkPgc");
    expect(url.searchParams.get("playlist")).toBe("10TrBnVkPgc");
    expect(url.searchParams.get("loop")).toBe("1");
    expect(url.searchParams.get("playsinline")).toBe("1");
  });
});

describe("TempleVideoController opening", () => {
  it("starts loading, and is ready, and silent, as soon as the player says anything", () => {
    const t = rig();
    t.controller.open();
    expect(t.controller.status).toBe("loading");
    t.controller.receive({ kind: "ready" });
    expect(t.controller.status).toBe("ready");
    expect(t.sent).toEqual([]);
    expect(t.statuses.map((entry) => entry.status)).toEqual(["loading", "ready"]);
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
  });

  it("goes idle on close, and pauses nothing it never played", () => {
    const t = rig();
    ready(t);
    t.controller.close();
    expect(t.controller.status).toBe("idle");
    expect(t.funcs()).toEqual([]);
  });
});

describe("TempleVideoController play", () => {
  it("plays from the loop's place, unmuted at the ambient volume, once it is inside after a gesture", () => {
    const t = rig(1_000_000);
    ready(t);
    t.controller.setVolume(0.5);
    t.controller.setInside(true);
    t.controller.userGesture();
    expect(t.sent).toEqual([
      { func: "setVolume", args: [50] },
      { func: "unMute", args: [] },
      { func: "seekTo", args: [aimAhead(loopPosition(1_000_000, 300), 300), true] },
      { func: "playVideo", args: [] },
    ]);
    expect(t.controller.playing).toBe(false);
    t.controller.receive(info({ state: 1, muted: false, time: loopPosition(1_000_000, 300) }));
    expect(t.controller.playing).toBe(true);
  });

  it("waits for each of them: the player, the gesture, the room and a volume", () => {
    const t = rig();
    t.controller.open();
    t.controller.setVolume(0.5);
    t.controller.userGesture();
    t.controller.setInside(true);
    expect(t.sent).toEqual([]);
    t.controller.receive({ kind: "ready" });
    expect(t.funcs()).toContain("playVideo");

    const quiet = rig();
    ready(quiet);
    quiet.controller.userGesture();
    quiet.controller.setInside(true);
    expect(quiet.sent).toEqual([]);
    quiet.controller.setVolume(0.4);
    expect(quiet.funcs()).toContain("playVideo");

    const outside = rig();
    ready(outside);
    outside.controller.setVolume(0.5);
    outside.controller.userGesture();
    expect(outside.sent).toEqual([]);

    const ungestured = rig();
    ready(ungestured);
    ungestured.controller.setVolume(0.5);
    ungestured.controller.setInside(true);
    expect(ungestured.sent).toEqual([]);
  });

  it("does not play at volume 0", () => {
    const t = rig();
    ready(t);
    t.controller.setVolume(0);
    t.controller.userGesture();
    t.controller.setInside(true);
    expect(t.sent).toEqual([]);
  });

  it("moves a player whose length it does not know yet to the loop's place once it plays", () => {
    const t = rig(1_000_000);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    t.controller.setVolume(0.5);
    t.controller.userGesture();
    t.controller.setInside(true);
    expect(t.funcs()).toEqual(["setVolume", "unMute", "playVideo"]);
    t.clear();
    t.controller.receive(info({ state: 1, duration: 300, time: 0, muted: false }));
    expect(t.sent).toEqual([{ func: "seekTo", args: [aimAhead(loopPosition(1_000_000, 300), 300), true] }]);
  });

  it("does not seek again while the first report of playing still carries the old position", () => {
    const t = rig(1_000_000);
    asked(t);
    t.clear();
    t.controller.receive(info({ state: 1, time: 40 }));
    t.advance(2000);
    t.controller.receive(info({ state: 1, time: 41 }));
    expect(t.sent).toEqual([]);
  });

  it("corrects drift beyond one second, but not more often than every ten", () => {
    const t = rig(1_000_000);
    playing(t);
    t.clear();
    t.advance(2000);
    t.controller.receive(info({ state: 1, time: loopPosition(t.serverNow(), 300) + 2 }));
    expect(t.sent).toEqual([]);
    t.advance(9000);
    t.controller.receive(info({ state: 1, time: loopPosition(t.serverNow(), 300) + 2 }));
    expect(t.funcs()).toEqual(["seekTo"]);
  });

  it("goes on from the loop's place when the loop reports its end", () => {
    const t = rig(1_000_000);
    playing(t);
    t.advance(60_000);
    t.clear();
    t.controller.receive(info({ state: 0, time: 299.9 }));
    expect(t.sent).toEqual([
      { func: "seekTo", args: [aimAhead(loopPosition(t.serverNow(), 300), 300), true] },
      { func: "playVideo", args: [] },
    ]);
  });

  it("follows the volume setting while it plays", () => {
    const t = rig();
    playing(t);
    t.clear();
    t.controller.setVolume(0.25);
    expect(t.sent).toEqual([{ func: "setVolume", args: [25] }]);
    t.clear();
    t.controller.setVolume(0.25);
    expect(t.sent).toEqual([]);
  });

  it("pauses when the volume is turned to 0 and plays again when it is raised", () => {
    const t = rig();
    playing(t);
    t.clear();
    t.controller.setVolume(0);
    expect(t.funcs()).toEqual(["pauseVideo"]);
    t.clear();
    t.controller.setVolume(0.7);
    expect(t.funcs()).toEqual(["setVolume", "unMute", "seekTo", "playVideo"]);
    expect(t.sent[0]?.args).toEqual([70]);
  });
});

describe("TempleVideoController leaving", () => {
  it("pauses in the same tick the visitor leaves the 법당", () => {
    const t = rig();
    playing(t);
    t.clear();
    t.controller.setInside(false);
    expect(t.sent).toEqual([{ func: "pauseVideo", args: [] }]);
    expect(t.controller.playing).toBe(false);
  });

  it("pauses a play that has not started yet just the same", () => {
    const t = rig();
    asked(t);
    t.clear();
    t.controller.setInside(false);
    expect(t.funcs()).toEqual(["pauseVideo"]);
  });

  it("neither mutes nor lowers the volume to be silent: it only pauses", () => {
    const t = rig();
    playing(t);
    t.clear();
    t.controller.setInside(false);
    t.advance(60_000);
    t.controller.tick();
    expect(t.funcs()).toEqual(["pauseVideo"]);
  });

  it("does nothing when told again that the visitor is outside", () => {
    const t = rig();
    playing(t);
    t.controller.setInside(false);
    t.clear();
    t.controller.setInside(false);
    t.advance(60_000);
    t.controller.tick();
    expect(t.sent).toEqual([]);
  });

  it("plays again from the loop's place when the visitor comes back, however long after", () => {
    const t = rig(1_000_000);
    playing(t);
    t.controller.setInside(false);
    t.advance(120_000);
    t.clear();
    t.controller.setInside(true);
    expect(t.funcs()).toEqual(["setVolume", "unMute", "seekTo", "playVideo"]);
    expect(t.sent[2]?.args[0]).toBeCloseTo(aimAhead(loopPosition(t.serverNow(), 300), 300), 6);
    t.controller.receive(info({ state: 1, muted: false, time: loopPosition(t.serverNow(), 300) }));
    expect(t.controller.playing).toBe(true);
  });

  it("pauses a player that plays on after the pause, not more than once a second", () => {
    const t = rig();
    playing(t);
    t.controller.setInside(false);
    t.advance(PAUSE_GAP_MS);
    t.clear();
    t.controller.receive(info({ state: 1, time: 5 }));
    t.controller.receive(info({ state: 1, time: 5.2 }));
    expect(t.funcs()).toEqual(["pauseVideo"]);
    t.advance(PAUSE_GAP_MS);
    t.controller.receive(info({ state: 1, time: 6.2 }));
    expect(t.funcs()).toEqual(["pauseVideo", "pauseVideo"]);
    expect(t.controller.playing).toBe(false);
  });

  it("pauses a player that plays unasked, before the visitor has ever been inside", () => {
    const t = rig();
    ready(t);
    t.clear();
    t.controller.receive(info({ state: 1, time: 1 }));
    expect(t.funcs()).toEqual(["pauseVideo"]);
  });

  it("does not take its own pause for the visitor's, however often or late the player reports it", () => {
    const t = rig(1_000_000);
    playing(t);
    t.controller.setInside(false);
    t.clear();
    t.controller.receive(info({ state: 2 }));
    t.advance(OWN_PAUSE_MS - 1);
    t.controller.receive(info({ state: 2 }));
    t.advance(OWN_PAUSE_MS * 3);
    t.controller.receive(info({ state: 2 }));
    t.advance(1000);
    t.controller.setInside(true);
    t.controller.receive(info({ state: 2 }));
    expect(t.funcs()).toEqual(["setVolume", "unMute", "seekTo", "playVideo"]);
    t.controller.receive(info({ state: 1, muted: false, time: loopPosition(t.serverNow(), 300) }));
    expect(t.controller.playing).toBe(true);
  });

  it("still plays when the report of the pause it asked for arrives after it was asked to play again", () => {
    const t = rig(1_000_000);
    playing(t);
    t.controller.setInside(false);
    t.advance(300);
    t.controller.setInside(true);
    t.clear();
    t.controller.receive(info({ state: 1, muted: false, time: loopPosition(t.serverNow(), 300) }));
    t.controller.receive(info({ state: 2 }));
    expect(t.sent).toEqual([]);
    expect(t.controller.playing).toBe(true);
    t.advance(OWN_PAUSE_MS);
    t.controller.receive(info({ state: 2 }));
    expect(t.controller.playing).toBe(false);
  });
});

describe("TempleVideoController a stop that is not ours", () => {
  it("stays stopped when the visitor, or the phone, pauses it while inside, and plays on the next gesture", () => {
    const t = rig(1_000_000);
    playing(t);
    t.advance(OWN_PAUSE_MS);
    t.clear();
    t.controller.receive(info({ state: 2 }));
    expect(t.controller.playing).toBe(false);
    expect(t.sent).toEqual([]);
    t.advance(60_000);
    t.controller.tick();
    t.controller.receive(info({ state: 2 }));
    t.controller.receive(info({ state: 0 }));
    expect(t.sent).toEqual([]);
    t.controller.userGesture();
    expect(t.funcs()).toEqual(["setVolume", "unMute", "seekTo", "playVideo"]);
  });

  it("plays again when the visitor leaves and comes back", () => {
    const t = rig(1_000_000);
    playing(t);
    t.advance(OWN_PAUSE_MS);
    t.controller.receive(info({ state: 2 }));
    t.controller.setInside(false);
    t.clear();
    t.controller.setInside(true);
    expect(t.funcs()).toContain("playVideo");
  });

  it("is not ended by buffering, nor by a stale pause before it has started", () => {
    const t = rig();
    asked(t);
    t.clear();
    t.controller.receive(info({ state: 2 }));
    t.controller.receive(info({ state: 1, time: 0 }));
    t.controller.receive(info({ state: 3 }));
    expect(t.controller.playing).toBe(true);
    expect(t.sent).toEqual([]);
  });
});

describe("TempleVideoController a player that cannot be used", () => {
  it.each([2, 5, 100, 101, 150, 153])("is blocked by player error %i, and never asked again", (code) => {
    const t = rig();
    asked(t);
    t.controller.receive({ kind: "error", code });
    expect(t.controller.status).toBe("blocked");
    expect(t.statuses.at(-1)).toEqual({ status: "blocked", code });
    expect(t.controller.playing).toBe(false);
    t.clear();
    t.controller.receive({ kind: "ready" });
    t.controller.receive(info({ state: 5, duration: 300 }));
    t.controller.setInside(false);
    t.controller.setInside(true);
    t.controller.setVolume(0.9);
    t.controller.userGesture();
    for (let second = 0; second < 60; second += 1) {
      t.advance(1000);
      t.controller.tick();
    }
    expect(t.sent).toEqual([]);
    expect(t.statuses.filter((entry) => entry.status === "blocked")).toHaveLength(1);
  });

  it("ignores errors that leave the player usable", () => {
    const t = rig();
    asked(t);
    t.controller.receive({ kind: "error", code: 1 });
    expect(t.controller.status).toBe("ready");
  });

  it("tries again only when it is opened again", () => {
    const t = rig();
    asked(t);
    t.controller.receive({ kind: "error", code: 101 });
    t.controller.open();
    expect(t.controller.status).toBe("loading");
    t.clear();
    t.controller.receive({ kind: "ready" });
    expect(t.funcs()).toContain("playVideo");
  });

  it("starts nothing in a player that is closed, and asks again from the start when it is opened", () => {
    const t = rig();
    playing(t);
    t.controller.close();
    expect(t.controller.playing).toBe(false);
    t.clear();
    t.controller.setInside(false);
    t.controller.setInside(true);
    t.controller.receive(info({ state: 1 }));
    expect(t.sent).toEqual([]);
    t.controller.open();
    t.controller.receive({ kind: "ready" });
    expect(t.funcs()).toEqual(["setVolume", "unMute", "playVideo"]);
  });
});

describe("TempleVideoController taps", () => {
  it("asks for a tap on the player when it has not started a few seconds after being asked, and does not ask again", () => {
    const t = rig();
    asked(t);
    t.clear();
    t.advance(START_TIMEOUT_MS - 1);
    t.controller.tick();
    expect(t.taps).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    t.advance(START_TIMEOUT_MS * 3);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    expect(t.sent).toEqual([]);
    t.controller.receive(info({ state: 1, muted: false, time: loopPosition(t.serverNow(), 300) }));
    expect(t.taps).toEqual([true, false]);
  });

  it("asks for a tap when it plays but stays muted, asking for sound again once a second", () => {
    const t = rig();
    asked(t);
    t.controller.receive(info({ state: 1, muted: true, time: loopPosition(t.serverNow(), 300) }));
    t.clear();
    t.advance(UNMUTE_CHECK_MS - 1);
    t.controller.tick();
    expect(t.taps).toEqual([]);
    t.advance(1);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    expect(t.funcs()).toEqual(["unMute"]);
    t.controller.receive(info({ muted: false, state: 1 }));
    expect(t.taps).toEqual([true, false]);
  });

  it("withdraws the request when the visitor leaves the 법당", () => {
    const t = rig();
    asked(t);
    t.advance(START_TIMEOUT_MS);
    t.controller.tick();
    expect(t.taps).toEqual([true]);
    t.controller.setInside(false);
    expect(t.taps).toEqual([true, false]);
    t.clear();
    t.advance(START_TIMEOUT_MS * 3);
    t.controller.tick();
    expect(t.sent).toEqual([]);
  });

  it("never asks for a tap while nothing is wanted", () => {
    const t = rig();
    ready(t);
    t.advance(START_TIMEOUT_MS * 5);
    t.controller.tick();
    t.controller.setVolume(0.5);
    t.controller.userGesture();
    t.advance(START_TIMEOUT_MS * 5);
    t.controller.tick();
    expect(t.taps).toEqual([]);
  });
});
