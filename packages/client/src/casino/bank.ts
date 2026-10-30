import { type Settlement, type Wallet, canBet, canStake, applyResult, newWallet, refillDaily } from "@dongjane/shared";

// What the bank needs of storage: the wallet's last saved state, and a way to save the next.
export interface WalletStore {
  load(): Wallet | null;
  save(wallet: Wallet): void;
}

// Why the balance jumped when nobody played: a first visit's welcome, or the day's refill for a visitor who ran out.
export type BankNotice = "welcome" | "refill";

// The visitor's coins. Only the shared rules change the balance (`applyResult`, `refillDaily`); this keeps the wallet, saves it each
// time it changes and remembers whether the visitor is owed an explanation. A game is settled the moment it starts, so leaving
// halfway (or reloading) can never undo a loss.
export class CasinoBank {
  private current: Wallet;
  private pending: BankNotice | null = null;

  constructor(
    private readonly store: WalletStore,
    private readonly now: () => number,
  ) {
    const saved = store.load();
    const nowMs = now();
    if (saved) {
      this.current = refillDaily(saved, nowMs);
      if (this.current !== saved) this.pending = "refill";
    } else {
      this.current = newWallet(nowMs);
      this.pending = "welcome";
    }
    if (this.current !== saved) store.save(this.current);
  }

  get wallet(): Wallet {
    return this.current;
  }

  get balance(): number {
    return this.current.balance;
  }

  // The refill is due on the first KST day after the last one: someone who leaves the panel open past midnight gets it too.
  refresh(): void {
    const next = refillDaily(this.current, this.now());
    if (next === this.current) return;
    this.current = next;
    this.pending = "refill";
    this.store.save(next);
  }

  // The notice is handed over once, then cleared.
  takeNotice(): BankNotice | null {
    const notice = this.pending;
    this.pending = null;
    return notice;
  }

  canBet(amount: number): boolean {
    return canBet(this.current, amount);
  }

  canStake(stake: number): boolean {
    return canStake(this.current, stake);
  }

  // Debits the stake and pays the payout in one step. A stake the balance cannot cover is refused and changes nothing.
  settle(result: Settlement): boolean {
    if (!this.canStake(result.stake)) return false;
    this.current = applyResult(this.current, result);
    this.store.save(this.current);
    return true;
  }
}
