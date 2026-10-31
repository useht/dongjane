import { questDay } from "./quest.ts";

export const BOW_REWARD = 2;
// A bow takes BOW_MS and the monk rests BOW_COOLDOWN_MS after it, so bows complete 3 s apart at the fastest; the guard sits half a
// second under that so the jitter of a snapshot cannot make a bow in a steady run pay nothing.
export const BOW_REWARD_COOLDOWN_MS = 2500;
export const BOW_REWARD_DAILY_CAP = 50;

// What the client keeps of the bows' pay: the KST day (as questDay counts them) it was last paid on, what that day has paid, and when.
export interface BowReward {
  day: number;
  earned: number;
  lastAt: number;
}

// Nothing paid yet: day 0 is never today.
export const NO_BOW_REWARD: BowReward = { day: 0, earned: 0, lastAt: 0 };

export interface BowPayout {
  paid: number;
  state: BowReward;
}

export function parseBowReward(value: unknown): BowReward | null {
  if (typeof value !== "object" || value === null) return null;
  const { day, earned, lastAt } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(day) || !Number.isSafeInteger(earned) || (earned as number) < 0) return null;
  if (typeof lastAt !== "number" || !Number.isFinite(lastAt)) return null;
  return { day: day as number, earned: earned as number, lastAt };
}

// What bows completed at `nowMs` pay. Bows seen together came faster than the cooldown allows, so they pay once; a bow inside the
// cooldown pays nothing and leaves the state as it was (the clock runs from the last bow that paid). The day's total starts again
// on any other KST day, like the refill. A clock behind the last payment pays nothing and restarts the cooldown from the new time.
export function payBows(state: BowReward, bows: number, nowMs: number): BowPayout {
  if (!(bows >= 1)) return { paid: 0, state };
  if (nowMs < state.lastAt) return { paid: 0, state: { ...state, lastAt: nowMs } };
  if (nowMs - state.lastAt < BOW_REWARD_COOLDOWN_MS) return { paid: 0, state };
  const day = questDay(nowMs);
  const earned = state.day === day ? state.earned : 0;
  const paid = Math.min(BOW_REWARD, Math.max(0, BOW_REWARD_DAILY_CAP - earned));
  if (paid === 0) return { paid, state };
  return { paid, state: { day, earned: earned + paid, lastAt: nowMs } };
}
