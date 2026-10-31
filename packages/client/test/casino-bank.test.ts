import { afterEach, describe, expect, it, vi } from "vitest";
import { BOW_REWARD, BOW_REWARD_COOLDOWN_MS, BOW_REWARD_DAILY_CAP, START_BALANCE, type Wallet, questDay } from "@dongjane/shared";
import { CasinoBank, type WalletStore } from "../src/casino/bank.ts";
import { loadWallet, saveWallet } from "../src/storage.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOON = Date.UTC(2026, 4, 12, 3, 0, 0);

function memoryStore(initial: Wallet | null): WalletStore & { saved: unknown[] } {
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

  it("stores what the bows have paid in the same record, and reads it back", () => {
    const store = stubStorage();
    const bowReward = { day: 20_600, earned: 12, lastAt: NOON };
    saveWallet({ balance: 640, refillDay: 20_600, bowReward });
    expect([...store.keys()]).toEqual(["dongjane:casino:v1"]);
    expect(JSON.parse(store.get("dongjane:casino:v1") ?? "")).toEqual({ version: 1, balance: 640, refillDay: 20_600, bowReward });
    expect(loadWallet()).toEqual({ balance: 640, refillDay: 20_600, bowReward });
  });

  it("still loads a record saved before the bows paid: nothing earned yet", () => {
    stubStorage({ "dongjane:casino:v1": JSON.stringify({ version: 1, balance: 640, refillDay: 20_600 }) });
    expect(loadWallet()).toEqual({ balance: 640, refillDay: 20_600 });
  });

  it("keeps the balance when only the bow record is damaged", () => {
    stubStorage({ "dongjane:casino:v1": JSON.stringify({ version: 1, balance: 640, refillDay: 20_600, bowReward: { day: "today", earned: 4 } }) });
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

describe("CasinoBank bow rewards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const today = questDay(NOON);
  const SPACING = BOW_REWARD_COOLDOWN_MS;

  it("credits a bow's reward without a stake and saves it with the day's count", () => {
    const store = memoryStore({ balance: 420, refillDay: today });
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.rewardBows(1)).toEqual({ paid: BOW_REWARD, capped: false });
    expect(bank.balance).toBe(420 + BOW_REWARD);
    expect(bank.wallet.bowReward).toEqual({ day: today, earned: BOW_REWARD, lastAt: NOON });
    expect(store.saved).toEqual([{ balance: 422, refillDay: today, bowReward: { day: today, earned: 2, lastAt: NOON } }]);
    expect(bank.takeNotice()).toBeNull();
  });

  it("pays a bow inside the cooldown nothing, and writes nothing", () => {
    let now = NOON;
    const store = memoryStore({ balance: 420, refillDay: today });
    const bank = new CasinoBank(store, () => now);
    bank.rewardBows(1);
    now += SPACING - 1;
    expect(bank.rewardBows(1)).toEqual({ paid: 0, capped: false });
    expect(bank.balance).toBe(422);
    expect(store.saved).toHaveLength(1);
    now += 1;
    expect(bank.rewardBows(1).paid).toBe(BOW_REWARD);
    expect(bank.balance).toBe(424);
  });

  it("pays bows seen together once", () => {
    const bank = new CasinoBank(memoryStore({ balance: 420, refillDay: today }), () => NOON);
    expect(bank.rewardBows(3).paid).toBe(BOW_REWARD);
    expect(bank.balance).toBe(422);
    expect(bank.rewardBows(0).paid).toBe(0);
  });

  it("stops at the day's cap, and says so on the payment that reaches it", () => {
    let now = NOON;
    const store = memoryStore({ balance: 420, refillDay: today });
    const bank = new CasinoBank(store, () => now);
    const payments = BOW_REWARD_DAILY_CAP / BOW_REWARD;
    for (let bow = 1; bow <= payments; bow += 1) {
      now += SPACING;
      expect(bank.rewardBows(1)).toEqual({ paid: BOW_REWARD, capped: bow === payments });
    }
    expect(bank.balance).toBe(420 + BOW_REWARD_DAILY_CAP);
    now += SPACING;
    expect(bank.rewardBows(1)).toEqual({ paid: 0, capped: false });
    expect(bank.balance).toBe(420 + BOW_REWARD_DAILY_CAP);
    expect(store.saved).toHaveLength(payments);
  });

  it("keeps the cap through a reload", () => {
    stubStorage();
    const store: WalletStore = { load: loadWallet, save: saveWallet };
    let now = NOON;
    const first = new CasinoBank(store, () => now);
    for (let bow = 1; bow <= BOW_REWARD_DAILY_CAP / BOW_REWARD; bow += 1) {
      now += SPACING;
      first.rewardBows(1);
    }
    expect(first.balance).toBe(START_BALANCE + BOW_REWARD_DAILY_CAP);
    now += SPACING;
    const second = new CasinoBank(store, () => now);
    expect(second.balance).toBe(START_BALANCE + BOW_REWARD_DAILY_CAP);
    expect(second.rewardBows(1).paid).toBe(0);
    expect(new CasinoBank(store, () => now).balance).toBe(START_BALANCE + BOW_REWARD_DAILY_CAP);
  });

  it("keeps the cooldown through a reload too", () => {
    stubStorage();
    const store: WalletStore = { load: loadWallet, save: saveWallet };
    new CasinoBank(store, () => NOON).rewardBows(1);
    const reloaded = new CasinoBank(store, () => NOON + SPACING - 1);
    expect(reloaded.rewardBows(1).paid).toBe(0);
    expect(new CasinoBank(store, () => NOON + SPACING).rewardBows(1).paid).toBe(BOW_REWARD);
  });

  it("starts the day's count again on a new KST day", () => {
    let now = Date.UTC(2026, 4, 12, 14, 59, 0);
    const store = memoryStore({
      balance: 420,
      refillDay: questDay(now),
      bowReward: { day: questDay(now), earned: BOW_REWARD_DAILY_CAP, lastAt: now - 60_000 },
    });
    const bank = new CasinoBank(store, () => now);
    expect(bank.rewardBows(1).paid).toBe(0);
    now = Date.UTC(2026, 4, 12, 15, 0, 0);
    expect(bank.rewardBows(1)).toEqual({ paid: BOW_REWARD, capped: false });
    expect(bank.wallet.bowReward).toEqual({ day: questDay(now), earned: BOW_REWARD, lastAt: now });
    expect(bank.balance).toBe(420 + BOW_REWARD);
  });

  it("pays a first visitor on top of the welcome, which is still told once", () => {
    const store = memoryStore(null);
    const bank = new CasinoBank(store, () => NOON);
    expect(bank.rewardBows(1).paid).toBe(BOW_REWARD);
    expect(bank.balance).toBe(START_BALANCE + BOW_REWARD);
    expect(store.saved).toEqual([
      { balance: START_BALANCE, refillDay: today },
      { balance: START_BALANCE + BOW_REWARD, refillDay: today, bowReward: { day: today, earned: BOW_REWARD, lastAt: NOON } },
    ]);
    expect(bank.takeNotice()).toBe("welcome");
    expect(bank.takeNotice()).toBeNull();
    const again = new CasinoBank(store, () => NOON);
    expect(again.balance).toBe(START_BALANCE + BOW_REWARD);
    expect(again.takeNotice()).toBeNull();
  });

  it("pays a refill that is due before the reward, so 98 coins plus a bow cannot skip the refill (page open past midnight)", () => {
    let now = NOON;
    const bank = new CasinoBank(memoryStore({ balance: 98, refillDay: today }), () => now);
    now += DAY;
    expect(bank.rewardBows(1).paid).toBe(BOW_REWARD);
    expect(bank.balance).toBe(START_BALANCE + BOW_REWARD);
    expect(bank.takeNotice()).toBe("refill");
  });

  it("leaves the stake rules alone: a game settles on the rewarded balance", () => {
    const bank = new CasinoBank(memoryStore({ balance: 100, refillDay: today }), () => NOON);
    bank.rewardBows(1);
    expect(bank.canBet(102)).toBe(true);
    expect(bank.settle({ stake: 102, payout: 0 })).toBe(true);
    expect(bank.balance).toBe(0);
    expect(bank.wallet.bowReward?.earned).toBe(BOW_REWARD);
  });
});
