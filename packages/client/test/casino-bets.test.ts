import { describe, expect, it } from "vitest";
import { MAX_BET, ROULETTE_MAX_BETS, settleRoulette, validRouletteBets } from "@dongjane/shared";
import { CHIPS, RouletteSlip, chipsFor, targetKey, usableChip } from "../src/casino/bets.ts";

const wallet = (balance: number) => ({ balance, refillDay: 0 });

describe("chips", () => {
  it("offers the four chips the balance covers", () => {
    expect(CHIPS).toEqual([10, 50, 100, 500]);
    expect(chipsFor(wallet(1000))).toEqual([10, 50, 100, 500]);
    expect(chipsFor(wallet(499))).toEqual([10, 50, 100]);
    expect(chipsFor(wallet(100))).toEqual([10, 50, 100]);
    expect(chipsFor(wallet(99))).toEqual([10, 50]);
    expect(chipsFor(wallet(10))).toEqual([10]);
    expect(chipsFor(wallet(9))).toEqual([]);
    expect(chipsFor(wallet(0))).toEqual([]);
  });

  it("keeps the chip the visitor picked while it is covered, and steps down when it is not", () => {
    expect(usableChip(100, wallet(1000))).toBe(100);
    expect(usableChip(500, wallet(240))).toBe(100);
    expect(usableChip(500, wallet(49))).toBe(10);
    expect(usableChip(50, wallet(10))).toBe(10);
    expect(usableChip(10, wallet(5))).toBe(0);
  });
});

describe("RouletteSlip", () => {
  it("lays chips on places and totals them", () => {
    const slip = new RouletteSlip();
    expect(slip.empty).toBe(true);
    expect(slip.canSpin(wallet(1000))).toBe(false);
    expect(slip.add({ kind: "red" }, 50, wallet(1000))).toBe(true);
    expect(slip.add({ kind: "red" }, 100, wallet(1000))).toBe(true);
    expect(slip.add({ kind: "straight", pick: 17 }, 10, wallet(1000))).toBe(true);
    expect(slip.amountOn({ kind: "red" })).toBe(150);
    expect(slip.count).toBe(2);
    expect(slip.stake).toBe(160);
    expect(slip.bets).toEqual([
      { kind: "red", amount: 150 },
      { kind: "straight", pick: 17, amount: 10 },
    ]);
    expect(slip.canSpin(wallet(1000))).toBe(true);
  });

  it("keeps each place and the whole slip within the shared rules", () => {
    const rich = wallet(100_000);
    const slip = new RouletteSlip();
    expect(slip.add({ kind: "odd" }, 500, rich)).toBe(true);
    expect(slip.add({ kind: "odd" }, 10, rich)).toBe(false);
    expect(slip.amountOn({ kind: "odd" })).toBe(MAX_BET);
    for (let pick = 0; pick < ROULETTE_MAX_BETS - 1; pick += 1) expect(slip.add({ kind: "straight", pick }, 10, rich)).toBe(true);
    expect(slip.count).toBe(ROULETTE_MAX_BETS);
    expect(slip.add({ kind: "straight", pick: 30 }, 10, rich)).toBe(false);
    expect(slip.add({ kind: "straight", pick: 0 }, 10, rich)).toBe(true);
    expect(validRouletteBets(slip.bets)).toBe(true);
  });

  it("will not lay more than the balance covers", () => {
    const slip = new RouletteSlip();
    expect(slip.add({ kind: "high" }, 100, wallet(130))).toBe(true);
    expect(slip.add({ kind: "low" }, 50, wallet(130))).toBe(false);
    expect(slip.add({ kind: "low" }, 10, wallet(130))).toBe(true);
    expect(slip.add({ kind: "even" }, 50, wallet(130))).toBe(false);
    expect(slip.stake).toBe(110);
  });

  it("takes back the chip laid last, and a place when its last chip goes", () => {
    const slip = new RouletteSlip();
    slip.add({ kind: "dozen", pick: 2 }, 50, wallet(1000));
    slip.add({ kind: "dozen", pick: 2 }, 10, wallet(1000));
    slip.add({ kind: "black" }, 100, wallet(1000));
    expect(slip.undo()).toBe(true);
    expect(slip.count).toBe(1);
    expect(slip.undo()).toBe(true);
    expect(slip.amountOn({ kind: "dozen", pick: 2 })).toBe(50);
    expect(slip.undo()).toBe(true);
    expect(slip.empty).toBe(true);
    expect(slip.undo()).toBe(false);
  });

  it("clears the table", () => {
    const slip = new RouletteSlip();
    slip.add({ kind: "red" }, 10, wallet(1000));
    slip.clear();
    expect(slip.empty).toBe(true);
    expect(slip.stake).toBe(0);
    expect(slip.undo()).toBe(false);
  });

  it("takes chips back, last first, when the balance no longer covers the table", () => {
    const slip = new RouletteSlip();
    slip.add({ kind: "red" }, 100, wallet(1000));
    slip.add({ kind: "straight", pick: 7 }, 50, wallet(1000));
    slip.add({ kind: "odd" }, 100, wallet(1000));
    slip.fit(wallet(260));
    expect(slip.stake).toBe(250);
    slip.fit(wallet(120));
    expect(slip.bets).toEqual([{ kind: "red", amount: 100 }]);
    slip.fit(wallet(20));
    expect(slip.empty).toBe(true);
  });

  it("names a place the same way every time", () => {
    expect(targetKey({ kind: "red" })).toBe("red");
    expect(targetKey({ kind: "dozen", pick: 3 })).toBe("dozen:3");
    expect(targetKey({ kind: "straight", pick: 0 })).toBe("straight:0");
  });

  it("produces bets the shared rules settle", () => {
    const slip = new RouletteSlip();
    slip.add({ kind: "red" }, 100, wallet(1000));
    slip.add({ kind: "straight", pick: 7 }, 10, wallet(1000));
    const spin = settleRoulette(7, slip.bets);
    expect(spin.stake).toBe(slip.stake);
    expect(spin.payout).toBe(200 + 360);
  });
});
