import { describe, expect, it } from "vitest";
import { KST_OFFSET_MS } from "../src/constants.ts";
import { drawScratch } from "../src/casino/scratch.ts";
import { spinRoulette, type RouletteBet } from "../src/casino/roulette.ts";
import { SLOT_KINDS, spinSlot } from "../src/casino/slots.ts";
import {
  MAX_BET,
  MIN_BET,
  REFILL_BELOW,
  START_BALANCE,
  type Wallet,
  applyResult,
  canBet,
  canStake,
  isBetAmount,
  newWallet,
  parseWallet,
  refillDaily,
} from "../src/casino/wallet.ts";
import { questDay } from "../src/quest.ts";
import { seededRandom } from "./seeded.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const kstMidnight = (day: number): number => day * DAY_MS - KST_OFFSET_MS;
const DAY = 20_500;

describe("the wallet", () => {
  it("starts with 1000 coins on the day it was made", () => {
    const now = kstMidnight(DAY) + 5 * 60 * 60 * 1000;
    expect(newWallet(now)).toEqual({ balance: START_BALANCE, refillDay: DAY });
    expect(START_BALANCE).toBe(1000);
    expect(newWallet(now).refillDay).toBe(questDay(now));
  });

  it("takes bets from 10 to 500 whole coins", () => {
    expect([MIN_BET, MAX_BET]).toEqual([10, 500]);
    for (const amount of [10, 11, 100, 499, 500]) expect(isBetAmount(amount)).toBe(true);
    for (const amount of [0, 9, 501, 1000, -10, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(isBetAmount(amount)).toBe(false);
  });

  it("lets a visitor bet no more than the balance", () => {
    expect(canBet({ balance: 1000, refillDay: DAY }, 500)).toBe(true);
    expect(canBet({ balance: 120, refillDay: DAY }, 120)).toBe(true);
    expect(canBet({ balance: 120, refillDay: DAY }, 121)).toBe(false);
    expect(canBet({ balance: 9, refillDay: DAY }, 10)).toBe(false);
    expect(canBet({ balance: 0, refillDay: DAY }, 10)).toBe(false);
    expect(canBet({ balance: 1000, refillDay: DAY }, 501)).toBe(false);
    expect(canBet({ balance: 1000, refillDay: DAY }, 5)).toBe(false);
  });

  it("covers several bets at once by their sum", () => {
    const wallet: Wallet = { balance: 1000, refillDay: DAY };
    expect(canStake(wallet, 1000)).toBe(true);
    expect(canStake(wallet, 1001)).toBe(false);
    expect(canStake(wallet, 0)).toBe(false);
    expect(canStake(wallet, -10)).toBe(false);
    expect(canStake(wallet, 7.5)).toBe(false);
  });

  it("takes the stake and pays the payout, without changing the wallet it was given", () => {
    const wallet: Wallet = { balance: 1000, refillDay: DAY };
    expect(applyResult(wallet, { stake: 100, payout: 250 })).toEqual({ balance: 1150, refillDay: DAY });
    expect(applyResult(wallet, { stake: 100, payout: 0 })).toEqual({ balance: 900, refillDay: DAY });
    expect(applyResult(wallet, { stake: 100, payout: 100 })).toEqual(wallet);
    expect(wallet).toEqual({ balance: 1000, refillDay: DAY });
  });
});

describe("the daily refill", () => {
  const poor = (balance: number, refillDay = DAY): Wallet => ({ balance, refillDay });

  it("tops a nearly empty wallet up to 1000 on a new KST day", () => {
    const next = kstMidnight(DAY + 1) + 60_000;
    expect(refillDaily(poor(0), next)).toEqual({ balance: 1000, refillDay: DAY + 1 });
    expect(refillDaily(poor(50), next)).toEqual({ balance: 1000, refillDay: DAY + 1 });
    expect(refillDaily(poor(REFILL_BELOW - 1), next)).toEqual({ balance: 1000, refillDay: DAY + 1 });
  });

  it("leaves a wallet of 100 coins or more alone, whatever the day", () => {
    const next = kstMidnight(DAY + 3);
    for (const balance of [REFILL_BELOW, 101, 1000, 5000]) {
      const wallet = poor(balance);
      expect(refillDaily(wallet, next)).toBe(wallet);
    }
  });

  it("refills once a day: not again on the same KST day", () => {
    const noon = kstMidnight(DAY + 1) + 12 * 60 * 60 * 1000;
    const refilled = refillDaily(poor(20), noon);
    expect(refilled.balance).toBe(1000);
    const spent = applyResult(refilled, { stake: 950, payout: 0 });
    expect(spent.balance).toBe(50);
    expect(refillDaily(spent, noon + 60_000)).toBe(spent);
    expect(refillDaily(spent, kstMidnight(DAY + 2) - 1)).toBe(spent);
    expect(refillDaily(spent, kstMidnight(DAY + 2))).toEqual({ balance: 1000, refillDay: DAY + 2 });
  });

  it("turns the day at midnight in Korea, not at midnight UTC", () => {
    const wallet = poor(0, DAY - 1);
    expect(refillDaily(wallet, kstMidnight(DAY) - 1)).toBe(wallet);
    expect(refillDaily(wallet, kstMidnight(DAY))).toEqual({ balance: 1000, refillDay: DAY });
    const utcMidnight = DAY * DAY_MS;
    expect(refillDaily(poor(0, DAY), utcMidnight)).toEqual(poor(0, DAY));
    expect(refillDaily(poor(0, DAY), utcMidnight + 15 * 60 * 60 * 1000 - 1)).toEqual(poor(0, DAY));
    expect(refillDaily(poor(0, DAY), utcMidnight + 15 * 60 * 60 * 1000)).toEqual({ balance: 1000, refillDay: DAY + 1 });
  });

  it("refills a wallet last topped up on any earlier day", () => {
    expect(refillDaily(poor(10, DAY - 400), kstMidnight(DAY))).toEqual({ balance: 1000, refillDay: DAY });
  });

  it("counts any other KST day as due, an earlier one too", () => {
    const wallet = poor(0, DAY + 5);
    expect(refillDaily(wallet, kstMidnight(DAY))).toEqual({ balance: 1000, refillDay: DAY });
  });
});

describe("parseWallet", () => {
  it("reads a stored wallet of whole numbers and keeps only the two fields", () => {
    expect(parseWallet({ balance: 640, refillDay: DAY })).toEqual({ balance: 640, refillDay: DAY });
    expect(parseWallet({ balance: 0, refillDay: 0, extra: true })).toEqual({ balance: 0, refillDay: 0 });
  });

  it("rejects anything else", () => {
    for (const value of [null, undefined, "wallet", 5, [], {}, { balance: 5 }, { refillDay: DAY }]) expect(parseWallet(value)).toBeNull();
    for (const balance of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "500", null]) expect(parseWallet({ balance, refillDay: DAY })).toBeNull();
    for (const refillDay of [1.5, Number.NaN, "20500", null]) expect(parseWallet({ balance: 500, refillDay })).toBeNull();
  });
});

describe("playing on", () => {
  it("never leaves a wallet with a fraction or less than nothing, whatever it plays", () => {
    const random = seededRandom(77);
    let wallet = newWallet(kstMidnight(DAY));
    for (let n = 0; n < 3000; n += 1) {
      const room = Math.floor(wallet.balance / MIN_BET) * MIN_BET;
      if (room < MIN_BET) {
        wallet = refillDaily(wallet, kstMidnight(DAY + 1 + n));
        continue;
      }
      const bet = Math.min(MAX_BET, MIN_BET * (1 + Math.floor(random() * 50)), room);
      expect(canBet(wallet, bet)).toBe(true);
      const game = Math.floor(random() * 5);
      if (game < 3) wallet = applyResult(wallet, spinSlot(SLOT_KINDS[game]!, bet, random));
      else if (game === 3) wallet = applyResult(wallet, drawScratch(bet, random));
      else {
        const bets: RouletteBet[] = [{ kind: "straight", pick: Math.floor(random() * 37), amount: bet }];
        expect(canStake(wallet, bet)).toBe(true);
        wallet = applyResult(wallet, spinRoulette(bets, random));
      }
      expect(Number.isInteger(wallet.balance)).toBe(true);
      expect(wallet.balance).toBeGreaterThanOrEqual(0);
    }
  });
});
