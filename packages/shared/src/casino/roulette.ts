import { drawIndex } from "./random.ts";
import { isBetAmount } from "./wallet.ts";

export const ROULETTE_POCKETS = 37;
export const ROULETTE_MAX_BETS = 12;
export const ROULETTE_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36] as const;
const RED: ReadonlySet<number> = new Set(ROULETTE_RED);

export type RouletteColor = "green" | "red" | "black";

export type RouletteBet =
  | { kind: "straight"; pick: number; amount: number }
  | { kind: "dozen"; pick: 1 | 2 | 3; amount: number }
  | { kind: "red" | "black" | "odd" | "even" | "low" | "high"; amount: number };

export type RouletteBetKind = RouletteBet["kind"];

// A winning bet is paid this many times its amount on top of getting it back.
export const ROULETTE_ODDS: Readonly<Record<RouletteBetKind, number>> = { straight: 35, dozen: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1 };

export interface RouletteBetResult {
  bet: RouletteBet;
  win: boolean;
  net: number;
}

export interface RouletteSpin {
  number: number;
  color: RouletteColor;
  results: RouletteBetResult[];
  stake: number;
  payout: number;
  net: number;
}

export function rouletteColor(pocket: number): RouletteColor {
  return pocket === 0 ? "green" : RED.has(pocket) ? "red" : "black";
}

export function validRouletteBet(bet: RouletteBet): boolean {
  if (!isBetAmount(bet.amount)) return false;
  if (bet.kind === "straight") return Number.isInteger(bet.pick) && bet.pick >= 0 && bet.pick < ROULETTE_POCKETS;
  if (bet.kind === "dozen") return bet.pick === 1 || bet.pick === 2 || bet.pick === 3;
  return true;
}

export function validRouletteBets(bets: readonly RouletteBet[]): boolean {
  return bets.length > 0 && bets.length <= ROULETTE_MAX_BETS && bets.every(validRouletteBet);
}

// Zero loses every bet except a straight bet on it.
export function rouletteWins(bet: RouletteBet, pocket: number): boolean {
  if (bet.kind === "straight") return bet.pick === pocket;
  if (pocket === 0) return false;
  switch (bet.kind) {
    case "dozen":
      return Math.ceil(pocket / 12) === bet.pick;
    case "red":
    case "black":
      return rouletteColor(pocket) === bet.kind;
    case "odd":
      return pocket % 2 === 1;
    case "even":
      return pocket % 2 === 0;
    case "low":
      return pocket <= 18;
    case "high":
      return pocket >= 19;
  }
}

export function settleRoulette(pocket: number, bets: readonly RouletteBet[]): RouletteSpin {
  const results = bets.map((bet) => {
    const win = rouletteWins(bet, pocket);
    return { bet, win, net: win ? bet.amount * ROULETTE_ODDS[bet.kind] : -bet.amount };
  });
  const stake = bets.reduce((sum, bet) => sum + bet.amount, 0);
  const net = results.reduce((sum, result) => sum + result.net, 0);
  return { number: pocket, color: rouletteColor(pocket), results, stake, payout: stake + net, net };
}

export function spinRoulette(bets: readonly RouletteBet[], random: () => number): RouletteSpin {
  return settleRoulette(drawIndex(random, ROULETTE_POCKETS), bets);
}
