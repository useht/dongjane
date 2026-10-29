export interface Credit {
  readonly title: string;
  readonly author: string;
  readonly provider: string;
  readonly licence: string;
  readonly changes: string;
  readonly url: string;
}

// Works used under a licence that asks for a credit, as the settings sheet shows them. blender/sources/buddha/source.json
// and src/assets/audio/sources.md say where each came from and how it was changed.
export const CREDITS: readonly Credit[] = [
  {
    title: "염불소리1",
    author: "김용배",
    provider: "공유마당",
    licence: "CC BY",
    changes: "앞뒤를 자르고 소리 크기를 고쳤어요",
    url: "https://gongu.copyright.or.kr/gongu/wrt/wrt/view.do?wrtSn=13254274&menuNo=200020",
  },
];

export function creditLine(credit: Credit): string {
  return `「${credit.title}」 ${credit.author} · ${credit.provider} · ${credit.licence} (${credit.changes})`;
}
