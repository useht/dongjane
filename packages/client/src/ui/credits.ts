export interface Credit {
  readonly title: string;
  readonly author: string;
  readonly provider: string;
  readonly licence: string;
  readonly changes: string;
  readonly url: string;
}

// Works used under a licence that asks for a credit, as the settings sheet shows them. blender/sources/sources.md (the Buddha)
// and src/assets/audio/sources.md (the chant) say where each came from and how it was changed.
export const CREDITS: readonly Credit[] = [
  {
    title: "염불소리1",
    author: "김용배",
    provider: "공유마당",
    licence: "CC BY",
    changes: "앞뒤를 자르고 소리 크기를 고쳤어요",
    url: "https://gongu.copyright.or.kr/gongu/wrt/wrt/view.do?wrtSn=13254274&menuNo=200020",
  },
  {
    title: "부여 군수리 석조여래좌상",
    author: "국립중앙박물관",
    provider: "국립중앙박물관 누리집",
    licence: "공공누리 제1유형 출처표시",
    changes: "점을 줄이고 빛과 그림자, 색을 새로 입혔어요",
    url: "https://www.museum.go.kr/MUSEUM/contents/M0505000000.do?schM=view&searchId=search&relicId=188866",
  },
];

export function creditLine(credit: Credit): string {
  return `「${credit.title}」 ${credit.author} · ${credit.provider} · ${credit.licence} (${credit.changes})`;
}
