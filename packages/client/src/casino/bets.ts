import { MAX_BET, ROULETTE_MAX_BETS, type RouletteBet, type Wallet, canBet, canStake, validRouletteBet } from "@dongjane/shared";

export const CHIPS = [10, 50, 100, 500] as const;

export function chipsFor(wallet: Wallet): number[] {
  return CHIPS.filter((chip) => canBet(wallet, chip));
}

// The chip the visitor picked, or the largest smaller one the balance still covers; 0 when not even the smallest is covered.
export function usableChip(selected: number, wallet: Wallet): number {
  const affordable = chipsFor(wallet);
  if (affordable.includes(selected)) return selected;
  return affordable.filter((chip) => chip < selected).pop() ?? affordable[0] ?? 0;
}

export type SlipTarget =
  | { kind: "straight"; pick: number }
  | { kind: "dozen"; pick: 1 | 2 | 3 }
  | { kind: "red" | "black" | "odd" | "even" | "low" | "high" };

export function targetKey(target: SlipTarget): string {
  return "pick" in target ? `${target.kind}:${target.pick}` : target.kind;
}

interface Placed {
  target: SlipTarget;
  amount: number;
}

// The chips laid on the table, in the order each place was first used. Every limit is the shared rules' own: a bet of 10 to 500,
// at most 12 places, and a total the balance covers.
export class RouletteSlip {
  private readonly places = new Map<string, Placed>();
  private readonly history: string[] = [];

  get bets(): RouletteBet[] {
    return [...this.places.values()].map(({ target, amount }) => ({ ...target, amount }) as RouletteBet);
  }

  get stake(): number {
    let sum = 0;
    for (const { amount } of this.places.values()) sum += amount;
    return sum;
  }

  get count(): number {
    return this.places.size;
  }

  get empty(): boolean {
    return this.places.size === 0;
  }

  amountOn(target: SlipTarget): number {
    return this.places.get(targetKey(target))?.amount ?? 0;
  }

  canAdd(target: SlipTarget, chip: number, wallet: Wallet): boolean {
    const key = targetKey(target);
    const total = this.amountOn(target) + chip;
    if (!this.places.has(key) && this.places.size >= ROULETTE_MAX_BETS) return false;
    if (total > MAX_BET) return false;
    return validRouletteBet({ ...target, amount: total } as RouletteBet) && canStake(wallet, this.stake + chip);
  }

  add(target: SlipTarget, chip: number, wallet: Wallet): boolean {
    if (!this.canAdd(target, chip, wallet)) return false;
    const key = targetKey(target);
    this.places.set(key, { target, amount: this.amountOn(target) + chip });
    this.history.push(`${key}|${chip}`);
    return true;
  }

  // Takes back the chip laid last.
  undo(): boolean {
    const last = this.history.pop();
    if (last === undefined) return false;
    const [key = "", chip = "0"] = last.split("|");
    const place = this.places.get(key);
    if (!place) return false;
    const left = place.amount - Number(chip);
    if (left > 0) this.places.set(key, { ...place, amount: left });
    else this.places.delete(key);
    return true;
  }

  clear(): void {
    this.places.clear();
    this.history.length = 0;
  }

  // After a spin the balance may no longer cover what stays on the table: take chips back, last first, until it does.
  fit(wallet: Wallet): void {
    while (!this.empty && !canStake(wallet, this.stake)) this.undo();
  }

  canSpin(wallet: Wallet): boolean {
    return !this.empty && this.bets.every(validRouletteBet) && canStake(wallet, this.stake);
  }
}
