import { afterEach, describe, expect, it, vi } from "vitest";
import { START_BALANCE, questDay } from "@dongjane/shared";
import { CasinoBank, type WalletStore } from "../src/casino/bank.ts";
import { loadWallet, saveWallet } from "../src/storage.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOON = Date.UTC(2026, 4, 12, 3, 0, 0);

function memoryStore(initial: { balance: number; refillDay: number } | null): WalletStore & { saved: unknown[] } {
  let wallet = initial;
  const saved: unknown[] = [];
  return {
    saved,
    load: () => wallet,
    save: (next) => {
      wallet = next;
      saved.push(next);
    },
  };
}

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  return store;
}

describe("wallet storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with no wallet", () => {
    stubStorage();
    expect(loadWallet()).toBeNull();
  });

  it("reads back what it wrote, under a versioned key", () => {
    const store = stubStorage();
    saveWallet({ balance: 640, refillDay: 20_600 });
    expect([...store.keys()]).toEqual(["dongjane:casino:v1"]);
    expect(JSON.parse(store.get("dongjane:casino:v1") ?? "")).toEqual({ version: 1, balance: 640, refillDay: 20_600 });
    expect(loadWallet()).toEqual({ balance: 640, refillDay: 20_600 });
  });

  it("ignores a record of another version", () => {
    stubStorage({ "dongjane:casino:v1": JSON.stringify({ version: 2, balance: 640, refillDay: 20_600 }) });
    expect(loadWallet()).toBeNull();
  });

  it("ignores a record without a version", () => {
    stubStorage({ "dongjane:casino:v1": JSON.stringify({ balance: 640, refillDay: 20_600 }) });
    expect(loadWallet()).toBeNull();
  });

  it("ignores a damaged record", () => {
    stubStorage({ "dongjane:casino:v1": "{not json" });
    expect(loadWallet()).toBeNull();
    stubStorage({ "dongjane:casino:v1": JSON.stringify({ version: 1, balance: -5, refillDay: 3 }) });
    expect(loadWallet()).toBeNull();
    stubStorage({ "dongjane:casino:v1": JSON.stringify({ version: 1, balance: "lots", refillDay: 3 }) });
    expect(loadWallet()).toBeNull();
  });

  it("does not throw when storage refuses to save", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => saveWallet({ balance: 1, refillDay: 1 })).not.toThrow();
  });
});

describe("CasinoBank", () => {
  it("gives a first visitor the starting balance, says so once and saves it", () => {
    const store = memoryStore(null);
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.balance).toBe(START_BALANCE);
    expect(store.saved).toEqual([{ balance: START_BALANCE, refillDay: questDay(NOON) }]);
    expect(bank.takeNotice()).toBe("welcome");
    expect(bank.takeNotice()).toBeNull();
  });

  it("keeps a returning visitor's balance without a notice or a write", () => {
    const store = memoryStore({ balance: 420, refillDay: questDay(NOON) - 3 });
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.balance).toBe(420);
    expect(bank.takeNotice()).toBeNull();
    expect(store.saved).toEqual([]);
  });

  it("refills a visitor who is nearly out of coins on a new day, and says so", () => {
    const store = memoryStore({ balance: 40, refillDay: questDay(NOON) - 1 });
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.balance).toBe(START_BALANCE);
    expect(bank.wallet.refillDay).toBe(questDay(NOON));
    expect(bank.takeNotice()).toBe("refill");
    expect(store.saved).toHaveLength(1);
  });

  it("does not refill twice on one day", () => {
    const store = memoryStore({ balance: 40, refillDay: questDay(NOON) });
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.balance).toBe(40);
    expect(bank.takeNotice()).toBeNull();
  });

  it("refills a panel left open past midnight KST when the visitor has run out", () => {
    let now = NOON;
    const store = memoryStore({ balance: 400, refillDay: questDay(NOON) });
    const bank = new CasinoBank(store, () => now);
    expect(bank.settle({ stake: 350, payout: 0 })).toBe(true);
    bank.refresh();
    expect(bank.balance).toBe(50);
    now += DAY;
    bank.refresh();
    expect(bank.balance).toBe(START_BALANCE);
    expect(bank.takeNotice()).toBe("refill");
  });

  it("settles a game by debiting the stake and paying the payout, and saves each result", () => {
    const store = memoryStore({ balance: 1000, refillDay: questDay(NOON) });
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.settle({ stake: 100, payout: 0 })).toBe(true);
    expect(bank.balance).toBe(900);
    expect(bank.settle({ stake: 50, payout: 200 })).toBe(true);
    expect(bank.balance).toBe(1050);
    expect(store.saved).toEqual([
      { balance: 900, refillDay: questDay(NOON) },
      { balance: 1050, refillDay: questDay(NOON) },
    ]);
  });

  it("refuses a stake the balance cannot cover and changes nothing", () => {
    const store = memoryStore({ balance: 60, refillDay: questDay(NOON) });
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.settle({ stake: 100, payout: 500 })).toBe(false);
    expect(bank.settle({ stake: 0, payout: 500 })).toBe(false);
    expect(bank.balance).toBe(60);
    expect(store.saved).toEqual([]);
  });

  it("applies the shared bet limits", () => {
    const bank = new CasinoBank(memoryStore({ balance: 120, refillDay: questDay(NOON) }), () => NOON);
    expect(bank.canBet(10)).toBe(true);
    expect(bank.canBet(100)).toBe(true);
    expect(bank.canBet(500)).toBe(false);
    expect(bank.canBet(5)).toBe(false);
    expect(bank.canStake(120)).toBe(true);
    expect(bank.canStake(121)).toBe(false);
  });

  it("survives a reload: a new bank over the same storage sees the settled balance", () => {
    stubStorage();
    const store: WalletStore = { load: loadWallet, save: saveWallet };
    const first = new CasinoBank(store, () => NOON);
    first.settle({ stake: 300, payout: 0 });
    const second = new CasinoBank(store, () => NOON);
    expect(second.balance).toBe(START_BALANCE - 300);
    expect(second.takeNotice()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps a win that was settled before a reload, once, however often the page reloads", () => {
    stubStorage();
    const store: WalletStore = { load: loadWallet, save: saveWallet };
    new CasinoBank(store, () => NOON).settle({ stake: 10, payout: 100 });
    expect(new CasinoBank(store, () => NOON).balance).toBe(START_BALANCE + 90);
    expect(new CasinoBank(store, () => NOON).balance).toBe(START_BALANCE + 90);
    vi.unstubAllGlobals();
  });
});
