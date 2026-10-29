import { KST_OFFSET_MS } from "./constants.ts";
import { CUSHION_COUNT, CUSHION_SPOTS, cushionSpot } from "./layout.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCATION_TARGETS = [3, 5] as const;
const ANYWHERE_TARGETS = [5, 8, 10] as const;
const CHANT_TARGETS = [2, 3] as const;

export interface Quest {
  id: string;
  text: string;
  target: number;
  cushionId: number | null;
  duringChant: boolean;
}

export function questDay(serverNowMs: number): number {
  return Math.floor((serverNowMs + KST_OFFSET_MS) / DAY_MS);
}

export function cushionLabel(cushionId: number): string {
  const spot = cushionSpot(cushionId);
  if (!spot) return "방석";
  const column = CUSHION_SPOTS.filter((other) => other.z === spot.z && other.x < spot.x).length;
  const row = spot.z < 0 ? "부처님 쪽 줄" : "입구 쪽 줄";
  return `${row} ${column + 1}번째 방석`;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, options: readonly T[]): T {
  return options[Math.floor(random() * options.length)] as T;
}

export function dailyQuests(day: number): Quest[] {
  const random = mulberry32(day);
  const cushionId = Math.floor(random() * CUSHION_COUNT);
  const locationTarget = pick(random, LOCATION_TARGETS);
  const anywhereTarget = pick(random, ANYWHERE_TARGETS);
  const chantTarget = pick(random, CHANT_TARGETS);
  const quests: Omit<Quest, "id">[] = [
    { text: `${cushionLabel(cushionId)}에서 절 ${locationTarget}번 하기`, target: locationTarget, cushionId, duringChant: false },
    { text: `방석 어디에서든 절 ${anywhereTarget}번 하기`, target: anywhereTarget, cushionId: null, duringChant: false },
    { text: `예불 시간에 절 ${chantTarget}번 하기`, target: chantTarget, cushionId: null, duringChant: true },
  ];
  return quests.map((quest, index) => ({ id: `${day}-${index}`, ...quest }));
}

export function questMatches(quest: Quest, bow: { cushionId: number; duringChant: boolean }): boolean {
  return (quest.cushionId === null || quest.cushionId === bow.cushionId) && (!quest.duringChant || bow.duringChant);
}
