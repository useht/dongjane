import { describe, expect, it } from "vitest";
import {
  BOW_REWARD,
  BOW_REWARD_COOLDOWN_MS,
  BOW_REWARD_DAILY_CAP,
  NO_BOW_REWARD,
  type BowReward,
  parseBowReward,
  payBows,
} from "../src/bow-reward.ts";
import { questDay } from "../src/quest.ts";

const NOON = Date.UTC(2026, 4, 12, 3, 0, 0);
const SECOND = 1000;

describe("the bow reward", () => {
  it("pays 2 coins a bow, at least 2.5 seconds apart, up to 50 a day", () => {
    expect([BOW_REWARD, BOW_REWARD_COOLDOWN_MS, BOW_REWARD_DAILY_CAP]).toEqual([2, 2500, 50]);
  });

  it("pays the first bow of the day and remembers when and how much", () => {
    const { paid, state } = payBows(NO_BOW_REWARD, 1, NOON);
    expect(paid).toBe(2);
    expect(state).toEqual({ day: questDay(NOON), earned: 2, lastAt: NOON });
  });

  it("pays nothing for a bow inside the cooldown, and does not restart the cooldown", () => {
    const first = payBows(NO_BOW_REWARD, 1, NOON).state;
    for (const wait of [0, 1, 1500, 2499]) {
      const early = payBows(first, 1, NOON + wait);
      expect(early.paid).toBe(0);
      expect(early.state).toBe(first);
    }
    const quick = payBows(first, 1, NOON + 2 * SECOND);
    expect(payBows(quick.state, 1, NOON + 3 * SECOND).paid).toBe(2);
  });

  it("pays again once 2.5 seconds have passed since the last bow that paid", () => {
    const first = payBows(NO_BOW_REWARD, 1, NOON).state;
    const second = payBows(first, 1, NOON + 3 * SECOND);
    expect(second.paid).toBe(2);
    expect(second.state).toEqual({ day: questDay(NOON), earned: 4, lastAt: NOON + 3 * SECOND });
  });

  it("stops at 50 a day: the 25th paying bow reaches it and the next pays nothing", () => {
    let state: BowReward = NO_BOW_REWARD;
    let total = 0;
    for (let bow = 1; bow <= 25; bow += 1) {
      const next = payBows(state, 1, NOON + bow * 3 * SECOND);
      expect(next.paid, `bow ${bow}`).toBe(2);
      total += next.paid;
      state = next.state;
    }
    expect(total).toBe(50);
    expect(state.earned).toBe(50);
    const over = payBows(state, 1, NOON + 26 * 3 * SECOND);
    expect(over.paid).toBe(0);
    expect(over.state).toBe(state);
    expect(payBows(state, 1, NOON + 3_600 * SECOND).paid).toBe(0);
  });

  it("never pays past the cap, even when less than a full reward is left", () => {
    const state: BowReward = { day: questDay(NOON), earned: BOW_REWARD_DAILY_CAP - 1, lastAt: NOON };
    const last = payBows(state, 1, NOON + 3 * SECOND);
    expect(last.paid).toBe(1);
    expect(last.state.earned).toBe(BOW_REWARD_DAILY_CAP);
    expect(payBows(last.state, 1, NOON + 6 * SECOND).paid).toBe(0);
  });

  it("starts the day's total again on a new KST day, at midnight in Korea", () => {
    const before = Date.UTC(2026, 4, 12, 14, 59, 59);
    const after = Date.UTC(2026, 4, 12, 15, 0, 0);
    expect(questDay(after)).toBe(questDay(before) + 1);
    const capped: BowReward = { day: questDay(before), earned: BOW_REWARD_DAILY_CAP, lastAt: before - 20 * SECOND };

    expect(payBows(capped, 1, before).paid).toBe(0);
    const morning = payBows(capped, 1, after);
    expect(morning.paid).toBe(2);
    expect(morning.state).toEqual({ day: questDay(after), earned: 2, lastAt: after });
  });

  it("counts any other day as a new one, like the refill", () => {
    const capped: BowReward = { day: questDay(NOON) + 3, earned: BOW_REWARD_DAILY_CAP, lastAt: NOON - 60 * SECOND };
    expect(payBows(capped, 1, NOON).state).toEqual({ day: questDay(NOON), earned: 2, lastAt: NOON });
    expect(payBows({ day: questDay(NOON) - 400, earned: 40, lastAt: 0 }, 1, NOON).paid).toBe(2);
  });

  it("pays bows seen together once, not once each", () => {
    const burst = payBows(NO_BOW_REWARD, 5, NOON);
    expect(burst.paid).toBe(2);
    expect(payBows(burst.state, 3, NOON + SECOND).paid).toBe(0);
    expect(payBows(burst.state, 3, NOON + 3 * SECOND).paid).toBe(2);
  });

  it("keeps a burst of bows under the cap too", () => {
    const state: BowReward = { day: questDay(NOON), earned: 49, lastAt: NOON };
    expect(payBows(state, 100, NOON + 3 * SECOND)).toEqual({ paid: 1, state: { day: questDay(NOON), earned: 50, lastAt: NOON + 3 * SECOND } });
    const full: BowReward = { ...state, earned: 50 };
    expect(payBows(full, 100, NOON + 3 * SECOND).paid).toBe(0);
  });

  it("pays nothing when no bow was completed", () => {
    for (const bows of [0, -1, Number.NaN]) {
      const none = payBows(NO_BOW_REWARD, bows, NOON);
      expect(none.paid).toBe(0);
      expect(none.state).toBe(NO_BOW_REWARD);
    }
  });

  it("does not pay twice when the clock goes backwards: the cooldown starts again from the new time", () => {
    const first = payBows(NO_BOW_REWARD, 1, NOON).state;
    const stepped = NOON - 10 * SECOND;
    const back = payBows(first, 1, stepped);
    expect(back.paid).toBe(0);
    expect(back.state).toEqual({ ...first, lastAt: stepped });
    expect(payBows(back.state, 1, stepped).paid).toBe(0);
    expect(payBows(back.state, 1, stepped + 2499).paid).toBe(0);
    const later = payBows(back.state, 1, stepped + 2500);
    expect(later.paid).toBe(2);
    expect(later.state.earned).toBe(4);
  });

  it("never pays more than the cap in a day of constant bowing, nor closer than the cooldown", () => {
    let state: BowReward = NO_BOW_REWARD;
    const paidAt: number[] = [];
    let total = 0;
    for (let at = NOON; at < NOON + 6 * 60 * 60 * SECOND; at += 700) {
      const next = payBows(state, 1 + (at % 3), at);
      if (next.paid > 0) paidAt.push(at);
      total += next.paid;
      state = next.state;
    }
    expect(total).toBe(BOW_REWARD_DAILY_CAP);
    expect(paidAt).toHaveLength(25);
    for (let i = 1; i < paidAt.length; i += 1) expect(paidAt[i]! - paidAt[i - 1]!).toBeGreaterThanOrEqual(BOW_REWARD_COOLDOWN_MS);
  });

  it("does not change the state it was given", () => {
    const state: BowReward = { day: questDay(NOON), earned: 10, lastAt: NOON };
    payBows(state, 1, NOON + 3 * SECOND);
    payBows(state, 1, NOON - SECOND);
    expect(state).toEqual({ day: questDay(NOON), earned: 10, lastAt: NOON });
  });
});

describe("parseBowReward", () => {
  it("reads a stored record and keeps only its three fields", () => {
    expect(parseBowReward({ day: 20_600, earned: 12, lastAt: NOON })).toEqual({ day: 20_600, earned: 12, lastAt: NOON });
    expect(parseBowReward({ day: 0, earned: 0, lastAt: 0, extra: true })).toEqual({ day: 0, earned: 0, lastAt: 0 });
  });

  it("rejects anything else", () => {
    for (const value of [null, undefined, "bows", 5, [], {}, { day: 1, earned: 1 }, { earned: 1, lastAt: 1 }, { day: 1, lastAt: 1 }]) {
      expect(parseBowReward(value)).toBeNull();
    }
    for (const day of [1.5, Number.NaN, "20600", null]) expect(parseBowReward({ day, earned: 2, lastAt: NOON })).toBeNull();
    for (const earned of [-2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", null]) expect(parseBowReward({ day: 20_600, earned, lastAt: NOON })).toBeNull();
    for (const lastAt of [Number.NaN, Number.POSITIVE_INFINITY, "now", null]) expect(parseBowReward({ day: 20_600, earned: 2, lastAt })).toBeNull();
  });
});
