import type { QuestView } from "../game/quest-tracker.ts";
import { h, icon, iconButton } from "./dom.ts";
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

// The top-left daily quest button; its sheet lists today's quests and how far each one has come.
export class QuestPanel {
  readonly button: HTMLButtonElement;
  private readonly sheet: Sheet;
  private readonly badge = h("span", "badge quest-badge hidden");
  private readonly list = h("ul", "quest-list");
  private lastKey = "";

  constructor(host: HTMLElement) {
    this.button = iconButton("quest", "오늘의 퀘스트", () => this.sheet.toggle(), "icon-button quest-button");
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.append(this.badge);

    this.sheet = new Sheet(host, "오늘의 퀘스트");
    this.sheet.body.append(this.list, h("p", "fine-print", "새 퀘스트는 한국 시간 자정에 나와요"));
  }

  setQuests(views: readonly QuestView[]): void {
    const key = views.map((view) => `${view.text}|${view.target}|${view.count}`).join(";");
    if (key === this.lastKey) return;
    this.lastKey = key;
    const done = views.filter((view) => view.done).length;
    this.badge.textContent = `${done}/${views.length}`;
    this.badge.classList.toggle("hidden", views.length === 0);
    this.list.replaceChildren(...views.map(questRow));
  }
}
