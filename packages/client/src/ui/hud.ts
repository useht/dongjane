import { type SkyState, type WorldInfo, seatLabel, worldName } from "@dongjane/shared";
import { checkWorldEntry } from "../net/worlds.ts";
import type { LinkState } from "../net/session.ts";
import type { QuestView } from "../game/quest-tracker.ts";
import { ClockWidget } from "./clock.ts";
import { button, h, iconButton } from "./dom.ts";
import { EmotePicker } from "./emote-picker.ts";
import { type ChantStatus, describeSky, modeLabel, zoneName } from "./format.ts";
import { icon } from "./icons.ts";
import { Phone } from "./phone.ts";
import { QuestPanel } from "./quest.ts";
import { Sheet } from "./sheet.ts";

export interface VisitorRow {
  id: string;
  slot: number;
  mode: string;
  zone: string;
  seatId: number;
  bowCount: number;
  isSelf: boolean;
}

export interface SelfStatus {
  mode: string;
  seatId: number;
}

export interface HudHandlers {
  onSwitchWorld(world: number): void;
  onOpenWorlds(): void;
  onBow(): void;
  onStand(): void;
  onJump(): void;
  onEmote(emote: number): void;
  onInvite(): void;
  onToggleSound(): void;
  onCancelReturn(): void;
  onReturnNow(): void;
}

export type SoloStatus = { kind: "idle" } | { kind: "countdown"; seconds: number } | { kind: "held" };

const MAX_TOASTS = 3;
const TOAST_MS = 3200;

export class Hud {
  readonly root = h("div", "hud");
  private readonly worldButton = h("button", "world-button");
  private readonly worldLabel = h("span", "world-label", "월드");
  private readonly worldCount = h("span", "world-count", "");
  private readonly clock: ClockWidget;
  private readonly phone: Phone;
  private readonly quests: QuestPanel;
  private readonly chantPill = h("div", "chant-pill hidden");
  private readonly linkBanner = h("div", "link-banner hidden");
  private readonly linkText = h("span", "link-text");
  private readonly linkAction = button("", "link-action hidden", () => this.linkRun?.());
  private linkRun: (() => void) | null = null;
  private readonly toasts = h("div", "toasts");
  private readonly bowActions = h("div", "bow-actions");
  private readonly bowButton: HTMLButtonElement;
  private readonly standButton: HTMLButtonElement;
  private readonly jumpButton: HTMLButtonElement;
  private readonly stats = h("pre", "stats hidden");
  private readonly worldSheet: Sheet;
  private readonly emotePicker: EmotePicker;
  private readonly worldList = h("ul", "list");
  private readonly worldInput = h("input", "name-input");
  private readonly visitorList = h("ul", "list");
  private worlds: WorldInfo[] = [];
  private currentWorld = 0;
  private visitorKey = "";
  private lastSky = "";
  private lastSelf = "";
  private lastChant = "";

  constructor(
    host: HTMLElement,
    private readonly handlers: HudHandlers,
    settings: HTMLElement,
  ) {
    this.worldButton.type = "button";
    this.worldButton.append(icon("world"), this.worldLabel, this.worldCount);
    this.worldButton.setAttribute("aria-label", "월드 바꾸기");
    this.worldButton.addEventListener("click", () => {
      this.worldSheet.toggle();
      if (this.worldSheet.isOpen) handlers.onOpenWorlds();
    });

    this.phone = new Phone(
      host,
      { onInvite: () => handlers.onInvite(), onToggleSound: () => handlers.onToggleSound() },
      { visitors: this.visitorList, settings },
    );
    this.clock = new ClockWidget(() => this.phone.toggle());
    this.quests = new QuestPanel(host);
    const top = h("div", "topbar", h("div", "topbar-start", h("div", "world-stack", this.worldButton, this.quests.button)), this.clock.button);

    this.standButton = iconButton("stand", "일어서기", () => handlers.onStand(), "icon-button stand-button");
    this.bowButton = iconButton("bow", "절하기", () => handlers.onBow(), "bow-button");
    this.jumpButton = iconButton("jump", "점프하기", () => handlers.onJump(), "bow-button jump-button");
    this.bowActions.append(this.standButton, this.bowButton, this.jumpButton);
    this.emotePicker = new EmotePicker(host, (emote) => handlers.onEmote(emote));
    const emoteButton = iconButton("emote", "이모티콘 고르기", () => this.emotePicker.sheet.toggle(), "icon-button emote-button");
    emoteButton.setAttribute("aria-haspopup", "dialog");
    const bottom = h("div", "bottombar", h("div", "bottom-actions", emoteButton, this.bowActions));

    this.worldInput.type = "text";
    this.worldInput.inputMode = "numeric";
    this.worldInput.maxLength = 4;
    this.worldInput.autocomplete = "off";
    this.worldInput.placeholder = "월드 번호";
    this.worldInput.setAttribute("aria-label", "월드 번호");
    const go = h("button", "primary", "이동");
    go.type = "submit";
    const worldForm = h("form", "row name-row world-go", this.worldInput, go);
    worldForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitWorld();
    });

    this.worldSheet = new Sheet(host, "월드 고르기");
    this.worldSheet.body.append(
      this.worldList,
      worldForm,
      button("이 월드 초대 링크 복사", "primary wide", () => handlers.onInvite()),
    );

    this.linkBanner.setAttribute("role", "status");
    this.linkBanner.append(this.linkText, this.linkAction);
    this.toasts.setAttribute("aria-live", "polite");
    this.root.append(top, this.chantPill, this.linkBanner, this.toasts, bottom, this.stats);
    host.append(this.root);

    this.renderWorlds();
    this.setSelf(null);
    this.setSky(null);
  }

  closeSheets(): boolean {
    return Sheet.closeOpen();
  }

  setWorlds(worlds: WorldInfo[], current: number): void {
    this.worlds = worlds;
    this.currentWorld = current;
    this.worldLabel.textContent = worldName(current);
    const here = worlds.find((info) => info.world === current);
    this.worldCount.textContent = here ? `${here.clients}/${here.capacity}` : "";
    this.renderWorlds();
  }

  setVisitors(rows: readonly VisitorRow[]): void {
    this.phone.setVisitorCount(rows.length);
    const key = rows.map((row) => `${row.id}|${row.slot}|${row.mode}|${row.zone}|${row.seatId}|${row.bowCount}|${row.isSelf}`).join(";");
    if (key === this.visitorKey) return;
    this.visitorKey = key;
    this.visitorList.replaceChildren(
      ...rows.map((row) =>
        h(
          "li",
          row.isSelf ? "item self" : "item",
          h("span", "item-main", h("strong", "", seatLabel(row.slot)), row.isSelf && h("em", "", "나")),
          h("span", "item-sub", `${zoneName(row.zone)} · ${modeLabel(row.mode, row.seatId, row.zone)}${row.bowCount > 0 ? ` · 절 ${row.bowCount}번` : ""}`),
        ),
      ),
    );
  }

  setSelf(self: SelfStatus | null): void {
    const key = self ? `${self.mode}|${self.seatId}` : "none";
    if (key === this.lastSelf) return;
    this.lastSelf = key;
    const seated = !!self && self.seatId >= 0 && (self.mode === "kneel" || self.mode === "bow");
    const bowing = self?.mode === "bow";
    this.bowButton.classList.toggle("hidden", !seated || bowing);
    this.standButton.classList.toggle("hidden", !seated);
    this.jumpButton.classList.toggle("hidden", !self || self.seatId >= 0);
    this.bowActions.classList.toggle("seated", seated);
  }

  setChant(status: ChantStatus | null): void {
    if (!status) {
      this.chantPill.classList.add("hidden");
      return;
    }
    const key = `${status.text}|${status.imminent}|${status.phase}`;
    if (key === this.lastChant) return;
    this.lastChant = key;
    this.chantPill.textContent = status.text;
    this.chantPill.classList.remove("hidden");
    this.chantPill.classList.toggle("active", status.phase === "active");
    this.chantPill.classList.toggle("soon", status.imminent && status.phase === "upcoming");
  }

  setLink(link: LinkState): void {
    if (link === "reconnecting") {
      this.showLink("연결이 흔들려요. 다시 이어 보는 중…");
    } else {
      this.linkBanner.classList.add("hidden");
    }
  }

  setSky(sky: SkyState | null): void {
    const view = describeSky(sky);
    const key = `${view.time}|${view.weather}|${view.note}|${view.icon}`;
    if (key === this.lastSky) return;
    this.lastSky = key;
    this.clock.setSky(view);
    this.phone.setSky(view);
  }

  setCollection(bows: number): void {
    this.phone.setBows(bows);
  }

  setQuests(views: readonly QuestView[]): void {
    this.quests.setQuests(views);
  }

  setSolo(status: SoloStatus): void {
    this.worlds = [];
    this.currentWorld = 0;
    this.worldLabel.textContent = "혼자 있는 월드";
    this.worldCount.textContent = "";
    this.renderWorlds();
    if (status.kind === "countdown") {
      this.showLink(`${status.seconds}초 뒤 월드로 옮겨 드려요`, { label: "이동 취소", run: () => this.handlers.onCancelReturn() });
    } else if (status.kind === "held") {
      this.showLink("이동을 취소했어요. 혼자 쉬고 있어요", { label: "월드로 가기", run: () => this.handlers.onReturnNow() });
    } else {
      this.showLink("서버에 연결되지 않아 혼자 쉬고 있어요. 연결되면 월드로 다시 모셔요");
    }
  }

  setSoundOn(on: boolean): void {
    this.phone.setSoundOn(on);
  }

  toast(text: string): void {
    const node = h("div", "toast", text);
    this.toasts.append(node);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => node.classList.add("out"), TOAST_MS);
    window.setTimeout(() => node.remove(), TOAST_MS + 400);
  }

  setStats(text: string | null): void {
    this.stats.classList.toggle("hidden", text === null);
    if (text !== null) this.stats.textContent = text;
  }

  private showLink(text: string, action?: { label: string; run(): void }): void {
    this.linkText.textContent = text;
    this.linkRun = action?.run ?? null;
    if (action) this.linkAction.textContent = action.label;
    this.linkAction.classList.toggle("hidden", !action);
    this.linkBanner.classList.remove("hidden");
  }

  private submitWorld(): void {
    const result = checkWorldEntry(this.worlds, this.currentWorld, this.worldInput.value);
    if (result.ok) {
      this.worldInput.value = "";
      this.worldSheet.close();
      this.handlers.onSwitchWorld(result.world);
      return;
    }
    const target = result.world === null ? "" : worldName(result.world);
    const messages = {
      invalid: "월드 번호를 숫자로 적어 주세요",
      current: "지금 이 월드에 있어요",
      missing: `${target}은 아직 열려 있지 않아요`,
      full: `${target}은 가득 찼어요`,
    } as const;
    this.toast(messages[result.reason]);
  }

  private renderWorlds(): void {
    this.worldList.replaceChildren(
      ...this.worlds.map((info) => {
        const here = info.world === this.currentWorld;
        const full = info.full && !here;
        const pick = h("button", `world-row${here ? " here" : ""}`);
        pick.type = "button";
        pick.disabled = here || full;
        pick.append(
          h("strong", "", worldName(info.world)),
          h("span", "world-meta", here ? "지금 여기 있어요" : full ? "가득 찼어요" : `${info.clients}/${info.capacity}명`),
        );
        pick.addEventListener("click", () => {
          this.worldSheet.close();
          this.handlers.onSwitchWorld(info.world);
        });
        return h("li", "", pick);
      }),
    );
  }
}
