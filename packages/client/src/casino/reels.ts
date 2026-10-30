import { SLOT_LAYOUT, SLOT_STRIPS, type SlotKind, type SlotSymbol } from "@dongjane/shared";

// The first reel stops after 1.2 s and the last after 1.9 s (three reels) or 2.2 s (five), each one a beat behind the last.
export const FIRST_REEL_STOP_MS = 1200;
const REEL_STAGGER_MS = { 3: 350, 5: 250 } as const;
// How fast a reel runs while it is still spinning, in symbols a second, averaged over its whole run.
const SYMBOLS_PER_SECOND = 16;

export function easeOut(t: number, power = 2): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** power;
}

// When each reel stops, in ms after the spin starts. Without motion every reel is already stopped.
export function reelSchedule(kind: SlotKind, reduceMotion: boolean): number[] {
  const reels = SLOT_LAYOUT[kind].reels;
  const stagger = reels === 5 ? REEL_STAGGER_MS[5] : REEL_STAGGER_MS[3];
  return Array.from({ length: reels }, (_, reel) => (reduceMotion ? 0 : FIRST_REEL_STOP_MS + reel * stagger));
}

export function spinDuration(schedule: readonly number[]): number {
  return Math.max(0, ...schedule);
}

// How far, in symbols, a reel at `from` runs to land on `stop`: the first distance of at least the run its stop time asks for
// (a reel with no run to make just goes straight there).
export function reelTravel(from: number, stop: number, length: number, stopAtMs: number): number {
  const wanted = stopAtMs > 0 ? Math.round((stopAtMs / 1000) * SYMBOLS_PER_SECOND) : 0;
  const base = (((stop - from) % length) + length) % length;
  return base + Math.max(0, Math.ceil((wanted - base) / length)) * length;
}

// Where the reel is `elapsedMs` into its run, in symbols along the strip. It slows to rest at `from + travel`.
export function reelPosition(from: number, travel: number, elapsedMs: number, stopAtMs: number): number {
  if (stopAtMs <= 0 || elapsedMs >= stopAtMs) return from + travel;
  return from + travel * easeOut(elapsedMs / stopAtMs);
}

export interface ReelWindow {
  // Strip index of the symbol in the top row.
  index: number;
  // How far the strip has slid up from that row, 0 up to (not including) 1.
  offset: number;
  // The symbols from the top row down, one more than the rows shown so the one sliding in is drawn.
  symbols: SlotSymbol[];
}

export function windowAt(kind: SlotKind, position: number, rows: number): ReelWindow {
  const strip = SLOT_STRIPS[kind];
  const length = strip.length;
  const whole = Math.floor(position);
  const index = ((whole % length) + length) % length;
  return {
    index,
    offset: position - whole,
    symbols: Array.from({ length: rows + 1 }, (_, row) => strip[(index + row) % length] as SlotSymbol),
  };
}

// True when the reel went past a symbol between two frames, which is when it ticks.
export function crossedSymbol(before: number, after: number): boolean {
  return Math.floor(after) > Math.floor(before);
}

export function visibleRows(kind: SlotKind): number {
  return Math.max(...SLOT_LAYOUT[kind].lines) + 1;
}
