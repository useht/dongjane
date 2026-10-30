import { drawIndex } from "./random.ts";
import { SLOT_SYMBOLS, type SlotSymbol } from "./slots.ts";

// The nine cells in reading order; any row, column or diagonal of three alike wins.
export const SCRATCH_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

// A card wins the prize of its symbol with `weight` chances in SCRATCH_WEIGHT, and loses with the rest.
export const SCRATCH_WEIGHT = 10_000;
export const SCRATCH_PRIZES: readonly { symbol: SlotSymbol; multiplier: number; weight: number }[] = [
  { symbol: "coin", multiplier: 2, weight: 1400 },
  { symbol: "pouch", multiplier: 3, weight: 700 },
  { symbol: "lotus", multiplier: 5, weight: 360 },
  { symbol: "koi", multiplier: 10, weight: 110 },
  { symbol: "bell", multiplier: 20, weight: 30 },
  { symbol: "lantern", multiplier: 50, weight: 8 },
  { symbol: "ingot", multiplier: 100, weight: 2 },
  { symbol: "seven", multiplier: 500, weight: 1 },
];

// The outcome is settled when the card is bought; the grid is only drawn to match it and the client scratches it away.
export interface ScratchCard {
  stake: number;
  grid: SlotSymbol[];
  line: readonly number[] | null;
  symbol: SlotSymbol | null;
  multiplier: number;
  payout: number;
}

export function scratchWins(grid: readonly SlotSymbol[]): { line: readonly number[]; symbol: SlotSymbol }[] {
  return SCRATCH_LINES.flatMap((line) => {
    const symbol = grid[line[0]] as SlotSymbol;
    return line.every((cell) => grid[cell] === symbol) ? [{ line, symbol }] : [];
  });
}

// Fills the empty cells in order with any symbol that would not make a line of three alike.
function fill(cells: (SlotSymbol | undefined)[], random: () => number): SlotSymbol[] {
  cells.forEach((cell, index) => {
    if (cell) return;
    const blocked = new Set<SlotSymbol>();
    for (const line of SCRATCH_LINES) {
      if (!line.includes(index)) continue;
      const [a, b] = line.filter((other) => other !== index).map((other) => cells[other]);
      if (a && a === b) blocked.add(a);
    }
    const open = SLOT_SYMBOLS.filter((symbol) => !blocked.has(symbol));
    cells[index] = open[drawIndex(random, open.length)];
  });
  return cells as SlotSymbol[];
}

export function drawScratch(bet: number, random: () => number): ScratchCard {
  let ticket = drawIndex(random, SCRATCH_WEIGHT);
  let prize: (typeof SCRATCH_PRIZES)[number] | undefined;
  for (const candidate of SCRATCH_PRIZES) {
    if (ticket < candidate.weight) {
      prize = candidate;
      break;
    }
    ticket -= candidate.weight;
  }
  const cells: (SlotSymbol | undefined)[] = Array.from({ length: 9 }, () => undefined);
  const line = prize ? (SCRATCH_LINES[drawIndex(random, SCRATCH_LINES.length)] as readonly number[]) : null;
  if (prize && line) for (const cell of line) cells[cell] = prize.symbol;
  const multiplier = prize?.multiplier ?? 0;
  return { stake: bet, grid: fill(cells, random), line, symbol: prize?.symbol ?? null, multiplier, payout: bet * multiplier };
}
