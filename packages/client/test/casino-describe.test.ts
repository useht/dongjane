import { describe, expect, it } from "vitest";
import { SCRATCH_LINES, SLOT_SYMBOLS, type SlotSpin, type SlotSymbol, slotWins } from "@dongjane/shared";
import {
  MACHINE_TITLES,
  SYMBOL_NAMES,
  describeScratch,
  describeSlotSpin,
  formatCoins,
  formatNet,
  rouletteLabel,
  rouletteMultiplier,
  scratchLineName,
} from "../src/casino/describe.ts";

function spinOf(kind: SlotSpin["kind"], grid: SlotSymbol[][], stake = 10): SlotSpin {
  const wins = slotWins(kind, grid);
  const multiplier = wins.reduce((sum, win) => sum + win.multiplier, 0);
  const jackpot = wins.some((win) => win.symbol === "seven" && win.reels.length >= 3);
  return { kind, stake, stops: grid.map(() => 0), grid, wins, multiplier, payout: stake * multiplier, jackpot };
}

describe("coins", () => {
  it("writes amounts with a thousands separator", () => {
    expect(formatCoins(1000)).toBe("1,000 엽전");
    expect(formatCoins(10)).toBe("10 엽전");
  });

  it("writes a net result with its sign, or 본전", () => {
    expect(formatNet(90)).toBe("+90 엽전");
    expect(formatNet(-1500)).toBe("−1,500 엽전");
    expect(formatNet(0)).toBe("본전");
  });
});

describe("names", () => {
  it("names every symbol and machine", () => {
    for (const symbol of SLOT_SYMBOLS) expect(SYMBOL_NAMES[symbol].length).toBeGreaterThan(0);
    expect(MACHINE_TITLES.roulette).toBe("룰렛");
    expect(new Set(Object.values(MACHINE_TITLES)).size).toBe(5);
  });

  it("labels the roulette places and their pay", () => {
    expect(rouletteLabel({ kind: "red" })).toBe("빨강");
    expect(rouletteLabel({ kind: "dozen", pick: 2 })).toBe("13–24");
    expect(rouletteLabel({ kind: "straight", pick: 17 })).toBe("17번");
    expect(rouletteMultiplier({ kind: "red" })).toBe(2);
    expect(rouletteMultiplier({ kind: "dozen", pick: 1 })).toBe(3);
    expect(rouletteMultiplier({ kind: "straight", pick: 0 })).toBe(36);
  });

  it("names every scratch line", () => {
    const names = SCRATCH_LINES.map(scratchLineName);
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(SCRATCH_LINES.length);
  });
});

describe("slot results", () => {
  it("says a lost spin lost", () => {
    const spin = spinOf("classic", [["coin"], ["lotus"], ["koi"]]);
    expect(describeSlotSpin(spin)).toEqual({ headline: "아쉬워요, 꽝", lines: [] });
  });

  it("describes three alike and a coin pair on the classic machine", () => {
    const three = describeSlotSpin(spinOf("classic", [["pouch"], ["pouch"], ["pouch"]]));
    expect(three.headline).toBe("당첨! +90 엽전");
    expect(three.lines).toEqual(["복주머니 3개 · ×10"]);
    const pair = describeSlotSpin(spinOf("classic", [["coin"], ["coin"], ["bell"]]));
    expect(pair.lines).toEqual(["동전 왼쪽부터 2개 · ×2"]);
  });

  it("names the line on the five-reel machine, and calls out only the lines that paid", () => {
    const spin = spinOf("fiveReel", [
      ["koi", "coin", "bell"],
      ["koi", "pouch", "bell"],
      ["koi", "lotus", "bell"],
      ["lantern", "koi", "bell"],
      ["ingot", "seven", "bell"],
    ]);
    expect(spin.wins.map((win) => win.line)).toEqual([0, 2]);
    expect(describeSlotSpin(spin).lines).toEqual(["1번 줄 · 잉어 왼쪽부터 3개 · ×5", "3번 줄 · 풍경 5개 · ×200"]);
  });

  it("describes the lucky-seven bars and the sevens", () => {
    const bars = describeSlotSpin(spinOf("luckySeven", [["bell"], ["ingot"], ["lantern"]]));
    expect(bars.lines).toEqual(["풍경·등·금괴 아무 조합 · ×3"]);
    const one = describeSlotSpin(spinOf("luckySeven", [["coin"], ["seven"], ["koi"]]));
    expect(one.lines).toEqual(["행운의 7 1개 · ×1"]);
    const two = describeSlotSpin(spinOf("luckySeven", [["seven"], ["coin"], ["seven"]]));
    expect(two.lines).toEqual(["행운의 7 2개 · ×3"]);
    const three = spinOf("luckySeven", [["seven"], ["seven"], ["seven"]]);
    expect(three.jackpot).toBe(true);
    expect(describeSlotSpin(three).headline).toBe("잭팟! +760 엽전");
    expect(describeSlotSpin(three).lines).toEqual(["행운의 7 3개 · ×77"]);
  });
});

describe("scratch results", () => {
  it("says a losing card lost", () => {
    expect(describeScratch({ stake: 10, grid: [], line: null, symbol: null, multiplier: 0, payout: 0 })).toEqual({ headline: "아쉬워요, 꽝", detail: "" });
  });

  it("names the line and the symbol of a winning card", () => {
    const won = describeScratch({ stake: 100, grid: [], line: [3, 4, 5], symbol: "koi", multiplier: 10, payout: 1000 });
    expect(won.headline).toBe("당첨! +900 엽전");
    expect(won.detail).toBe("가운데 줄에 잉어 3개 · ×10");
  });
});
