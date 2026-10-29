export interface BowTitle {
  id: string;
  name: string;
  description: string;
  bows: number;
}

export const BOW_TITLES: readonly BowTitle[] = [
  { id: "bow-1", name: "초발심", description: "처음으로 절을 올렸어요", bows: 1 },
  { id: "bow-10", name: "정진하는 동자", description: "절을 열 번 올렸어요", bows: 10 },
  { id: "bow-30", name: "꾸준한 동자", description: "절을 서른 번 올렸어요", bows: 30 },
  { id: "bow-108", name: "백팔 동자", description: "절을 백여덟 번 올렸어요", bows: 108 },
  { id: "bow-300", name: "발원하는 동자", description: "절을 삼백 번 올렸어요", bows: 300 },
  { id: "bow-1000", name: "천배 수행자", description: "절을 천 번 올렸어요", bows: 1000 },
  { id: "bow-3000", name: "삼천배 수행자", description: "절을 삼천 번 올렸어요", bows: 3000 },
  { id: "bow-10000", name: "만배 법사", description: "절을 만 번 올렸어요", bows: 10000 },
];

export function earnedTitles(total: number): BowTitle[] {
  return BOW_TITLES.filter((title) => title.bows <= total);
}

export function homeTitleName(total: number): string | null {
  return earnedTitles(total).at(-1)?.name ?? null;
}

export function nextTitle(total: number): BowTitle | null {
  return BOW_TITLES.find((title) => title.bows > total) ?? null;
}

export function titlesCrossed(before: number, after: number): BowTitle[] {
  return BOW_TITLES.filter((title) => title.bows > before && title.bows <= after);
}

// The first count seen in a session is a baseline and a lower count means the monk was reset; neither earns bows.
export function gainedBows(last: number | null, current: number): number {
  if (last === null || current < last) return 0;
  return current - last;
}
