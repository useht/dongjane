import { KST_OFFSET_MS } from "./constants.ts";
import { SEAT_NAMES, ZONES, ZONE_NAMES, ZONE_SEATS, type Zone, seatSpot } from "./venues/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCATION_TARGETS = [3, 5] as const;
const ANYWHERE_TARGETS = [5, 8, 10] as const;
const CHANT_TARGETS = [2, 3] as const;

export interface Quest {
  id: string;
  text: string;
  target: number;
  place: QuestPlace | null;
  duringChant: boolean;
}

// A row of seats, counted from the end nearest the Buddha.
export interface QuestPlace {
  zone: Zone;
  row: number;
}

export function questDay(serverNowMs: number): number {
  return Math.floor((serverNowMs + KST_OFFSET_MS) / DAY_MS);
}

function rowCount(zone: Zone): number {
  return Math.max(...ZONE_SEATS[zone].map((spot) => spot.row)) + 1;
}

export function placeLabel({ zone, row }: QuestPlace): string {
  return `${ZONE_NAMES[zone]} 부처님 쪽 ${row + 1}번째 줄 ${SEAT_NAMES[zone]}`;
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
  const zone = pick(random, ZONES);
  const place: QuestPlace = { zone, row: Math.floor(random() * rowCount(zone)) };
  const locationTarget = pick(random, LOCATION_TARGETS);
  const anywhereTarget = pick(random, ANYWHERE_TARGETS);
  const chantTarget = pick(random, CHANT_TARGETS);
  const quests: Omit<Quest, "id">[] = [
    { text: `${placeLabel(place)}에서 절 ${locationTarget}번 하기`, target: locationTarget, place, duringChant: false },
    { text: `방석이나 돗자리 어디에서든 절 ${anywhereTarget}번 하기`, target: anywhereTarget, place: null, duringChant: false },
    { text: `예불 시간에 절 ${chantTarget}번 하기`, target: chantTarget, place: null, duringChant: true },
  ];
  return quests.map((quest, index) => ({ id: `${day}-${index}`, ...quest }));
}

export function questMatches(quest: Quest, bow: { zone: Zone; seatId: number; duringChant: boolean }): boolean {
  const onPlace = quest.place === null || (quest.place.zone === bow.zone && seatSpot(bow.zone, bow.seatId)?.row === quest.place.row);
  return onPlace && (!quest.duringChant || bow.duringChant);
}
