import { describe, expect, it } from "vitest";
import {
  ROULETTE_MAX_BETS,
  ROULETTE_ODDS,
  ROULETTE_POCKETS,
  ROULETTE_RED,
  type RouletteBet,
  type RouletteBetKind,
  rouletteColor,
  rouletteWins,
  settleRoulette,
  spinRoulette,
  validRouletteBet,
  validRouletteBets,
} from "../src/casino/roulette.ts";
import { cells } from "./seeded.ts";

const POCKETS = Array.from({ length: ROULETTE_POCKETS }, (_, pocket) => pocket);

const EVEN_MONEY: Exclude<RouletteBetKind, "straight" | "dozen">[] = ["red", "black", "odd", "even", "low", "high"];

function everyBet(amount: number): RouletteBet[] {
  return [
    ...POCKETS.map((pick): RouletteBet => ({ kind: "straight", pick, amount })),
    ...([1, 2, 3] as const).map((pick): RouletteBet => ({ kind: "dozen", pick, amount })),
    ...EVEN_MONEY.map((kind): RouletteBet => ({ kind, amount })),
  ];
}

describe("the wheel", () => {
  it("has the 37 pockets of a European wheel: a green zero, eighteen reds and eighteen blacks", () => {
    expect(ROULETTE_POCKETS).toBe(37);
    expect(ROULETTE_RED).toHaveLength(18);
    expect(new Set(ROULETTE_RED).size).toBe(18);
    expect(rouletteColor(0)).toBe("green");
    expect(POCKETS.filter((pocket) => rouletteColor(pocket) === "red")).toEqual([...ROULETTE_RED]);
    expect(POCKETS.filter((pocket) => rouletteColor(pocket) === "black")).toHaveLength(18);
    expect([1, 2, 3, 36].map(rouletteColor)).toEqual(["red", "black", "red", "red"]);
  });

  it("pays the odds of the table: 35 to 1 straight, 2 to 1 on a dozen and even money on the rest", () => {
    expect(ROULETTE_ODDS.straight).toBe(35);
    expect(ROULETTE_ODDS.dozen).toBe(2);
    for (const kind of EVEN_MONEY) expect(ROULETTE_ODDS[kind]).toBe(1);
  });
});

describe("which bets win", () => {
  const winning = (bet: (pocket: number) => RouletteBet) => POCKETS.filter((pocket) => rouletteWins(bet(pocket), pocket));
  const among = (bet: RouletteBet) => POCKETS.filter((pocket) => rouletteWins(bet, pocket));

  it("pays a straight bet on its own number alone, zero included", () => {
    for (const pick of POCKETS) expect(among({ kind: "straight", pick, amount: 10 })).toEqual([pick]);
    expect(winning((pocket) => ({ kind: "straight", pick: pocket, amount: 10 }))).toEqual(POCKETS);
  });

  it("pays a dozen on its twelve numbers", () => {
    expect(among({ kind: "dozen", pick: 1, amount: 10 })).toEqual(POCKETS.slice(1, 13));
    expect(among({ kind: "dozen", pick: 2, amount: 10 })).toEqual(POCKETS.slice(13, 25));
    expect(among({ kind: "dozen", pick: 3, amount: 10 })).toEqual(POCKETS.slice(25, 37));
  });

  it("pays the even-money bets on eighteen numbers each and never on zero", () => {
    expect(among({ kind: "red", amount: 10 })).toEqual([...ROULETTE_RED]);
    expect(among({ kind: "black", amount: 10 })).toEqual(POCKETS.filter((pocket) => rouletteColor(pocket) === "black"));
    expect(among({ kind: "odd", amount: 10 })).toEqual(POCKETS.filter((pocket) => pocket % 2 === 1));
    expect(among({ kind: "even", amount: 10 })).toEqual(POCKETS.filter((pocket) => pocket > 0 && pocket % 2 === 0));
    expect(among({ kind: "low", amount: 10 })).toEqual(POCKETS.slice(1, 19));
    expect(among({ kind: "high", amount: 10 })).toEqual(POCKETS.slice(19));
    for (const kind of EVEN_MONEY) {
      expect(among({ kind, amount: 10 })).toHaveLength(18);
      expect(rouletteWins({ kind, amount: 10 }, 0)).toBe(false);
    }
  });
});

describe("the house edge", () => {
  it("is exactly one pocket in 37 on every bet: the nets over the 37 pockets add up to minus the bet", () => {
    for (const bet of everyBet(100)) {
      const total = POCKETS.reduce((sum, pocket) => sum + settleRoulette(pocket, [bet]).net, 0);
      expect(total, `${bet.kind} ${"pick" in bet ? bet.pick : ""}`).toBe(-100);
    }
  });

  it("is 2.7% on the even-money bets", () => {
    for (const kind of EVEN_MONEY) {
      const bet: RouletteBet = { kind, amount: 500 };
      const expected = POCKETS.reduce((sum, pocket) => sum + settleRoulette(pocket, [bet]).net, 0) / ROULETTE_POCKETS;
      expect(-expected / 500, kind).toBeCloseTo(0.027, 3);
      expect(-expected / 500, kind).toBeCloseTo(1 / 37, 12);
    }
  });

  it("returns 97.3% of the stake over the whole table of bets", () => {
    const bets = everyBet(10);
    const paid = POCKETS.reduce((sum, pocket) => sum + settleRoulette(pocket, bets).payout, 0);
    const staked = bets.reduce((sum, bet) => sum + bet.amount, 0) * ROULETTE_POCKETS;
    expect(paid / staked).toBeCloseTo(36 / 37, 12);
  });
});

describe("settling a spin", () => {
  it("nets each bet on its own and reports the stake, the payout and the total net", () => {
    const bets: RouletteBet[] = [
      { kind: "straight", pick: 17, amount: 10 },
      { kind: "red", amount: 20 },
      { kind: "dozen", pick: 2, amount: 30 },
      { kind: "odd", amount: 40 },
    ];
    const spin = settleRoulette(17, bets);
    expect(spin.number).toBe(17);
    expect(spin.color).toBe("black");
    expect(spin.results).toEqual([
      { bet: bets[0], win: true, net: 350 },
      { bet: bets[1], win: false, net: -20 },
      { bet: bets[2], win: true, net: 60 },
      { bet: bets[3], win: true, net: 40 },
    ]);
    expect(spin.stake).toBe(100);
    expect(spin.net).toBe(430);
    expect(spin.payout).toBe(530);
  });

  it("loses every outside bet to zero and pays a straight bet on it", () => {
    const outside = everyBet(10).filter((bet) => bet.kind !== "straight");
    const spin = settleRoulette(0, [...outside, { kind: "straight", pick: 0, amount: 10 }]);
    const results = spin.results;
    expect(results.slice(0, -1).every((result) => !result.win && result.net === -10)).toBe(true);
    expect(results.at(-1)).toEqual({ bet: { kind: "straight", pick: 0, amount: 10 }, win: true, net: 350 });
    expect(spin.color).toBe("green");
    expect(spin.payout).toBe(spin.stake + spin.net);
  });

  it("returns nothing of a lost bet and the stake plus the winnings of a won one", () => {
    expect(settleRoulette(5, [{ kind: "black", amount: 100 }]).payout).toBe(0);
    expect(settleRoulette(5, [{ kind: "red", amount: 100 }]).payout).toBe(200);
    expect(settleRoulette(5, [{ kind: "straight", pick: 5, amount: 100 }]).payout).toBe(3600);
  });
});

describe("a spin of the wheel", () => {
  it("lands on the pocket its one draw falls on", () => {
    const bets: RouletteBet[] = [{ kind: "red", amount: 10 }];
    for (const pocket of POCKETS) expect(spinRoulette(bets, cells([pocket], ROULETTE_POCKETS)).number).toBe(pocket);
    expect(spinRoulette(bets, () => 0).number).toBe(0);
    expect(spinRoulette(bets, () => 0.999999).number).toBe(36);
  });

  it("draws once", () => {
    let draws = 0;
    spinRoulette([{ kind: "odd", amount: 10 }], () => {
      draws += 1;
      return 0.3;
    });
    expect(draws).toBe(1);
  });

  it("settles the bets on the pocket it lands on", () => {
    const bets: RouletteBet[] = [{ kind: "straight", pick: 23, amount: 50 }];
    expect(spinRoulette(bets, cells([23], ROULETTE_POCKETS))).toEqual(settleRoulette(23, bets));
    expect(spinRoulette(bets, cells([22], ROULETTE_POCKETS)).payout).toBe(0);
  });
});

describe("a valid set of bets", () => {
  it("takes amounts from 10 to 500 in whole coins", () => {
    for (const amount of [10, 11, 250, 499, 500]) expect(validRouletteBet({ kind: "red", amount })).toBe(true);
    for (const amount of [0, 9, 501, -10, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(validRouletteBet({ kind: "red", amount })).toBe(false);
  });

  it("takes a straight bet on 0 to 36 and a dozen of 1 to 3", () => {
    expect(validRouletteBet({ kind: "straight", pick: 0, amount: 10 })).toBe(true);
    expect(validRouletteBet({ kind: "straight", pick: 36, amount: 10 })).toBe(true);
    for (const pick of [-1, 37, 1.5, Number.NaN]) expect(validRouletteBet({ kind: "straight", pick, amount: 10 })).toBe(false);
    for (const pick of [1, 2, 3] as const) expect(validRouletteBet({ kind: "dozen", pick, amount: 10 })).toBe(true);
    for (const pick of [0, 4, 1.5]) expect(validRouletteBet({ kind: "dozen", pick: pick as 1, amount: 10 })).toBe(false);
  });

  it("holds from one to twelve bets, each of them valid", () => {
    const bet: RouletteBet = { kind: "even", amount: 10 };
    expect(validRouletteBets([])).toBe(false);
    expect(validRouletteBets([bet])).toBe(true);
    expect(validRouletteBets(Array.from({ length: ROULETTE_MAX_BETS }, () => bet))).toBe(true);
    expect(validRouletteBets(Array.from({ length: ROULETTE_MAX_BETS + 1 }, () => bet))).toBe(false);
    expect(validRouletteBets([bet, { kind: "straight", pick: 40, amount: 10 }])).toBe(false);
    expect(validRouletteBets([bet, { kind: "high", amount: 5 }])).toBe(false);
  });
});
