import {
  BOW_REWARD_DAILY_CAP,
  NO_BOW_REWARD,
  type Settlement,
  type Wallet,
  applyResult,
  canBet,
  canStake,
  newWallet,
  payBows,
  refillDaily,
} from "@dongjane/shared";

// What the bank needs of storage: the wallet's last saved state, and a way to save the next.
export interface WalletStore {
  load(): Wallet | null;
  save(wallet: Wallet): void;
}

// Why the balance jumped when nobody played: a first visit's welcome, or the day's refill for a visitor who ran out.
export type BankNotice = "welcome" | "refill";

// What bows paid on this call, and whether that brought the day's total to its cap.
export interface BowPay {
  paid: number;
  capped: boolean;
}

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

  // Pays the visitor for bows completed just now (see payBows). A refill that is already due comes first, so the coins cannot lift
  // a nearly empty visitor over the refill line and cost them the day's refill.
  rewardBows(bows: number): BowPay {
    this.refresh();
    const before = this.current.bowReward ?? NO_BOW_REWARD;
    const { paid, state } = payBows(before, bows, this.now());
    if (state === before) return { paid: 0, capped: false };
    this.current = { ...applyResult(this.current, { stake: 0, payout: paid }), bowReward: state };
    this.store.save(this.current);
    return { paid, capped: paid > 0 && state.earned >= BOW_REWARD_DAILY_CAP };
  }
}
