import { type QuestView, questSummary } from "../game/quest-tracker.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { Sheet } from "./sheet.ts";

function questRow(view: QuestView): HTMLLIElement {
  const percent = Math.min(100, Math.round((view.count / view.target) * 100));
  const fill = h("span", "quest-fill");
  fill.style.width = `${percent}%`;
  const bar = h("span", "quest-bar", fill);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(view.target));
  bar.setAttribute("aria-valuenow", String(view.count));
  return h(
    "li",
    view.done ? "quest-row done" : "quest-row",
    h("div", "quest-head", h("strong", "quest-text", view.text), view.done && h("span", "quest-state", icon("check"), "완료")),
    h("div", "quest-meter", bar, h("small", "quest-count", `${view.count}/${view.target}`)),
  );
}

// The strip under the world name sums up today's quests; its sheet lists each one and how far it has come.
export class QuestPanel {
  readonly button = h("button", "quest-strip hidden");
  private readonly sheet: Sheet;
  private readonly title = h("span", "quest-strip-title");
  private readonly line = h("span", "quest-strip-line");
  private readonly list = h("ul", "quest-list");
  private lastKey = "";

  constructor(host: HTMLElement) {
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.setAttribute("aria-label", "오늘의 퀘스트 자세히 보기");
    this.button.append(this.title, this.line);
    this.button.addEventListener("click", () => this.sheet.toggle());

    this.sheet = new Sheet(host, "오늘의 퀘스트");
    this.sheet.body.append(this.list, h("p", "fine-print", "새 퀘스트는 한국 시간 자정에 나와요"));
  }

  setQuests(views: readonly QuestView[]): void {
    const key = views.map((view) => `${view.text}|${view.target}|${view.count}`).join(";");
    if (key === this.lastKey) return;
    this.lastKey = key;
    const summary = questSummary(views);
    this.button.classList.toggle("hidden", summary === null);
    this.title.textContent = summary?.title ?? "";
    this.line.textContent = summary?.line ?? "";
    this.list.replaceChildren(...views.map(questRow));
  }
}
