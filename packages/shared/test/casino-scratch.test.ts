import { describe, expect, it } from "vitest";
import { SLOT_SYMBOLS } from "../src/casino/slots.ts";
import { SCRATCH_LINES, SCRATCH_PRIZES, SCRATCH_WEIGHT, drawScratch, scratchWins } from "../src/casino/scratch.ts";
import { cells, seededRandom } from "./seeded.ts";

const BET = 10;

describe("the prize table", () => {
  it("gives a different symbol to each of the eight prizes, rarer for the larger", () => {
    expect(SCRATCH_PRIZES.map((prize) => prize.symbol)).toEqual([...SLOT_SYMBOLS]);
    for (let at = 1; at < SCRATCH_PRIZES.length; at += 1) {
      expect(SCRATCH_PRIZES[at]!.multiplier).toBeGreaterThan(SCRATCH_PRIZES[at - 1]!.multiplier);
      expect(SCRATCH_PRIZES[at]!.weight).toBeLessThan(SCRATCH_PRIZES[at - 1]!.weight);
    }
    for (const prize of SCRATCH_PRIZES) expect(Number.isInteger(prize.multiplier)).toBe(true);
  });

  it("leaves most of the chances to losing cards", () => {
    const winning = SCRATCH_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
    expect(winning).toBeLessThan(SCRATCH_WEIGHT / 2);
    expect(winning / SCRATCH_WEIGHT).toBeCloseTo(0.2611, 6);
  });

  it("returns exactly 95% of the stake", () => {
    const back = SCRATCH_PRIZES.reduce((sum, prize) => sum + prize.weight * prize.multiplier, 0) / SCRATCH_WEIGHT;
    expect(back).toBeCloseTo(0.95, 12);
  });

  it("returns 95% over every ticket the first draw can pick, through the real card", () => {
    const rest = seededRandom(3);
    let paid = 0;
    for (let ticket = 0; ticket < SCRATCH_WEIGHT; ticket += 1) paid += drawScratch(BET, cells([ticket], SCRATCH_WEIGHT, rest)).payout;
    expect(paid / (SCRATCH_WEIGHT * BET)).toBeCloseTo(0.95, 12);
  });
});

describe("a card", () => {
  it("is a 3x3 grid of the eight symbols", () => {
    const card = drawScratch(BET, seededRandom(1));
    expect(card.grid).toHaveLength(9);
    for (const cell of card.grid) expect(SLOT_SYMBOLS).toContain(cell);
    expect(SCRATCH_LINES).toHaveLength(8);
  });

  it("decides the outcome from the first draw alone and pays the bet times the prize", () => {
    const first = SCRATCH_PRIZES[0]!;
    const card = drawScratch(BET, cells([0], SCRATCH_WEIGHT));
    expect(card.symbol).toBe(first.symbol);
    expect(card.multiplier).toBe(first.multiplier);
    expect(card.payout).toBe(BET * first.multiplier);
    expect(card.stake).toBe(BET);
    const lost = drawScratch(BET, cells([SCRATCH_WEIGHT - 1], SCRATCH_WEIGHT));
    expect(lost).toMatchObject({ symbol: null, line: null, multiplier: 0, payout: 0 });
  });

  it("reaches every prize at the edges of its share of the tickets", () => {
    let start = 0;
    for (const prize of SCRATCH_PRIZES) {
      for (const ticket of [start, start + prize.weight - 1]) {
        expect(drawScratch(BET, cells([ticket], SCRATCH_WEIGHT, seededRandom(ticket))).symbol).toBe(prize.symbol);
      }
      start += prize.weight;
    }
    expect(drawScratch(BET, cells([start], SCRATCH_WEIGHT)).symbol).toBeNull();
    const top = SCRATCH_PRIZES.at(-1)!;
    const jackpot = drawScratch(BET, cells([start - 1], SCRATCH_WEIGHT));
    expect(jackpot.symbol).toBe("seven");
    expect(jackpot.payout).toBe(BET * top.multiplier);
  });

  it("shows a grid that agrees with the outcome: one winning line of the prize symbol, or none", () => {
    const random = seededRandom(2025);
    let wins = 0;
    for (let n = 0; n < 4000; n += 1) {
      const card = drawScratch(BET, random);
      const lines = scratchWins(card.grid);
      if (card.symbol === null) {
        expect(lines, "a lost card shows no line").toEqual([]);
        expect(card.line).toBeNull();
        expect(card.payout).toBe(0);
      } else {
        wins += 1;
        expect(lines).toHaveLength(1);
        expect(lines[0]!.symbol).toBe(card.symbol);
        expect([...lines[0]!.line]).toEqual([...card.line!]);
        expect(card.payout).toBe(BET * card.multiplier);
      }
    }
    expect(wins).toBeGreaterThan(500);
    expect(wins).toBeLessThan(1700);
  });

  it("shows a grid that agrees with the outcome for any draws at all, even constant ones", () => {
    for (const value of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const card = drawScratch(BET, () => value);
      const lines = scratchWins(card.grid);
      expect(lines.length === 0, `draw ${value}`).toBe(card.symbol === null);
      if (card.symbol !== null) expect(lines.map((line) => line.symbol)).toEqual([card.symbol]);
      expect(card.grid.every((cell) => SLOT_SYMBOLS.includes(cell))).toBe(true);
    }
  });

  it("puts the prize line anywhere among the eight lines", () => {
    const seen = new Set<string>();
    const random = seededRandom(8);
    for (let n = 0; n < 600; n += 1) {
      const card = drawScratch(BET, cells([0], SCRATCH_WEIGHT, random));
      seen.add(card.line!.join());
    }
    expect(seen.size).toBe(8);
  });

  it("is the same card for the same draws", () => {
    expect(drawScratch(BET, seededRandom(6))).toEqual(drawScratch(BET, seededRandom(6)));
  });
});

describe("scratchWins", () => {
  it("finds every row, column and diagonal of three alike", () => {
    for (const line of SCRATCH_LINES) {
      const grid = SLOT_SYMBOLS.slice(0, 8).concat("seven").map((symbol, at) => (line.includes(at) ? "koi" : symbol));
      const found = scratchWins(grid);
      expect(found.map((win) => win.line).some((won) => won.join() === line.join())).toBe(true);
    }
    expect(scratchWins(SLOT_SYMBOLS.slice(0, 8).concat("seven"))).toEqual([]);
  });
});
