import { type ScratchCard, drawScratch } from "@dongjane/shared";
import { describeScratch, formatCoins } from "../casino/describe.ts";
import { ScratchCoverage } from "../casino/scratch-card.ts";
import { withAlpha } from "../theme.ts";
import { ChipPicker, type GameHost, type MachineView, PALETTE, type SpinButton, canvasFont, drawSymbol, prepareCanvas, roundedRect, spinButton } from "./casino-kit.ts";
import { button, h } from "./dom.ts";

const SIZE = 300;
const PAD = 16;
const GAP = 8;
const CELL = (SIZE - PAD * 2 - GAP * 2) / 3;
// The brush, as a share of the card's width.
const BRUSH = 0.055;
const MIN_STEP_PX = 6;

// A scratch card: the face (its nine symbols) under a coat that the visitor's finger or pointer takes off. The card is drawn only
// after it has been settled; scratching reveals what was already decided.
export class ScratchView implements MachineView {
  readonly root = h("div", "casino-view casino-scratch");
  private readonly face = h("canvas", "casino-canvas casino-face");
  private readonly coat = h("canvas", "casino-canvas casino-coat");
  private readonly faceCtx: CanvasRenderingContext2D;
  private readonly coatCtx: CanvasRenderingContext2D;
  private readonly coverage = new ScratchCoverage();
  private readonly chips: ChipPicker;
  private readonly spinner: SpinButton;
  private readonly openAll: HTMLButtonElement;
  private readonly headline = h("strong", "casino-headline");
  private readonly verdict = h("p", "casino-verdict");
  private readonly detail = h("p", "casino-lines");
  private readonly tally = h("p", "casino-tally");
  private card: ScratchCard | null = null;
  private revealed = true;
  private pointer: { id: number; x: number; y: number } | null = null;

  constructor(private readonly host: GameHost) {
    this.faceCtx = prepareCanvas(this.face, SIZE, SIZE);
    this.coatCtx = prepareCanvas(this.coat, SIZE, SIZE);
    this.face.setAttribute("role", "img");
    this.face.setAttribute("aria-label", "복권");
    this.coat.setAttribute("aria-hidden", "true");
    this.coat.addEventListener("pointerdown", this.down);
    this.coat.addEventListener("pointermove", this.move);
    this.coat.addEventListener("pointerup", this.up);
    this.coat.addEventListener("pointercancel", this.up);
    this.chips = new ChipPicker(host.sounds, () => this.refresh());
    this.spinner = spinButton(() => this.spin());
    this.openAll = button("모두 열기", "casino-small", () => this.reveal(true));
    const result = h("div", "casino-result", this.headline, this.verdict, this.detail, this.tally);
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    const card = h("div", "casino-card", this.face, this.coat);
    this.root.append(h("div", "casino-frame", card), h("div", "casino-card-tools", this.openAll), result, h("div", "casino-actions", this.chips.root, this.spinner.node));
    this.headline.textContent = "복권을 사서 긁어 보세요";
    this.paintCoat();
    this.paintFace(null, false);
  }

  get busy(): boolean {
    return this.card !== null && !this.revealed;
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.refresh();
  }

  hide(): void {
    if (this.busy) this.reveal(false);
    this.root.classList.add("hidden");
  }

  redraw(): void {
    this.paintFace(this.card, this.revealed);
  }

  refresh(): void {
    this.chips.update(this.host.bank.wallet, this.busy);
    const bet = this.chips.selected;
    const ready = !this.busy && bet > 0 && this.host.bank.canBet(bet);
    this.spinner.set(this.card ? "새 복권 사기" : "복권 사기", bet > 0 ? formatCoins(bet) : "엽전이 부족해요", ready);
    this.openAll.classList.toggle("hidden", !this.busy);
  }

  spin(): void {
    if (this.busy || this.root.classList.contains("hidden")) return;
    if (!this.host.prepareSpin()) {
      this.refresh();
      return;
    }
    const bet = this.chips.selected;
    if (bet === 0 || !this.host.bank.canBet(bet)) {
      this.refresh();
      return;
    }
    const card = drawScratch(bet, () => this.host.random());
    if (!this.host.bank.settle({ stake: card.stake, payout: card.payout })) {
      this.refresh();
      return;
    }
    this.host.sounds.click();
    this.card = card;
    this.revealed = false;
    this.pointer = null;
    this.coverage.reset();
    this.coat.classList.remove("gone");
    this.root.classList.remove("win", "lose");
    this.paintCoat();
    this.paintFace(card, false);
    this.headline.textContent = "손가락이나 마우스로 긁어 보세요";
    this.verdict.textContent = "";
    this.detail.textContent = "";
    this.tally.textContent = "";
    this.refresh();
  }

  private reveal(sound: boolean): void {
    const card = this.card;
    if (!card || this.revealed) return;
    this.revealed = true;
    this.pointer = null;
    this.coverage.clearAll();
    this.paintFace(card, true);
    this.coat.classList.add("gone");
    const text = describeScratch(card);
    this.headline.textContent = text.headline;
    this.verdict.textContent = "";
    this.detail.textContent = text.detail;
    this.tally.textContent = `판돈 ${formatCoins(card.stake)} · 받은 돈 ${formatCoins(card.payout)}`;
    this.root.classList.toggle("win", card.payout > 0);
    this.root.classList.toggle("lose", card.payout === 0);
    if (sound) {
      if (card.symbol === "seven") this.host.sounds.jackpot();
      else if (card.payout > 0) this.host.sounds.coin();
    }
    this.host.syncBalance();
    this.refresh();
  }

  private readonly down = (event: PointerEvent): void => {
    if (!this.busy || this.pointer) return;
    event.preventDefault();
    try {
      this.coat.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer cannot be captured; scratching still works while it stays over the card
    }
    const at = this.place(event);
    this.pointer = { id: event.pointerId, ...at };
    this.scratch(at, at);
  };

  private readonly move = (event: PointerEvent): void => {
    const held = this.pointer;
    if (!held || held.id !== event.pointerId || !this.busy) return;
    const at = this.place(event);
    if (Math.hypot(at.x - held.x, at.y - held.y) < MIN_STEP_PX) return;
    this.scratch(held, at);
    this.pointer = { id: held.id, ...at };
  };

  private readonly up = (event: PointerEvent): void => {
    if (this.pointer?.id === event.pointerId) this.pointer = null;
  };

  // A pointer position in the card's own frame.
  private place(event: PointerEvent): { x: number; y: number } {
    const rect = this.coat.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * SIZE, y: ((event.clientY - rect.top) / rect.height) * SIZE };
  }

  private scratch(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const ctx = this.coatCtx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = BRUSH * SIZE * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    this.coverage.stroke(from.x / SIZE, from.y / SIZE, to.x / SIZE, to.y / SIZE, BRUSH);
    this.host.sounds.tick();
    if (this.coverage.revealed) this.reveal(true);
  }

  private paintCoat(): void {
    const ctx = this.coatCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    roundedRect(ctx, 6, 6, SIZE - 12, SIZE - 12, 14);
    const metal = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    metal.addColorStop(0, PALETTE.muted);
    metal.addColorStop(0.5, PALETTE.goldPale);
    metal.addColorStop(1, PALETTE.muted);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = withAlpha(PALETTE.ink, 0.12);
    ctx.lineWidth = 2;
    for (let offset = -SIZE; offset < SIZE * 2; offset += 14) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + SIZE, SIZE);
      ctx.stroke();
    }
    ctx.restore();
    roundedRect(ctx, 6, 6, SIZE - 12, SIZE - 12, 14);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.goldDeep;
    ctx.stroke();
    ctx.font = canvasFont(800, 26);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = withAlpha(PALETTE.ink, 0.78);
    ctx.fillText("긁어 보세요", SIZE / 2, SIZE / 2);
  }

  private paintFace(card: ScratchCard | null, done: boolean): void {
    const ctx = this.faceCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    roundedRect(ctx, 1.5, 1.5, SIZE - 3, SIZE - 3, 16);
    ctx.fillStyle = PALETTE.redDeep;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.goldDeep;
    ctx.stroke();
    const winning = done && card?.line ? new Set<number>(card.line) : null;
    for (let index = 0; index < 9; index += 1) {
      const x = PAD + (index % 3) * (CELL + GAP);
      const y = PAD + Math.floor(index / 3) * (CELL + GAP);
      roundedRect(ctx, x, y, CELL, CELL, 9);
      ctx.fillStyle = PALETTE.cream;
      ctx.fill();
      const symbol = card?.grid[index];
      if (symbol) drawSymbol(ctx, this.host.art, symbol, x + CELL / 2, y + CELL / 2, CELL * 0.82);
      if (winning) {
        if (winning.has(index)) {
          roundedRect(ctx, x + 1.5, y + 1.5, CELL - 3, CELL - 3, 8);
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = PALETTE.gold;
          ctx.stroke();
        } else {
          roundedRect(ctx, x, y, CELL, CELL, 9);
          ctx.fillStyle = withAlpha(PALETTE.black, 0.4);
          ctx.fill();
        }
      }
    }
  }
}
