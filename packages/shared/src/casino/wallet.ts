import { questDay } from "../quest.ts";

export const START_BALANCE = 1000;
export const MIN_BET = 10;
export const MAX_BET = 500;
export const REFILL_BELOW = 100;

// What the client keeps between visits; `refillDay` is the KST day (as questDay counts them) of the last refill.
export interface Wallet {
  balance: number;
  refillDay: number;
}

export interface Settlement {
  stake: number;
  payout: number;
}

export function newWallet(nowMs: number): Wallet {
  return { balance: START_BALANCE, refillDay: questDay(nowMs) };
}

export function parseWallet(value: unknown): Wallet | null {
  if (typeof value !== "object" || value === null) return null;
  const { balance, refillDay } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(refillDay) || (balance as number) < 0) return null;
  return { balance: balance as number, refillDay: refillDay as number };
}

export function isBetAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= MIN_BET && amount <= MAX_BET;
}

export function canBet(wallet: Wallet, amount: number): boolean {
  return isBetAmount(amount) && amount <= wallet.balance;
}

// A game that takes several bets at once (roulette) debits their sum, which must be covered by the balance.
export function canStake(wallet: Wallet, stake: number): boolean {
  return Number.isInteger(stake) && stake > 0 && stake <= wallet.balance;
}

export function applyResult(wallet: Wallet, { stake, payout }: Settlement): Wallet {
  return { ...wallet, balance: wallet.balance - stake + payout };
}

// The refill is due on a KST day other than the last refill's, and only for a visitor who is nearly out of coins.
export function refillDaily(wallet: Wallet, nowMs: number): Wallet {
  const day = questDay(nowMs);
  if (day === wallet.refillDay || wallet.balance >= REFILL_BELOW) return wallet;
  return { balance: START_BALANCE, refillDay: day };
}
