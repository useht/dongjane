import { SLOT_SYMBOLS, type SlotSymbol, type Wallet } from "@dongjane/shared";
import { CHIPS, chipsFor, usableChip } from "../casino/bets.ts";
import type { CasinoBank } from "../casino/bank.ts";
import { SYMBOL_NAMES } from "../casino/describe.ts";
import type { CasinoSounds } from "../audio/casino.ts";
import { THEME } from "../theme.ts";
import { h } from "./dom.ts";

// What a machine's view needs of the panel around it.
export interface GameHost {
  readonly bank: CasinoBank;
  readonly sounds: CasinoSounds;
  readonly art: SymbolArt;
  random(): number;
  reduceMotion(): boolean;
  // Checks the day before a game starts. False when the day's refill has just been paid out: the visitor sees it first, then plays.
  prepareSpin(): boolean;
  // Moves the balance on show to the bank's. A game calls it when it ends, so the number never gives the result away early.
  syncBalance(): void;
}

// One game's screen inside the panel.
export interface MachineView {
  readonly root: HTMLElement;
  readonly busy: boolean;
  show(): void;
  // Leaves any game in progress finished, with its result on show and its coins counted.
  hide(): void;
  spin(): void;
  // The balance changed from outside (the day's refill).
  refresh(): void;
  // A symbol picture arrived.
  redraw(): void;
}

// The canvases are painted in the game's own colours.
export const PALETTE = {
  cream: THEME.material.casinoCream,
  red: THEME.material.casinoRed,
  redDeep: THEME.material.casinoRedDeep,
  black: THEME.material.casinoBlack,
  felt: THEME.material.casinoFelt,
  gold: THEME.ui.gold,
  goldDeep: THEME.ui.goldDeep,
  goldPale: THEME.ui.goldPale,
  ink: THEME.ui.ink,
  muted: THEME.ui.muted,
  wood: THEME.ui.wood,
} as const;

export const SYMBOL_PATH = "/casino/symbols";

// The eight symbol pictures, loaded when the panel first opens. A picture that has not arrived (or never will, offline) is drawn
// as the symbol's name instead, so the games still read.
export class SymbolArt {
  private readonly images = new Map<SlotSymbol, HTMLImageElement>();

  constructor(private readonly onLoad: () => void) {}

  load(): void {
    for (const symbol of SLOT_SYMBOLS) {
      if (this.images.has(symbol)) continue;
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", this.onLoad);
      image.src = `${SYMBOL_PATH}/${symbol}.png`;
      this.images.set(symbol, image);
    }
  }

  image(symbol: SlotSymbol): HTMLImageElement | null {
    const image = this.images.get(symbol);
    return image && image.complete && image.naturalWidth > 0 ? image : null;
  }
}

let family: string | null = null;

export function canvasFont(weight: number, size: number): string {
  family ??= getComputedStyle(document.body).fontFamily;
  return `${weight} ${Math.round(size)}px ${family}`;
}

export function drawSymbol(ctx: CanvasRenderingContext2D, art: SymbolArt, symbol: SlotSymbol, cx: number, cy: number, size: number): void {
  const image = art.image(symbol);
  if (image) {
    ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.font = canvasFont(700, size * 0.24);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(SYMBOL_NAMES[symbol], cx, cy, size * 0.9);
  ctx.restore();
}

// A canvas drawn in a fixed logical size, sharp on dense screens; CSS scales it down to fit.
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  canvas.style.maxWidth = `${width}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  ctx.setTransform(density, 0, 0, density, 0, 0);
  return ctx;
}

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// Calls `step` every frame until it answers false.
export class FrameLoop {
  private handle = 0;

  constructor(private readonly step: (now: number) => boolean) {}

  get running(): boolean {
    return this.handle !== 0;
  }

  start(): void {
    if (this.handle === 0) this.handle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.handle !== 0) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  private readonly frame = (now: number): void => {
    this.handle = 0;
    if (this.step(now)) this.start();
  };
}

// The chips the visitor bets with: only the ones the wallet's rules allow are lit.
export class ChipPicker {
  readonly root = h("div", "casino-chips");
  private readonly buttons = new Map<number, HTMLButtonElement>();
  private pick: number = CHIPS[0];

  constructor(
    private readonly sounds: CasinoSounds,
    private readonly onPick: () => void,
  ) {
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "판돈");
    for (const chip of CHIPS) {
      const node = h("button", `casino-chip chip-${chip}`, String(chip));
      node.type = "button";
      node.setAttribute("aria-label", `${chip} 엽전`);
      node.addEventListener("click", (event) => {
        this.pick = chip;
        this.sounds.click();
        if (event.detail > 0) node.blur();
        this.onPick();
      });
      this.buttons.set(chip, node);
      this.root.append(node);
    }
  }

  get selected(): number {
    return this.pick;
  }

  // `reserved` is coins already spoken for (the roulette slip), which the chips must leave alone.
  update(wallet: Wallet, locked: boolean, reserved = 0): void {
    const free: Wallet = { ...wallet, balance: wallet.balance - reserved };
    const open = chipsFor(free);
    this.pick = usableChip(this.pick, free);
    for (const [chip, node] of this.buttons) {
      node.disabled = locked || !open.includes(chip);
      node.setAttribute("aria-pressed", String(chip === this.pick));
      node.classList.toggle("selected", chip === this.pick);
    }
  }
}

export interface SpinButton {
  readonly node: HTMLButtonElement;
  set(main: string, sub: string, enabled: boolean): void;
}

export function spinButton(onSpin: () => void): SpinButton {
  const main = h("span", "casino-spin-main");
  const sub = h("small", "casino-spin-sub");
  const node = h("button", "primary big wide casino-spin", main, sub);
  node.type = "button";
  node.addEventListener("click", (event) => {
    if (event.detail > 0) node.blur();
    onSpin();
  });
  return {
    node,
    set(label, note, enabled) {
      main.textContent = label;
      sub.textContent = note;
      node.disabled = !enabled;
    },
  };
}
