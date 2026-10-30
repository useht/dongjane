import type { MachineSpot } from "@dongjane/shared";
import type { CasinoSounds } from "../audio/casino.ts";
import { chipsFor } from "../casino/bets.ts";
import type { BankNotice, CasinoBank } from "../casino/bank.ts";
import { MACHINE_TITLES, formatCoins } from "../casino/describe.ts";
import { type GameHost, type MachineView, SymbolArt } from "./casino-kit.ts";
import { RouletteView } from "./casino-roulette.ts";
import { ScratchView } from "./casino-scratch.ts";
import { SlotsView } from "./casino-slots.ts";
import { h } from "./dom.ts";
import { Sheet } from "./sheet.ts";

export interface CasinoPanelOptions {
  bank: CasinoBank;
  sounds: CasinoSounds;
  random: () => number;
  reduceMotion: () => boolean;
  // Runs whenever the panel closes, however it was closed.
  onClose?: () => void;
}

type Notice = BankNotice | "broke";

const BROKE = "엽전이 부족해요. 내일이 되면 다시 채워 드려요.";
const FINE_PRINT = "엽전은 게임 속 가상 재화이며 현금이나 상품으로 바꿀 수 없어요. 놀이 결과는 이 기기에만 남아요.";

// The sheet a visitor plays a machine in: the balance, then the machine's own screen (see MachineView). Everything here is local to
// this device; nothing about a game is sent anywhere.
export class CasinoPanel {
  private readonly sheet: Sheet;
  private readonly amount = h("strong", "casino-balance-amount");
  private readonly notice = h("p", "casino-notice hidden");
  private readonly stage = h("div", "casino-stage");
  private readonly views = new Map<string, MachineView>();
  private readonly art = new SymbolArt(() => this.current?.redraw());
  private readonly host: GameHost;
  private current: MachineView | null = null;
  private machine: MachineSpot | null = null;
  private showing: Notice | null = null;
  private shown = Number.NaN;

  constructor(
    host: HTMLElement,
    private readonly options: CasinoPanelOptions,
  ) {
    this.sheet = new Sheet(host, "카지노", { onClose: () => this.closed() });
    const balance = h("div", "casino-balance", h("span", "casino-balance-label", "내 지갑"), this.amount);
    this.sheet.body.classList.add("casino-body");
    this.sheet.body.closest(".sheet")?.classList.add("casino-sheet");
    this.sheet.body.append(balance, this.notice, this.stage, h("p", "fine-print", FINE_PRINT));
    this.notice.setAttribute("role", "status");
    this.notice.setAttribute("aria-live", "polite");
    this.host = {
      bank: options.bank,
      sounds: options.sounds,
      art: this.art,
      random: () => options.random(),
      reduceMotion: () => options.reduceMotion(),
      prepareSpin: () => this.prepareSpin(),
      syncBalance: () => this.syncBalance(),
    };
    window.addEventListener("keydown", this.key);
  }

  get isOpen(): boolean {
    return this.sheet.isOpen;
  }

  get spot(): MachineSpot | null {
    return this.machine;
  }

  setReduceMotion(on: boolean): void {
    this.sheet.body.classList.toggle("reduce-motion", on);
  }

  open(spot: MachineSpot): void {
    const { bank, sounds } = this.options;
    this.art.load();
    sounds.prepare();
    bank.refresh();
    const view = this.viewFor(spot);
    if (this.current && this.current !== view) this.current.hide();
    this.current = view;
    this.machine = spot;
    this.sheet.setTitle(MACHINE_TITLES[spot.kind]);
    this.setNotice(bank.takeNotice() ?? (this.broke() ? "broke" : null));
    this.shown = Number.NaN;
    this.paintBalance();
    this.sheet.open();
    view.show();
  }

  close(): void {
    this.sheet.close();
  }

  private closed(): void {
    this.current?.hide();
    this.machine = null;
    this.options.onClose?.();
  }

  private viewFor(spot: MachineSpot): MachineView {
    let view = this.views.get(spot.kind);
    if (!view) {
      view = spot.kind === "roulette" ? new RouletteView(this.host) : spot.kind === "scratch" ? new ScratchView(this.host) : new SlotsView(this.host, spot.kind);
      view.root.classList.add("hidden");
      this.stage.append(view.root);
      this.views.set(spot.kind, view);
    }
    return view;
  }

  // The day may have turned over while the panel was open: a refill is told before the next game starts.
  private prepareSpin(): boolean {
    this.options.sounds.prepare();
    this.options.bank.refresh();
    const notice = this.options.bank.takeNotice();
    if (!notice) return true;
    this.setNotice(notice);
    this.paintBalance();
    return false;
  }

  private syncBalance(): void {
    this.paintBalance();
    if (this.broke()) this.setNotice("broke");
    else if (this.showing === "broke") this.setNotice(null);
  }

  private broke(): boolean {
    return chipsFor(this.options.bank.wallet).length === 0;
  }

  private paintBalance(): void {
    const balance = this.options.bank.balance;
    if (balance === this.shown) return;
    const first = Number.isNaN(this.shown);
    this.shown = balance;
    this.amount.textContent = formatCoins(balance);
    if (!first && !this.options.reduceMotion() && typeof this.amount.animate === "function") {
      this.amount.animate([{ transform: "scale(1.16)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
    }
  }

  private setNotice(notice: Notice | null): void {
    this.showing = notice;
    const count = this.options.bank.balance.toLocaleString("en-US");
    const text =
      notice === "welcome"
        ? `처음 오셨네요! 엽전 ${count}개를 드렸어요. 게임 속에서만 쓰는 가상 재화예요.`
        : notice === "refill"
          ? `하루가 지나 엽전을 ${count}개로 채워 드렸어요.`
          : notice === "broke"
            ? BROKE
            : "";
    this.notice.textContent = text;
    this.notice.classList.toggle("hidden", text === "");
  }

  // Space or Enter spins, unless the visitor is on a button (which then does its own thing).
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.sheet.isOpen || event.defaultPrevented) return;
    if (event.code !== "Space" && event.code !== "Enter" && event.code !== "NumpadEnter") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, summary, input, textarea, select")) return;
    event.preventDefault();
    if (!event.repeat) this.current?.spin();
  };
}
