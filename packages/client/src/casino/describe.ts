import {
  type MachineKind,
  ROULETTE_ODDS,
  SCRATCH_LINES,
  SLOT_LAYOUT,
  type ScratchCard,
  type SlotSpin,
  type SlotSymbol,
  type SlotWin,
  type RouletteColor,
} from "@dongjane/shared";
import type { SlipTarget } from "./bets.ts";

export const MACHINE_TITLES: Readonly<Record<MachineKind, string>> = {
  classic: "클래식 슬롯",
  fiveReel: "5릴 슬롯",
  luckySeven: "럭키 세븐",
  roulette: "룰렛",
  scratch: "긁는 복권",
};

export const SYMBOL_NAMES: Readonly<Record<SlotSymbol, string>> = {
  coin: "동전",
  pouch: "복주머니",
  lotus: "연꽃",
  koi: "잉어",
  bell: "풍경",
  lantern: "등",
  ingot: "금괴",
  seven: "행운의 7",
};

export const COLOR_NAMES: Readonly<Record<RouletteColor, string>> = { green: "초록", red: "빨강", black: "검정" };

export function formatCoins(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} 엽전`;
}

// What a game won or lost, as the visitor reads it.
export function formatNet(net: number): string {
  if (net > 0) return `+${formatCoins(net)}`;
  if (net < 0) return `−${formatCoins(-net)}`;
  return "본전";
}

export function slotLine(spin: Pick<SlotSpin, "kind" | "grid">, win: SlotWin): SlotSymbol[] {
  const row = SLOT_LAYOUT[spin.kind].lines[win.line] ?? 0;
  return spin.grid.map((reel) => reel[row] as SlotSymbol);
}

export function describeSlotWin(spin: Pick<SlotSpin, "kind" | "grid">, win: SlotWin): string {
  const line = slotLine(spin, win);
  const lineNo = SLOT_LAYOUT[spin.kind].lines.length > 1 ? `${win.line + 1}번 줄 · ` : "";
  const count = win.reels.length;
  const alike = line.every((symbol) => symbol === line[0]);
  let what: string;
  if (spin.kind === "luckySeven" && !alike) {
    what = win.symbol === "seven" ? `행운의 7 ${count}개` : "풍경·등·금괴 아무 조합";
  } else if (count === line.length) {
    what = `${SYMBOL_NAMES[win.symbol]} ${count}개`;
  } else {
    what = `${SYMBOL_NAMES[win.symbol]} 왼쪽부터 ${count}개`;
  }
  return `${lineNo}${what} · ×${win.multiplier}`;
}

export function describeSlotSpin(spin: SlotSpin): { headline: string; lines: string[] } {
  const lines = spin.wins.map((win) => describeSlotWin(spin, win));
  if (spin.jackpot) return { headline: `잭팟! ${formatNet(spin.payout - spin.stake)}`, lines };
  if (spin.wins.length > 0) return { headline: `당첨! ${formatNet(spin.payout - spin.stake)}`, lines };
  return { headline: "아쉬워요, 꽝", lines: [] };
}

export function rouletteLabel(target: SlipTarget): string {
  switch (target.kind) {
    case "straight":
      return `${target.pick}번`;
    case "dozen":
      return ["1–12", "13–24", "25–36"][target.pick - 1] as string;
    case "red":
      return "빨강";
    case "black":
      return "검정";
    case "odd":
      return "홀";
    case "even":
      return "짝";
    case "low":
      return "1–18";
    case "high":
      return "19–36";
  }
}

// A winning bet gets its stake back and this many times it on top: the pay a visitor reads as "×N".
export function rouletteMultiplier(target: SlipTarget): number {
  return ROULETTE_ODDS[target.kind] + 1;
}

const SCRATCH_LINE_NAMES = ["윗줄", "가운데 줄", "아랫줄", "왼쪽 세로줄", "가운데 세로줄", "오른쪽 세로줄", "왼쪽 위에서 오른쪽 아래 대각선", "오른쪽 위에서 왼쪽 아래 대각선"];

export function scratchLineName(line: readonly number[]): string {
  const at = SCRATCH_LINES.findIndex((candidate) => candidate.every((cell, i) => cell === line[i]));
  return SCRATCH_LINE_NAMES[at] ?? "";
}

export function describeScratch(card: ScratchCard): { headline: string; detail: string } {
  if (!card.symbol || !card.line) return { headline: "아쉬워요, 꽝", detail: "" };
  return {
    headline: `당첨! ${formatNet(card.payout - card.stake)}`,
    detail: `${scratchLineName(card.line)}에 ${SYMBOL_NAMES[card.symbol]} 3개 · ×${card.multiplier}`,
  };
}
