import type { SkyState } from "@dongjane/shared";
import { type IconName, h, icon, swapIcon } from "./dom.ts";
import { describeSky } from "./format.ts";
import { Sheet } from "./sheet.ts";

export interface ClockHandlers {
  onOpenVisitors(): void;
  onInvite(): void;
  onToggleSound(): void;
  onOpenSettings(): void;
}

function toolRow(lead: IconName | HTMLElement, title: Node, sub: Node, trail: Node | null, onClick: () => void): HTMLButtonElement {
  const leadNode = typeof lead === "string" ? h("span", "tool-icon", icon(lead)) : lead;
  const node = h("button", "row tool-row", leadNode, h("span", "row-text", title, sub), trail);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

// The top-right clock button opens the sheet that shows time and weather and holds visitors, invite, sound and settings.
export class ClockWidget {
  readonly button = h("button", "clock-button");
  private readonly sheet: Sheet;
  private readonly heroIcon = h("span", "clock-hero-icon");
  private readonly heroTime = h("strong", "clock-hero-time");
  private readonly heroNote = h("p", "clock-hero-note");
  private readonly visitorBadge = h("span", "badge", "0");
  private readonly soundIcon = h("span", "tool-icon");
  private readonly soundTitle = h("strong");
  private readonly soundState = h("small");
  private lastSky = "";
  private lastIcon: IconName | null = null;

  constructor(host: HTMLElement, handlers: ClockHandlers) {
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.title = "시간과 날씨";
    this.button.append(icon("clock"));
    this.button.addEventListener("click", () => this.sheet.toggle());

    this.sheet = new Sheet(host, "시간과 날씨");
    const sound = toolRow(this.soundIcon, this.soundTitle, this.soundState, null, () => handlers.onToggleSound());
    this.sheet.body.append(
      h("div", "clock-hero", this.heroIcon, this.heroTime, this.heroNote),
      h(
        "div",
        "tool-list",
        toolRow("people", h("strong", "", "방문객 보기"), h("small", "", "함께 있는 동자승"), this.visitorBadge, () => handlers.onOpenVisitors()),
        toolRow("link", h("strong", "", "초대 링크 복사"), h("small", "", "이 법당으로 초대해요"), null, () => {
          this.sheet.close();
          handlers.onInvite();
        }),
        sound,
        toolRow("gear", h("strong", "", "설정"), h("small", "", "소리 크기, 움직임 줄이기"), null, () => {
          this.sheet.close();
          handlers.onOpenSettings();
        }),
      ),
    );
    this.setSky(null);
    this.setSoundOn(true);
  }

  setSky(sky: SkyState | null): void {
    const view = describeSky(sky);
    const key = `${view.time}|${view.weather}|${view.note}|${view.icon}`;
    if (key === this.lastSky) return;
    this.lastSky = key;
    this.heroTime.textContent = view.time;
    this.heroNote.textContent = view.note;
    this.button.setAttribute("aria-label", `시간과 날씨, ${view.time}, ${view.weather}`);
    if (view.icon !== this.lastIcon) {
      this.lastIcon = view.icon;
      swapIcon(this.heroIcon, view.icon);
    }
  }

  setVisitorCount(count: number): void {
    this.visitorBadge.textContent = String(count);
  }

  setSoundOn(on: boolean): void {
    swapIcon(this.soundIcon, on ? "soundOn" : "soundOff");
    this.soundTitle.textContent = on ? "소리 끄기" : "소리 켜기";
    this.soundState.textContent = on ? "지금 소리가 켜져 있어요" : "지금 소리가 꺼져 있어요";
  }
}
