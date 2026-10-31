import { describe, expect, it } from "vitest";
import {
  CLASSIC_COIN_PAIR,
  CLASSIC_PAY,
  FIVE_REEL_PAY,
  LUCKY_SEVEN_ANY_BAR,
  LUCKY_SEVEN_PAY,
  LUCKY_SEVEN_SCATTER,
  SLOT_KINDS,
  SLOT_LAYOUT,
  SLOT_STRIPS,
  SLOT_SYMBOLS,
  type SlotKind,
  type SlotSymbol,
  lineWin,
  slotWins,
  spinSlot,
} from "../src/casino/slots.ts";
import { cells, seededRandom } from "./seeded.ts";

const STRIP_LENGTH = 32;

function chance(kind: SlotKind, symbol: SlotSymbol): number {
  return SLOT_STRIPS[kind].filter((other) => other === symbol).length / SLOT_STRIPS[kind].length;
}

// The exact return of one coin: every stop of the three reels played through the real spin.
function threeReelReturn(kind: "classic" | "luckySeven"): number {
  let total = 0;
  for (let a = 0; a < STRIP_LENGTH; a += 1) {
    for (let b = 0; b < STRIP_LENGTH; b += 1) {
      for (let c = 0; c < STRIP_LENGTH; c += 1) total += spinSlot(kind, 1, cells([a, b, c], STRIP_LENGTH)).payout;
    }
  }
  return total / STRIP_LENGTH ** 3;
}

// Each row of the window reads a symbol drawn from the strip on every reel, so the return is the lines' average pay times their number.
function fiveReelReturn(): number {
  let perLine = 0;
  const reel = SLOT_SYMBOLS.length;
  for (let n = 0; n < reel ** 5; n += 1) {
    const line = Array.from({ length: 5 }, (_, at) => SLOT_SYMBOLS[Math.floor(n / reel ** at) % reel] as SlotSymbol);
    const win = lineWin("fiveReel", line);
    if (win) perLine += win.multiplier * line.reduce((odds, symbol) => odds * chance("fiveReel", symbol), 1);
  }
  return perLine * SLOT_LAYOUT.fiveReel.lines.length;
}

function hitRate(kind: "classic" | "luckySeven"): number {
  let hits = 0;
  for (let a = 0; a < STRIP_LENGTH; a += 1) {
    for (let b = 0; b < STRIP_LENGTH; b += 1) {
      for (let c = 0; c < STRIP_LENGTH; c += 1) if (spinSlot(kind, 1, cells([a, b, c], STRIP_LENGTH)).payout > 0) hits += 1;
    }
  }
  return hits / STRIP_LENGTH ** 3;
}

describe("the reels", () => {
  it("name eight symbols and give every machine a strip that shows each of them", () => {
    expect([...SLOT_SYMBOLS]).toEqual(["coin", "pouch", "lotus", "koi", "bell", "lantern", "ingot", "seven"]);
    for (const kind of SLOT_KINDS) {
      expect(SLOT_STRIPS[kind]).toHaveLength(STRIP_LENGTH);
      for (const symbol of SLOT_SYMBOLS) expect(SLOT_STRIPS[kind]).toContain(symbol);
    }
  });

  it("shows one row on the one-line machines and three rows on the five-reel", () => {
    expect(SLOT_LAYOUT.classic).toEqual({ reels: 3, lines: [0] });
    expect(SLOT_LAYOUT.luckySeven).toEqual({ reels: 3, lines: [0] });
    expect(SLOT_LAYOUT.fiveReel).toEqual({ reels: 5, lines: [0, 1, 2] });
  });

  it("make the better symbols rarer and the better pays larger, on the classic and the five-reel machines", () => {
    for (const kind of ["classic", "fiveReel"] as const) {
      for (let at = 1; at < SLOT_SYMBOLS.length; at += 1) {
        const worse = SLOT_SYMBOLS[at - 1] as SlotSymbol;
        const better = SLOT_SYMBOLS[at] as SlotSymbol;
        expect(chance(kind, better), `${kind} ${better}`).toBeLessThanOrEqual(chance(kind, worse));
      }
    }
    for (let at = 1; at < SLOT_SYMBOLS.length; at += 1) {
      const worse = SLOT_SYMBOLS[at - 1] as SlotSymbol;
      const better = SLOT_SYMBOLS[at] as SlotSymbol;
      expect(CLASSIC_PAY[better]).toBeGreaterThan(CLASSIC_PAY[worse]);
      for (let run = 0; run < 3; run += 1) expect(FIVE_REEL_PAY[better][run] as number).toBeGreaterThan(FIVE_REEL_PAY[worse][run] as number);
    }
    for (const symbol of SLOT_SYMBOLS) {
      const [three, four, five] = FIVE_REEL_PAY[symbol];
      expect(four).toBeGreaterThan(three);
      expect(five).toBeGreaterThan(four);
    }
  });

  it("pay only whole multiples of the bet", () => {
    const pays = [
      ...Object.values(CLASSIC_PAY),
      ...Object.values(FIVE_REEL_PAY).flat(),
      ...Object.values(LUCKY_SEVEN_PAY),
      CLASSIC_COIN_PAIR,
      LUCKY_SEVEN_ANY_BAR,
      ...LUCKY_SEVEN_SCATTER,
    ];
    for (const pay of pays) expect(Number.isInteger(pay)).toBe(true);
  });
});

describe("the return to the player", () => {
  it("is about 99% on the classic machine", () => {
    const back = threeReelReturn("classic");
    expect(back).toBeGreaterThanOrEqual(0.985);
    expect(back).toBeLessThanOrEqual(0.995);
  });

  it("is about 99% on the five-reel machine, counting all three lines", () => {
    const back = fiveReelReturn();
    expect(back).toBeGreaterThanOrEqual(0.985);
    expect(back).toBeLessThanOrEqual(0.995);
  });

  it("is about 99% on the lucky-seven machine", () => {
    const back = threeReelReturn("luckySeven");
    expect(back).toBeGreaterThanOrEqual(0.985);
    expect(back).toBeLessThanOrEqual(0.995);
  });

  it("pays a win often enough to be worth playing", () => {
    expect(hitRate("classic")).toBeGreaterThan(0.1);
    expect(hitRate("luckySeven")).toBeGreaterThan(0.1);
  });

  it("matches a long run of real spins on every machine", () => {
    const random = seededRandom(7);
    for (const kind of SLOT_KINDS) {
      const spins = 60_000;
      let paid = 0;
      for (let n = 0; n < spins; n += 1) paid += spinSlot(kind, 10, random).payout;
      const back = paid / (spins * 10);
      expect(back, kind).toBeGreaterThan(0.8);
      expect(back, kind).toBeLessThan(1.1);
    }
  });
});

describe("a payline", () => {
  const line = (...symbols: SlotSymbol[]) => symbols;

  it("pays three alike on the classic machine by the pay table, and two coins from the left", () => {
    for (const symbol of SLOT_SYMBOLS) {
      expect(lineWin("classic", line(symbol, symbol, symbol))).toEqual({ symbol, reels: [0, 1, 2], multiplier: CLASSIC_PAY[symbol] });
    }
    expect(lineWin("classic", line("coin", "coin", "bell"))).toEqual({ symbol: "coin", reels: [0, 1], multiplier: CLASSIC_COIN_PAIR });
    expect(lineWin("classic", line("coin", "bell", "coin"))).toBeUndefined();
    expect(lineWin("classic", line("bell", "coin", "coin"))).toBeUndefined();
    expect(lineWin("classic", line("seven", "seven", "bell"))).toBeUndefined();
  });

  it("pays a run of three or more from the left on the five-reel machine, and no other", () => {
    expect(lineWin("fiveReel", line("koi", "koi", "koi", "bell", "bell"))).toEqual({ symbol: "koi", reels: [0, 1, 2], multiplier: FIVE_REEL_PAY.koi[0] });
    expect(lineWin("fiveReel", line("koi", "koi", "koi", "koi", "bell"))).toEqual({ symbol: "koi", reels: [0, 1, 2, 3], multiplier: FIVE_REEL_PAY.koi[1] });
    expect(lineWin("fiveReel", line("koi", "koi", "koi", "koi", "koi"))).toEqual({ symbol: "koi", reels: [0, 1, 2, 3, 4], multiplier: FIVE_REEL_PAY.koi[2] });
    expect(lineWin("fiveReel", line("koi", "koi", "bell", "koi", "koi"))).toBeUndefined();
    expect(lineWin("fiveReel", line("bell", "koi", "koi", "koi", "koi"))).toBeUndefined();
    expect(lineWin("fiveReel", line("coin", "coin", "pouch", "pouch", "pouch"))).toBeUndefined();
  });

  it("pays three alike, any three bars, and sevens anywhere on the lucky-seven machine", () => {
    for (const symbol of SLOT_SYMBOLS) {
      expect(lineWin("luckySeven", line(symbol, symbol, symbol))).toEqual({ symbol, reels: [0, 1, 2], multiplier: LUCKY_SEVEN_PAY[symbol] });
    }
    expect(lineWin("luckySeven", line("bell", "lantern", "ingot"))?.multiplier).toBe(LUCKY_SEVEN_ANY_BAR);
    expect(lineWin("luckySeven", line("ingot", "ingot", "bell"))?.multiplier).toBe(LUCKY_SEVEN_ANY_BAR);
    expect(lineWin("luckySeven", line("bell", "seven", "lantern"))).toEqual({ symbol: "seven", reels: [1], multiplier: LUCKY_SEVEN_SCATTER[1] });
    expect(lineWin("luckySeven", line("seven", "koi", "seven"))).toEqual({ symbol: "seven", reels: [0, 2], multiplier: LUCKY_SEVEN_SCATTER[2] });
    expect(lineWin("luckySeven", line("coin", "pouch", "lotus"))).toBeUndefined();
    expect(lineWin("luckySeven", line("coin", "bell", "lantern"))).toBeUndefined();
  });

  it("reads the rows of the five-reel window from the top and numbers the lines the same way", () => {
    const grid = [
      ["coin", "pouch", "bell"],
      ["coin", "pouch", "bell"],
      ["coin", "pouch", "bell"],
      ["lotus", "lotus", "lotus"],
      ["lotus", "lotus", "lotus"],
    ] as SlotSymbol[][];
    expect(slotWins("fiveReel", grid)).toEqual([
      { line: 0, symbol: "coin", reels: [0, 1, 2], multiplier: FIVE_REEL_PAY.coin[0] },
      { line: 1, symbol: "pouch", reels: [0, 1, 2], multiplier: FIVE_REEL_PAY.pouch[0] },
      { line: 2, symbol: "bell", reels: [0, 1, 2], multiplier: FIVE_REEL_PAY.bell[0] },
    ]);
  });
});

describe("a spin", () => {
  it("shows the strip at the stops it drew and settles the stake and the payout", () => {
    const random = seededRandom(99);
    for (const kind of SLOT_KINDS) {
      const { reels, lines } = SLOT_LAYOUT[kind];
      const rows = Math.max(...lines) + 1;
      for (let n = 0; n < 300; n += 1) {
        const spin = spinSlot(kind, 20, random);
        expect(spin.kind).toBe(kind);
        expect(spin.stake).toBe(20);
        expect(spin.stops).toHaveLength(reels);
        expect(spin.grid).toHaveLength(reels);
        spin.stops.forEach((stop, reel) => {
          expect(Number.isInteger(stop) && stop >= 0 && stop < STRIP_LENGTH).toBe(true);
          expect(spin.grid[reel]).toHaveLength(rows);
          for (let row = 0; row < rows; row += 1) expect(spin.grid[reel]![row]).toBe(SLOT_STRIPS[kind][(stop + row) % STRIP_LENGTH]);
        });
        expect(spin.wins).toEqual(slotWins(kind, spin.grid));
        expect(spin.multiplier).toBe(spin.wins.reduce((sum, win) => sum + win.multiplier, 0));
        expect(spin.payout).toBe(20 * spin.multiplier);
        expect(Number.isInteger(spin.payout)).toBe(true);
      }
    }
  });

  it("draws one number per reel and takes the last stop for a draw that is nearly one", () => {
    let draws = 0;
    const counted = () => {
      draws += 1;
      return 0.999999;
    };
    const spin = spinSlot("fiveReel", 10, counted);
    expect(draws).toBe(5);
    expect(spin.stops).toEqual([31, 31, 31, 31, 31]);
    expect(spinSlot("classic", 10, () => 0).stops).toEqual([0, 0, 0]);
  });

  it("is the same spin for the same draws", () => {
    expect(spinSlot("classic", 50, seededRandom(4))).toEqual(spinSlot("classic", 50, seededRandom(4)));
  });
});

describe("the jackpot", () => {
  function stopOf(kind: SlotKind, symbol: SlotSymbol): number {
    return SLOT_STRIPS[kind].indexOf(symbol);
  }

  it("falls on three sevens on the classic machine", () => {
    const seven = stopOf("classic", "seven");
    const spin = spinSlot("classic", 10, cells([seven, seven, seven], STRIP_LENGTH));
    expect(spin.jackpot).toBe(true);
    expect(spin.multiplier).toBe(CLASSIC_PAY.seven);
    expect(spin.payout).toBe(10 * CLASSIC_PAY.seven);
  });

  it("falls on three sevens on the lucky-seven machine", () => {
    const seven = stopOf("luckySeven", "seven");
    const spin = spinSlot("luckySeven", 10, cells([seven, seven, seven], STRIP_LENGTH));
    expect(spin.jackpot).toBe(true);
    expect(spin.payout).toBe(10 * LUCKY_SEVEN_PAY.seven);
  });

  it("falls on a run of three sevens or more on the five-reel machine", () => {
    const seven = stopOf("fiveReel", "seven");
    const strip = SLOT_STRIPS.fiveReel;
    const other = strip.findIndex((symbol, at) => symbol !== "seven" && strip[(at + 1) % STRIP_LENGTH] !== "seven");
    const spin = spinSlot("fiveReel", 10, cells([seven, seven, seven, other, other], STRIP_LENGTH));
    expect(spin.jackpot).toBe(true);
    expect(spin.wins).toContainEqual({ line: 0, symbol: "seven", reels: [0, 1, 2], multiplier: FIVE_REEL_PAY.seven[0] });
  });

  it("does not fall on one or two sevens, nor on a big win without them", () => {
    const seven = stopOf("luckySeven", "seven");
    const coin = stopOf("luckySeven", "coin");
    const two = spinSlot("luckySeven", 10, cells([seven, coin, seven], STRIP_LENGTH));
    expect(two.wins.map((win) => win.multiplier)).toEqual([LUCKY_SEVEN_SCATTER[2]]);
    expect(two.jackpot).toBe(false);
    const ingot = stopOf("classic", "ingot");
    const big = spinSlot("classic", 10, cells([ingot, ingot, ingot], STRIP_LENGTH));
    expect(big.payout).toBe(10 * CLASSIC_PAY.ingot);
    expect(big.jackpot).toBe(false);
    const pair = spinSlot("classic", 10, cells([stopOf("classic", "coin"), stopOf("classic", "coin"), stopOf("classic", "seven")], STRIP_LENGTH));
    expect(pair.jackpot).toBe(false);
  });
});
