import { BOW_TITLES, type BowTitle, earnedTitles, nextTitle } from "../collection/titles.ts";
import { h } from "./dom.ts";

function titleRow(title: BowTitle, earned: boolean): HTMLLIElement {
  if (earned) {
    return h(
      "li",
      "title-row earned",
      h("strong", "title-name", title.name),
      h("span", "title-desc", title.description),
      h("small", "title-meta", `절 ${title.bows}번에 얻었어요`),
    );
  }
  return h("li", "title-row locked", h("strong", "title-name", "???"), h("span", "title-desc", `절 ${title.bows}번을 채우면 열려요`));
}

export class CollectionApp {
  readonly root = h("div", "collection");
  private last: number | null = null;

  constructor() {
    this.setBows(0);
  }

  setBows(total: number): void {
    if (total === this.last) return;
    this.last = total;
    const earned = earnedTitles(total);
    const next = nextTitle(total);
    const floor = earned.at(-1)?.bows ?? 0;
    const percent = next ? Math.round(((total - floor) / (next.bows - floor)) * 100) : 100;

    const fill = h("div", "collection-progress-fill");
    fill.style.width = `${percent}%`;
    const bar = h("div", "collection-progress", fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "다음 칭호까지");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(percent));

    const summary = h(
      "div",
      "collection-summary",
      h("div", "collection-stats", h("strong", "", `칭호 ${earned.length}/${BOW_TITLES.length}`), h("span", "", `누적 절 ${total}번`)),
      bar,
      h("p", "collection-next", next ? `다음 칭호 '${next.name}'까지 ${next.bows - total}번 남았어요` : "모든 칭호를 얻었어요"),
    );
    const list = h("ul", "title-list", ...BOW_TITLES.map((title) => titleRow(title, title.bows <= total)));
    this.root.replaceChildren(summary, list);
  }
}
