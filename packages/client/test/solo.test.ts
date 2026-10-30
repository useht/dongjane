import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARRIVAL,
  BOW_MS,
  DHARMA_SEATS,
  EMOTE_COOLDOWN_MS,
  GATBAWI_SEATS,
  JUMP_COOLDOWN_MS,
  NPC_COUNT,
  TICK_MS,
  type TempleState,
  WORLD_BOUNDS,
  zoneAt,
} from "@dongjane/shared";
import { SoloSession } from "../src/net/solo.ts";

const T0 = 1_800_000_000_000;
const SEAT = GATBAWI_SEATS[47]!;
const SPAWN = ARRIVAL;
const PLAZA_SPOT = { x: 0, z: 14 };

function open(hue: unknown = 120): { session: SoloSession; onState: ReturnType<typeof vi.fn<(state: TempleState) => void>> } {
  const onState = vi.fn<(state: TempleState) => void>();
  return { session: new SoloSession(hue, { onState }), onState };
}

function self(session: SoloSession) {
  const monk = session.state.monks.get(session.sessionId);
  if (!monk) throw new Error("no self monk");
  return monk;
}

describe("SoloSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seats the player alone in the world with a stable id and their hue", () => {
    const { session } = open(400);
    expect(session.sessionId).toBe("solo");
    expect(session.isOpen).toBe(true);
    expect([...session.state.monks.values()].filter((monk) => !monk.npc)).toHaveLength(1);
    const monk = self(session);
    expect(monk.id).toBe("solo");
    expect(monk.hue).toBe(40);
    expect(monk.mode).toBe("stand");
    expect(Math.abs(monk.x - SPAWN.x)).toBeLessThanOrEqual(SPAWN.spread);
    expect(monk.z).toBe(SPAWN.z);
    expect(zoneAt(monk.x, monk.z)).toBe("dharma");
    expect(session.sessionId).toBe("solo");
    void session.leave();
  });

  it("fills the 법당 with npc monks that the player does not count as visitors", () => {
    const { session } = open();
    const npcs = [...session.state.monks.values()].filter((monk) => monk.npc);
    expect(npcs).toHaveLength(NPC_COUNT);
    for (const npc of npcs) expect(zoneAt(npc.x, npc.z)).toBe("dharma");
    for (const npc of npcs) expect(npc.slot).toBe(0);
    void session.leave();
  });

  it("falls back to a random valid hue when the stored one is unusable", () => {
    const { session } = open("blue");
    expect(self(session).hue).toBeGreaterThanOrEqual(0);
    expect(self(session).hue).toBeLessThan(360);
    void session.leave();
  });

  it("reports the state on every tick", () => {
    const { session, onState } = open();
    expect(onState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TICK_MS * 3);
    expect(onState).toHaveBeenCalledTimes(3);
    expect(onState).toHaveBeenLastCalledWith(session.state);
    void session.leave();
  });

  it("walks to a move target and acknowledges the sequence number", () => {
    const { session } = open();
    const startZ = self(session).z;
    session.move(1, WORLD_BOUNDS.maxZ, 7);
    expect(self(session).mode).toBe("walk");
    expect(self(session).ackSeq).toBe(7);
    vi.advanceTimersByTime(30_000);
    expect(self(session).mode).toBe("stand");
    expect(self(session).x).toBeCloseTo(1, 5);
    expect(self(session).z).toBeCloseTo(WORLD_BOUNDS.maxZ, 5);
    expect(self(session).z).not.toBe(startZ);
    void session.leave();
  });

  it("sits on a mat, bows, and stands again", () => {
    const { session } = open();
    session.sit("gatbawi", SEAT.id);
    expect(session.state.seats.get(`gatbawi:${SEAT.id}`)?.occupantId).toBe("solo");
    expect(self(session).seatId).toBe(SEAT.id);

    vi.advanceTimersByTime(10_000);
    expect(self(session).mode).toBe("kneel");

    session.bow(1);
    expect(self(session).mode).toBe("bow");
    vi.advanceTimersByTime(BOW_MS + TICK_MS * 2);
    expect(self(session).mode).toBe("kneel");
    expect(self(session).bowCount).toBe(1);

    session.stand();
    expect(self(session).mode).toBe("stand");
    expect(self(session).seatId).toBe(-1);
    expect(session.state.seats.get(`gatbawi:${SEAT.id}`)?.occupantId).toBe("");
    void session.leave();
  });

  it("walks out onto the plaza and back on foot through the 법당's doorway to a 방석 and kneels there", () => {
    const { session } = open();
    const seat = DHARMA_SEATS[4]!;
    session.move(PLAZA_SPOT.x, PLAZA_SPOT.z, 1);
    vi.advanceTimersByTime(30_000);
    expect(zoneAt(self(session).x, self(session).z)).toBe("gatbawi");
    session.sit("dharma", seat.id);
    expect(session.state.seats.get(`dharma:${seat.id}`)?.occupantId).toBe("solo");
    expect(zoneAt(self(session).x, self(session).z)).toBe("gatbawi");
    vi.advanceTimersByTime(30_000);
    expect(self(session).mode).toBe("kneel");
    expect(self(session).x).toBeCloseTo(seat.x, 1);
    expect(self(session).z).toBeCloseTo(seat.z, 1);
    expect(zoneAt(self(session).x, self(session).z)).toBe("dharma");
    void session.leave();
  });

  it("sends an emoticon that shows on the player's own monk, then waits out the cooldown", () => {
    const { session } = open();
    expect(self(session).emoteSeq).toBe(0);
    session.emote(3);
    expect(self(session).emote).toBe(3);
    expect(self(session).emoteSeq).toBe(1);

    session.emote(4);
    expect(self(session).emoteSeq).toBe(1);
    vi.advanceTimersByTime(EMOTE_COOLDOWN_MS);
    session.emote(4);
    expect(self(session).emote).toBe(4);
    expect(self(session).emoteSeq).toBe(2);
    void session.leave();
  });

  it("jumps while standing, not while seated, and waits out the cooldown", () => {
    const { session } = open();
    expect(self(session).jumpSeq).toBe(0);
    session.jump();
    expect(self(session).jumpSeq).toBe(1);
    expect(self(session).mode).toBe("stand");

    session.jump();
    expect(self(session).jumpSeq).toBe(1);
    vi.advanceTimersByTime(JUMP_COOLDOWN_MS);
    session.jump();
    expect(self(session).jumpSeq).toBe(2);

    session.sit("gatbawi", SEAT.id);
    vi.advanceTimersByTime(JUMP_COOLDOWN_MS);
    session.jump();
    expect(self(session).jumpSeq).toBe(2);
    void session.leave();
  });

  it("keeps the chant schedule current as time passes", () => {
    const { session } = open();
    const before = session.state.chant.startsAt;
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(session.state.serverTime).toBe(Date.now());
    expect(session.state.chant.startsAt).toBeGreaterThan(before);
    void session.leave();
  });

  it("stops ticking after leave and ignores later commands", async () => {
    const { session, onState } = open();
    vi.advanceTimersByTime(TICK_MS * 2);
    expect(onState).toHaveBeenCalledTimes(2);

    await session.leave();
    expect(session.isOpen).toBe(false);
    vi.advanceTimersByTime(TICK_MS * 10);
    expect(onState).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    const before = { x: self(session).x, z: self(session).z };
    session.move(0, 0, 1);
    session.sit("gatbawi", SEAT.id);
    session.bow(3);
    session.emote(2);
    session.jump();
    session.stand();
    expect(self(session).emoteSeq).toBe(0);
    expect(self(session).jumpSeq).toBe(0);
    expect(self(session).mode).toBe("stand");
    expect(self(session).seatId).toBe(-1);
    expect(self(session).ackSeq).toBe(0);
    expect({ x: self(session).x, z: self(session).z }).toEqual(before);
    expect(session.state.seats.get(`gatbawi:${SEAT.id}`)?.occupantId).toBe("");
    await expect(session.leave()).resolves.toBeUndefined();
  });
});
