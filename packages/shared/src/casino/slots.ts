import { drawIndex } from "./random.ts";

export const SLOT_SYMBOLS = ["coin", "pouch", "lotus", "koi", "bell", "lantern", "ingot", "seven"] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

export const SLOT_KINDS = ["classic", "fiveReel", "luckySeven"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

// A payline reads one row of the window from the left; the five-reel machine shows three rows and pays all of them.
export const SLOT_LAYOUT: Readonly<Record<SlotKind, { readonly reels: number; readonly lines: readonly number[] }>> = {
  classic: { reels: 3, lines: [0] },
  fiveReel: { reels: 5, lines: [0, 1, 2] },
  luckySeven: { reels: 3, lines: [0] },
};

// How many of each symbol (in SLOT_SYMBOLS order) a reel strip holds; every reel of a machine runs the same strip.
const STRIP_COUNTS: Readonly<Record<SlotKind, readonly number[]>> = {
  classic: [15, 7, 5, 1, 1, 1, 1, 1],
  fiveReel: [13, 9, 3, 3, 1, 1, 1, 1],
  luckySeven: [7, 3, 6, 5, 3, 2, 2, 4],
};

// Each symbol's copies sit evenly around the strip, each symbol a different distance round from the start.
function spreadStrip(counts: readonly number[]): readonly SlotSymbol[] {
  return counts
    .flatMap((count, symbol) => Array.from({ length: count }, (_, copy) => ({ symbol, at: (copy + ((symbol * 0.618034) % 1)) / count })))
    .sort((a, b) => a.at - b.at)
    .map(({ symbol }) => SLOT_SYMBOLS[symbol] as SlotSymbol);
}

export const SLOT_STRIPS: Readonly<Record<SlotKind, readonly SlotSymbol[]>> = {
  classic: spreadStrip(STRIP_COUNTS.classic),
  fiveReel: spreadStrip(STRIP_COUNTS.fiveReel),
  luckySeven: spreadStrip(STRIP_COUNTS.luckySeven),
};

// Every pay is a multiple of the bet, so a payout is always a whole number of coins.
export const CLASSIC_PAY: Readonly<Record<SlotSymbol, number>> = { coin: 5, pouch: 10, lotus: 25, koi: 60, bell: 100, lantern: 200, ingot: 300, seven: 700 };
export const CLASSIC_COIN_PAIR = 2;
// Three, four or five in a row from the left.
export const FIVE_REEL_PAY: Readonly<Record<SlotSymbol, readonly [number, number, number]>> = {
  coin: [1, 3, 10],
  pouch: [2, 7, 30],
  lotus: [3, 10, 50],
  koi: [5, 20, 100],
  bell: [10, 40, 200],
  lantern: [20, 80, 400],
  ingot: [40, 150, 800],
  seven: [100, 400, 2000],
};
export const LUCKY_SEVEN_PAY: Readonly<Record<SlotSymbol, number>> = { coin: 5, pouch: 10, lotus: 15, koi: 40, bell: 50, lantern: 80, ingot: 120, seven: 77 };
const LUCKY_SEVEN_BARS: readonly SlotSymbol[] = ["bell", "lantern", "ingot"];
export const LUCKY_SEVEN_ANY_BAR = 3;
// One or two sevens anywhere on the line, by how many.
export const LUCKY_SEVEN_SCATTER = [0, 1, 3] as const;

export interface LineWin {
  symbol: SlotSymbol;
  reels: number[];
  multiplier: number;
}

export interface SlotWin extends LineWin {
  line: number;
}

export interface SlotSpin {
  kind: SlotKind;
  stake: number;
  stops: number[];
  grid: SlotSymbol[][];
  wins: SlotWin[];
  multiplier: number;
  payout: number;
  jackpot: boolean;
}

export function lineWin(kind: SlotKind, line: readonly SlotSymbol[]): LineWin | undefined {
  const first = line[0] as SlotSymbol;
  const all = line.map((_, reel) => reel);
  const same = line.every((symbol) => symbol === first);
  if (kind === "fiveReel") {
    let run = 1;
    while (run < line.length && line[run] === first) run += 1;
    return run >= 3 ? { symbol: first, reels: all.slice(0, run), multiplier: FIVE_REEL_PAY[first][run - 3] as number } : undefined;
  }
  if (kind === "classic") {
    if (same) return { symbol: first, reels: all, multiplier: CLASSIC_PAY[first] };
    return first === "coin" && line[1] === "coin" ? { symbol: "coin", reels: [0, 1], multiplier: CLASSIC_COIN_PAIR } : undefined;
  }
  if (same) return { symbol: first, reels: all, multiplier: LUCKY_SEVEN_PAY[first] };
  if (line.every((symbol) => LUCKY_SEVEN_BARS.includes(symbol))) return { symbol: first, reels: all, multiplier: LUCKY_SEVEN_ANY_BAR };
  const sevens = all.filter((reel) => line[reel] === "seven");
  return sevens.length > 0 ? { symbol: "seven", reels: sevens, multiplier: LUCKY_SEVEN_SCATTER[sevens.length] as number } : undefined;
}

// `grid[reel][row]` is the window, top row first.
export function slotWins(kind: SlotKind, grid: readonly (readonly SlotSymbol[])[]): SlotWin[] {
  return SLOT_LAYOUT[kind].lines.flatMap((row, line) => {
    const win = lineWin(kind, grid.map((reel) => reel[row] as SlotSymbol));
    return win ? [{ ...win, line }] : [];
  });
}

export function spinSlot(kind: SlotKind, bet: number, random: () => number): SlotSpin {
  const strip = SLOT_STRIPS[kind];
  const rows = Math.max(...SLOT_LAYOUT[kind].lines) + 1;
  const stops = Array.from({ length: SLOT_LAYOUT[kind].reels }, () => drawIndex(random, strip.length));
  const grid = stops.map((stop) => Array.from({ length: rows }, (_, row) => strip[(stop + row) % strip.length] as SlotSymbol));
  const wins = slotWins(kind, grid);
  const multiplier = wins.reduce((sum, win) => sum + win.multiplier, 0);
  const jackpot = wins.some((win) => win.symbol === "seven" && win.reels.length >= 3);
  return { kind, stake: bet, stops, grid, wins, multiplier, payout: bet * multiplier, jackpot };
}
