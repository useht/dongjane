import { type SkyState, type WorldInfo, seatLabel, worldName } from "@dongjane/shared";
import { checkWorldEntry } from "../net/worlds.ts";
import type { LinkState } from "../net/session.ts";
import { ClockWidget } from "./clock.ts";
import { button, h, iconButton } from "./dom.ts";
import { icon } from "./icons.ts";
import { type ChantStatus, modeLabel, seatDirection, seatName, zoneName } from "./format.ts";
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
  zone: string;
  seatId: number;
  bowCount: number;
}

export interface HudHandlers {
  onSwitchWorld(world: number): void;
  onOpenWorlds(): void;
  onBow(): void;
  onStand(): void;
  onInvite(): void;
  onToggleSound(): void;
  onOpenSettings(): void;
}

const MAX_TOASTS = 3;
const TOAST_MS = 3200;

export class Hud {
  readonly root = h("div", "hud");
  private readonly worldButton = h("button", "world-button");
  private readonly worldLabel = h("span", "world-label", "월드");
  private readonly worldCount = h("span", "world-count", "");
  private readonly clock: ClockWidget;
  private readonly chantPill = h("div", "chant-pill hidden");
  private readonly linkBanner = h("div", "link-banner hidden");
  private readonly toasts = h("div", "toasts");
  private readonly statusLine = h("p", "status-line");
  private readonly bowTally = h("span", "bow-tally");
  private readonly bowActions = h("div", "bow-actions");
  private readonly bowButton: HTMLButtonElement;
  private readonly standButton: HTMLButtonElement;
  private readonly stats = h("pre", "stats hidden");
  private readonly worldSheet: Sheet;
  private readonly visitorSheet: Sheet;
  private readonly worldList = h("ul", "list");
  private readonly worldInput = h("input", "name-input");
  private readonly visitorList = h("ul", "list");
  private worlds: WorldInfo[] = [];
  private currentWorld = 0;
  private visitorKey = "";
  private lastSelf = "";
  private lastChant = "";

  constructor(
    host: HTMLElement,
    private readonly handlers: HudHandlers,
  ) {
    this.worldButton.type = "button";
    this.worldButton.append(icon("world"), this.worldLabel, this.worldCount);
    this.worldButton.setAttribute("aria-label", "월드 바꾸기");
    this.worldButton.addEventListener("click", () => {
      this.worldSheet.toggle();
      if (this.worldSheet.isOpen) handlers.onOpenWorlds();
    });

    this.clock = new ClockWidget(host, {
      onOpenVisitors: () => this.visitorSheet.open(),
      onInvite: () => handlers.onInvite(),
      onToggleSound: () => handlers.onToggleSound(),
      onOpenSettings: () => handlers.onOpenSettings(),
    });
    const top = h("div", "topbar", this.worldButton, this.clock.button);

    this.standButton = iconButton("stand", "일어서기", () => handlers.onStand(), "icon-button stand-button");
    this.bowButton = iconButton("bow", "절하기", () => handlers.onBow(), "bow-button");
    this.bowActions.append(this.standButton, this.bowButton);
    const bottom = h(
      "div",
      "bottombar",
      h("div", "status-stack", h("div", "status", this.statusLine, this.bowTally)),
      this.bowActions,
    );

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
    this.visitorSheet = new Sheet(host, "함께 있는 동자승");
    this.visitorSheet.body.append(
      this.visitorList,
      button("초대 링크 복사", "primary wide", () => handlers.onInvite()),
    );

    this.linkBanner.setAttribute("role", "status");
    this.toasts.setAttribute("aria-live", "polite");
    this.root.append(top, this.chantPill, this.linkBanner, this.toasts, bottom, this.stats);
    host.append(this.root);

    this.renderWorlds();
    this.setSelf({ mode: "stand", zone: "gatbawi", seatId: -1, bowCount: 0 });
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
    this.clock.setVisitorCount(rows.length);
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

  setSelf(self: SelfStatus): void {
    const key = `${self.mode}|${self.zone}|${self.seatId}|${self.bowCount}`;
    if (key === this.lastSelf) return;
    this.lastSelf = key;
    const seated = self.seatId >= 0 && (self.mode === "kneel" || self.mode === "bow");
    const bowing = self.mode === "bow";
    this.bowButton.classList.toggle("hidden", !seated || bowing);
    this.standButton.classList.toggle("hidden", !seated);
    this.bowActions.classList.toggle("seated", seated);
    this.bowTally.textContent = self.bowCount > 0 ? `절 ${self.bowCount}번` : "";
    this.statusLine.textContent = seated
      ? bowing
        ? "절하는 중이에요"
        : `${seatName(self.zone)}에 앉았어요. 절을 해 보세요`
      : self.seatId >= 0
        ? `${seatDirection(self.zone)} 가는 중이에요`
        : `${seatName(self.zone)} 가까이 가서 앉기 버튼을 눌러 보세요`;
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
      this.linkBanner.textContent = "연결이 흔들려요. 다시 이어 보는 중…";
      this.linkBanner.classList.remove("hidden");
    } else {
      this.linkBanner.classList.add("hidden");
    }
  }

  setSky(sky: SkyState | null): void {
    this.clock.setSky(sky);
  }

  setSolo(): void {
    this.worlds = [];
    this.currentWorld = 0;
    this.worldLabel.textContent = "혼자 있는 월드";
    this.worldCount.textContent = "";
    this.renderWorlds();
    this.linkBanner.textContent = "서버에 연결되지 않아 혼자 쉬고 있어요. 연결되면 월드로 다시 모셔요";
    this.linkBanner.classList.remove("hidden");
  }

  setSoundOn(on: boolean): void {
    this.clock.setSoundOn(on);
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
