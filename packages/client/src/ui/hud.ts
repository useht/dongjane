import { type HallInfo, ITEM_CHANT, ITEM_MOKT, ITEM_NONE, type SkyState, hallName, seatLabel } from "@dongjane/shared";
import { checkHallEntry } from "../net/halls.ts";
import type { LinkState } from "../net/session.ts";
import { type HeldAction, heldAction, isSeated } from "../game/held-action.ts";
import type { QuestView } from "../game/quest-tracker.ts";
import { ClockWidget } from "./clock.ts";
import { button, h, icon, iconButton } from "./dom.ts";
import { EmotePicker } from "./emote-picker.ts";
import { type ChantStatus, describeSky, modeLabel } from "./format.ts";
import { HELD_ITEMS, ITEM_INFO, type HeldItem, itemImage } from "./item-art.ts";
import { Phone } from "./phone.ts";
import { QuestPanel } from "./quest.ts";
import { Sheet } from "./sheet.ts";

export interface VisitorRow {
  id: string;
  slot: number;
  mode: string;
  cushionId: number;
  bowCount: number;
  isSelf: boolean;
}

export interface SelfStatus {
  mode: string;
  cushionId: number;
  chanting: boolean;
  item: number;
}

export interface HudHandlers {
  onSwitchHall(hall: number): void;
  onOpenHalls(): void;
  onBow(): void;
  onStand(): void;
  onJump(): void;
  onEmote(emote: number): void;
  onKnock(): void;
  onChant(on: boolean): void;
  onEquip(item: number): void;
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
  private readonly hallButton = h("button", "hall-button");
  private readonly hallLabel = h("span", "hall-label", "법당");
  private readonly hallCount = h("span", "hall-count", "");
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
  private readonly toolButton: HTMLButtonElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly equipRows = new Map<HeldItem, HTMLButtonElement>();
  private readonly putDownRow: HTMLButtonElement;
  private readonly jumpButton: HTMLButtonElement;
  private readonly stats = h("pre", "stats hidden");
  private readonly hallSheet: Sheet;
  private readonly equipSheet: Sheet;
  private readonly emotePicker: EmotePicker;
  private readonly hallList = h("ul", "list");
  private readonly hallInput = h("input", "name-input");
  private readonly visitorList = h("ul", "list");
  private halls: HallInfo[] = [];
  private currentHall = 0;
  private visitorKey = "";
  private lastSky = "";
  private lastSelf = "";
  private lastChant = "";
  private selfChanting = false;
  private selfAction: HeldAction | null = null;
  private selfItem: number = ITEM_NONE;

  constructor(
    host: HTMLElement,
    private readonly handlers: HudHandlers,
    settings: HTMLElement,
  ) {
    this.hallButton.type = "button";
    this.hallButton.append(icon("hall"), this.hallLabel, this.hallCount);
    this.hallButton.setAttribute("aria-label", "법당 바꾸기");
    this.hallButton.addEventListener("click", () => {
      this.hallSheet.toggle();
      if (this.hallSheet.isOpen) handlers.onOpenHalls();
    });

    this.phone = new Phone(
      host,
      { onInvite: () => handlers.onInvite(), onToggleSound: () => handlers.onToggleSound() },
      { visitors: this.visitorList, settings },
    );
    this.clock = new ClockWidget(() => this.phone.toggle());
    this.quests = new QuestPanel(host);
    const top = h("div", "topbar", h("div", "topbar-start", h("div", "hall-stack", this.hallButton, this.quests.button)), this.clock.button);

    this.standButton = iconButton("stand", "일어서기", () => handlers.onStand(), "icon-button stand-button");
    this.bowButton = iconButton("bow", "절하기", () => handlers.onBow(), "bow-button");
    this.bowButton.querySelector("svg")?.setAttribute("viewBox", "3.5 5 18 18"); // crop the glyph's margin so it fills the big button
    this.actionButton = h("button", "bow-button action-button hidden");
    this.actionButton.type = "button";
    this.actionButton.addEventListener("click", () => {
      if (this.selfAction === "knock") handlers.onKnock();
      else if (this.selfAction === "chant") handlers.onChant(!this.selfChanting);
    });
    this.jumpButton = iconButton("jump", "점프하기", () => handlers.onJump(), "bow-button jump-button");
    this.bowActions.append(this.standButton, this.bowButton, this.actionButton, this.jumpButton);
    this.emotePicker = new EmotePicker(host, (emote) => handlers.onEmote(emote));
    const emoteButton = iconButton("emote", "이모티콘 고르기", () => this.emotePicker.sheet.toggle(), "icon-button emote-button");
    emoteButton.setAttribute("aria-haspopup", "dialog");
    this.equipSheet = new Sheet(host, "장비");
    this.toolButton = iconButton("equip", "장비", () => this.equipSheet.toggle(), "icon-button tool-button");
    this.toolButton.setAttribute("aria-haspopup", "dialog");
    const equipList = h("div", "equip-list");
    for (const item of HELD_ITEMS) {
      const info = ITEM_INFO[item];
      const row = h("button", "equip-row", itemImage(item, "equip-art"), h("span", "equip-check", icon("check")));
      row.type = "button";
      row.setAttribute("aria-label", info.name);
      row.title = `${info.name} - ${info.note}`;
      row.addEventListener("click", () => this.pickItem(item));
      this.equipRows.set(item, row);
      equipList.append(row);
    }
    this.putDownRow = h("button", "equip-row equip-putdown hidden", icon("putDown"));
    this.putDownRow.type = "button";
    this.putDownRow.setAttribute("aria-label", "내려놓기");
    this.putDownRow.title = "내려놓기";
    this.putDownRow.addEventListener("click", () => this.pickItem(ITEM_NONE));
    equipList.append(this.putDownRow);
    this.equipSheet.body.append(equipList);
    const bottom = h("div", "bottombar", h("div", "bottom-actions", this.bowActions, h("div", "bottom-tools", emoteButton, this.toolButton)));

    this.hallInput.type = "text";
    this.hallInput.inputMode = "numeric";
    this.hallInput.maxLength = 4;
    this.hallInput.autocomplete = "off";
    this.hallInput.placeholder = "법당 번호";
    this.hallInput.setAttribute("aria-label", "법당 번호");
    const go = h("button", "primary", "이동");
    go.type = "submit";
    const hallForm = h("form", "row name-row hall-go", this.hallInput, go);
    hallForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitHall();
    });

    this.hallSheet = new Sheet(host, "법당 고르기");
    this.hallSheet.body.append(
      this.hallList,
      hallForm,
      button("이 법당 초대 링크 복사", "primary wide", () => handlers.onInvite()),
    );

    this.linkBanner.setAttribute("role", "status");
    this.linkBanner.append(this.linkText, this.linkAction);
    this.toasts.setAttribute("aria-live", "polite");
    this.root.append(top, this.chantPill, this.linkBanner, this.toasts, bottom, this.stats);
    host.append(this.root);

    this.renderHalls();
    this.setSelf(null);
    this.setSky(null);
  }

  closeSheets(): boolean {
    return Sheet.closeOpen();
  }

  setHalls(halls: HallInfo[], current: number): void {
    this.halls = halls;
    this.currentHall = current;
    this.hallLabel.textContent = hallName(current);
    const here = halls.find((info) => info.hall === current);
    this.hallCount.textContent = here ? `${here.clients}/${here.capacity}` : "";
    this.renderHalls();
  }

  setVisitors(rows: readonly VisitorRow[]): void {
    this.phone.setVisitorCount(rows.length);
    const key = rows.map((row) => `${row.id}|${row.slot}|${row.mode}|${row.cushionId}|${row.bowCount}|${row.isSelf}`).join(";");
    if (key === this.visitorKey) return;
    this.visitorKey = key;
    this.visitorList.replaceChildren(
      ...rows.map((row) =>
        h(
          "li",
          row.isSelf ? "item self" : "item",
          h("span", "item-main", h("strong", "", seatLabel(row.slot)), row.isSelf && h("em", "", "나")),
          h("span", "item-sub", `${modeLabel(row.mode, row.cushionId)}${row.bowCount > 0 ? ` · 절 ${row.bowCount}번` : ""}`),
        ),
      ),
    );
  }

  setSelf(self: SelfStatus | null): void {
    const key = self ? `${self.mode}|${self.cushionId}|${self.chanting}|${self.item}` : "none";
    if (key === this.lastSelf) return;
    this.lastSelf = key;
    const seated = !!self && isSeated(self);
    const bowing = self?.mode === "bow";
    const action = heldAction(self);
    this.selfAction = action;
    this.selfItem = self?.item ?? ITEM_NONE;
    this.selfChanting = action === "chant" && !!self?.chanting;
    this.bowButton.classList.toggle("hidden", !seated || bowing || action !== null);
    this.standButton.classList.toggle("hidden", !seated);
    this.jumpButton.classList.toggle("hidden", !self || self.cushionId >= 0);
    this.bowActions.classList.toggle("seated", seated);
    this.toolButton.classList.toggle("ready", this.selfItem !== ITEM_NONE);

    const item = self && (self.item === ITEM_MOKT || self.item === ITEM_CHANT) ? self.item : null;
    this.actionButton.classList.toggle("hidden", action === null || (action === "knock" && bowing));
    this.actionButton.classList.toggle("active", this.selfChanting);
    if (action && item !== null) {
      const label = action === "knock" ? "목탁치기" : this.selfChanting ? "염불 그만두기" : "염불하기";
      this.actionButton.replaceChildren(itemImage(item));
      this.actionButton.setAttribute("aria-label", label);
      this.actionButton.title = label;
      if (action === "chant") this.actionButton.setAttribute("aria-pressed", String(this.selfChanting));
      else this.actionButton.removeAttribute("aria-pressed");
    }

    for (const [held, row] of this.equipRows) {
      const holding = held === this.selfItem;
      row.classList.toggle("held", holding);
      row.setAttribute("aria-pressed", String(holding));
    }
    this.putDownRow.classList.toggle("hidden", item === null);
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
    this.halls = [];
    this.currentHall = 0;
    this.hallLabel.textContent = "혼자 있는 법당";
    this.hallCount.textContent = "";
    this.renderHalls();
    if (status.kind === "countdown") {
      this.showLink(`${status.seconds}초 뒤 법당으로 옮겨 드려요`, { label: "이동 취소", run: () => this.handlers.onCancelReturn() });
    } else if (status.kind === "held") {
      this.showLink("이동을 취소했어요. 혼자 쉬고 있어요", { label: "법당으로 가기", run: () => this.handlers.onReturnNow() });
    } else {
      this.showLink("서버에 연결되지 않아 혼자 쉬고 있어요. 연결되면 법당으로 다시 모셔요");
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

  private pickItem(item: number): void {
    this.equipSheet.close();
    this.handlers.onEquip(item === this.selfItem ? ITEM_NONE : item);
  }

  private showLink(text: string, action?: { label: string; run(): void }): void {
    this.linkText.textContent = text;
    this.linkRun = action?.run ?? null;
    if (action) this.linkAction.textContent = action.label;
    this.linkAction.classList.toggle("hidden", !action);
    this.linkBanner.classList.remove("hidden");
  }

  private submitHall(): void {
    const result = checkHallEntry(this.halls, this.currentHall, this.hallInput.value);
    if (result.ok) {
      this.hallInput.value = "";
      this.hallSheet.close();
      this.handlers.onSwitchHall(result.hall);
      return;
    }
    const target = result.hall === null ? "" : hallName(result.hall);
    const messages = {
      invalid: "법당 번호를 숫자로 적어 주세요",
      current: "지금 이 법당에 있어요",
      missing: `${target}은 아직 열려 있지 않아요`,
      full: `${target}은 가득 찼어요`,
    } as const;
    this.toast(messages[result.reason]);
  }

  private renderHalls(): void {
    this.hallList.replaceChildren(
      ...this.halls.map((info) => {
        const here = info.hall === this.currentHall;
        const full = info.full && !here;
        const pick = h("button", `hall-row${here ? " here" : ""}`);
        pick.type = "button";
        pick.disabled = here || full;
        pick.append(
          h("strong", "", hallName(info.hall)),
          h("span", "hall-meta", here ? "지금 여기 있어요" : full ? "가득 찼어요" : `${info.clients}/${info.capacity}명`),
        );
        pick.addEventListener("click", () => {
          this.hallSheet.close();
          this.handlers.onSwitchHall(info.hall);
        });
        return h("li", "", pick);
      }),
    );
  }
}
