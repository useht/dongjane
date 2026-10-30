import { SLOT_LAYOUT, SLOT_STRIPS, type SlotKind, type SlotSpin, spinSlot } from "@dongjane/shared";
import { describeSlotSpin, formatCoins } from "../casino/describe.ts";
import { crossedSymbol, reelPosition, reelSchedule, reelTravel, visibleRows, windowAt } from "../casino/reels.ts";
import { withAlpha } from "../theme.ts";
import { ChipPicker, FrameLoop, type GameHost, type MachineView, PALETTE, type SpinButton, canvasFont, drawSymbol, prepareCanvas, roundedRect, spinButton } from "./casino-kit.ts";
import { h } from "./dom.ts";

const JACKPOT_FLASH_MS = 2400;

interface Geometry {
  width: number;
  height: number;
  cell: number;
  gap: number;
  // Room left and right of the reels for the payline marks, and above and below them.
  side: number;
  pad: number;
}

function geometryFor(kind: SlotKind): Geometry {
  const { reels, lines } = SLOT_LAYOUT[kind];
  const rows = Math.max(...lines) + 1;
  const [cell, gap, side, pad] = reels > 3 ? [58, 6, 20, 14] : [92, 10, 22, 14];
  return { width: side * 2 + reels * cell + (reels - 1) * gap, height: pad * 2 + rows * cell, cell, gap, side, pad };
}

interface Run {
  spin: SlotSpin;
  startedAt: number | null;
  from: number[];
  travel: number[];
  schedule: number[];
  stopped: boolean[];
}

// A slot machine's screen: the reels on a canvas, then the result, the chips and the spin button.
export class SlotsView implements MachineView {
  readonly root = h("div", "casino-view casino-slots");
  private readonly geo: Geometry;
  private readonly rows: number;
  private readonly reels: number;
  private readonly canvas = h("canvas", "casino-canvas casino-reels");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly headline = h("strong", "casino-headline");
  private readonly lines = h("ul", "casino-lines");
  private readonly tally = h("p", "casino-tally");
  private readonly chips: ChipPicker;
  private readonly spinner: SpinButton;
  private readonly loop = new FrameLoop((now) => this.step(now));
  private positions: number[];
  private run: Run | null = null;
  private last: SlotSpin | null = null;
  private cells = new Set<string>();
  private paying = new Set<number>();
  private jackpotTimer = 0;

  constructor(
    private readonly host: GameHost,
    private readonly kind: SlotKind,
  ) {
    this.geo = geometryFor(kind);
    this.rows = visibleRows(kind);
    this.reels = SLOT_LAYOUT[kind].reels;
    this.ctx = prepareCanvas(this.canvas, this.geo.width, this.geo.height);
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "슬롯 릴");
    this.positions = Array.from({ length: this.reels }, () => Math.floor(host.random() * SLOT_STRIPS[kind].length));
    this.chips = new ChipPicker(host.sounds, () => this.refresh());
    this.spinner = spinButton(() => this.spin());
    const result = h("div", "casino-result", this.headline, this.lines, this.tally);
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    const frame = h("div", "casino-frame", this.canvas, h("div", "casino-flash"));
    this.root.append(frame, result, h("div", "casino-actions", this.chips.root, this.spinner.node));
    this.headline.textContent = "판돈을 고르고 돌려 보세요";
    this.paint(0);
  }

  get busy(): boolean {
    return this.run !== null;
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.refresh();
    if (this.last && this.last.wins.length > 0 && !this.host.reduceMotion()) this.loop.start();
  }

  hide(): void {
    if (this.run) this.land(false);
    this.clearFlash();
    this.loop.stop();
    this.root.classList.add("hidden");
  }

  refresh(): void {
    const wallet = this.host.bank.wallet;
    this.chips.update(wallet, this.busy);
    const bet = this.chips.selected;
    const ready = !this.busy && bet > 0 && this.host.bank.canBet(bet);
    this.spinner.set("돌리기", bet > 0 ? formatCoins(bet) : "엽전이 부족해요", ready);
  }

  redraw(): void {
    this.paint(performance.now());
  }

  spin(): void {
    if (this.run || this.root.classList.contains("hidden")) return;
    if (!this.host.prepareSpin()) {
      this.refresh();
      return;
    }
    const bet = this.chips.selected;
    if (bet === 0 || !this.host.bank.canBet(bet)) {
      this.refresh();
      return;
    }
    const spin = spinSlot(this.kind, bet, () => this.host.random());
    if (!this.host.bank.settle({ stake: spin.stake, payout: spin.payout })) {
      this.refresh();
      return;
    }
    this.clearFlash();
    this.last = null;
    this.cells = new Set();
    this.paying = new Set();
    this.host.sounds.click();
    const length = SLOT_STRIPS[this.kind].length;
    const schedule = reelSchedule(this.kind, this.host.reduceMotion());
    const from = this.positions.map((position) => Math.round(position) % length);
    this.run = {
      spin,
      startedAt: null,
      from,
      travel: from.map((start, reel) => reelTravel(start, (spin.stops[reel] ?? 0) % length, length, schedule[reel] ?? 0)),
      schedule,
      stopped: schedule.map(() => false),
    };
    this.headline.textContent = "돌리는 중…";
    this.lines.replaceChildren();
    this.tally.textContent = "";
    this.root.classList.remove("win", "lose", "jackpot");
    this.refresh();
    if (this.host.reduceMotion()) this.land(true);
    else this.loop.start();
  }

  private step(now: number): boolean {
    const run = this.run;
    if (run) {
      run.startedAt ??= now;
      const elapsed = now - run.startedAt;
      let ticked = false;
      for (let reel = 0; reel < this.reels; reel += 1) {
        const stopAt = run.schedule[reel] ?? 0;
        const before = this.positions[reel] ?? 0;
        const after = reelPosition(run.from[reel] ?? 0, run.travel[reel] ?? 0, elapsed, stopAt);
        if (elapsed < stopAt && crossedSymbol(before, after)) ticked = true;
        if (!run.stopped[reel] && elapsed >= stopAt) {
          run.stopped[reel] = true;
          this.host.sounds.stop();
        }
        this.positions[reel] = after;
      }
      if (ticked) this.host.sounds.tick();
      if (run.stopped.every(Boolean)) this.land(true);
      else this.paint(now);
    }
    if (!this.run && this.last && this.last.wins.length > 0 && !this.host.reduceMotion()) {
      this.paint(now);
      return true;
    }
    return this.run !== null;
  }

  // The reels are down: the result goes on show and the coins are counted.
  private land(sound: boolean): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    const { spin } = run;
    const length = SLOT_STRIPS[this.kind].length;
    this.positions = this.positions.map((_, reel) => (spin.stops[reel] ?? 0) % length);
    this.last = spin;
    const lines = SLOT_LAYOUT[this.kind].lines;
    for (const win of spin.wins) {
      const row = lines[win.line] ?? win.line;
      this.paying.add(row);
      for (const reel of win.reels) this.cells.add(`${reel}:${row}`);
    }
    const text = describeSlotSpin(spin);
    this.headline.textContent = text.headline;
    this.lines.replaceChildren(...text.lines.map((line) => h("li", "", line)));
    this.tally.textContent = `판돈 ${formatCoins(spin.stake)} · 받은 돈 ${formatCoins(spin.payout)}`;
    this.root.classList.toggle("win", spin.payout > 0);
    this.root.classList.toggle("lose", spin.payout === 0);
    this.root.classList.toggle("jackpot", spin.jackpot);
    if (spin.jackpot) this.jackpotTimer = window.setTimeout(() => this.clearFlash(), JACKPOT_FLASH_MS);
    if (sound) {
      if (spin.jackpot) this.host.sounds.jackpot();
      else if (spin.payout > 0) this.host.sounds.coin();
    }
    this.host.syncBalance();
    this.refresh();
    this.paint(performance.now());
    if (spin.wins.length > 0 && !this.host.reduceMotion()) this.loop.start();
    else this.loop.stop();
  }

  private clearFlash(): void {
    window.clearTimeout(this.jackpotTimer);
    this.jackpotTimer = 0;
    this.root.classList.remove("jackpot");
  }

  private paint(now: number): void {
    const { ctx, geo } = this;
    const { width, height, cell, gap, side, pad } = geo;
    const settled = this.run === null && this.last !== null;
    const winning = settled && this.cells.size > 0;
    const pulse = this.host.reduceMotion() ? 1 : 0.7 + 0.3 * Math.sin(now / 150);
    ctx.clearRect(0, 0, width, height);

    roundedRect(ctx, 1.5, 1.5, width - 3, height - 3, 16);
    ctx.fillStyle = PALETTE.redDeep;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.goldDeep;
    ctx.stroke();

    const rowCenter = (row: number): number => pad + row * cell + cell / 2;
    const rowsOnLine = SLOT_LAYOUT[this.kind].lines;
    ctx.font = canvasFont(800, 10);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    rowsOnLine.forEach((row, index) => {
      const y = rowCenter(row);
      const paid = winning && this.paying.has(row);
      ctx.fillStyle = paid ? PALETTE.gold : withAlpha(PALETTE.goldPale, 0.55);
      for (const left of [true, false]) {
        const edge = left ? 5 : width - 5;
        const dir = left ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(edge, y - 7);
        ctx.lineTo(edge + dir * 11, y);
        ctx.lineTo(edge, y + 7);
        ctx.closePath();
        ctx.fill();
      }
      if (this.rows > 1) {
        ctx.fillStyle = paid ? PALETTE.ink : PALETTE.redDeep;
        ctx.fillText(String(index + 1), 9, y);
        ctx.fillText(String(index + 1), width - 9, y);
      }
    });

    for (let reel = 0; reel < this.reels; reel += 1) {
      const x = side + reel * (cell + gap);
      const view = windowAt(this.kind, this.positions[reel] ?? 0, this.rows);
      ctx.save();
      roundedRect(ctx, x, pad, cell, this.rows * cell, 8);
      ctx.clip();
      ctx.fillStyle = PALETTE.cream;
      ctx.fillRect(x, pad, cell, this.rows * cell);
      view.symbols.forEach((symbol, row) => {
        const top = pad + (row - view.offset) * cell;
        if (row > 0) {
          ctx.fillStyle = withAlpha(PALETTE.ink, 0.1);
          ctx.fillRect(x + 6, top - 0.5, cell - 12, 1);
        }
        drawSymbol(ctx, this.host.art, symbol, x + cell / 2, top + cell / 2, cell * 0.8);
      });
      const shade = ctx.createLinearGradient(0, pad, 0, pad + this.rows * cell);
      const strength = this.run ? 0.34 : 0.16;
      shade.addColorStop(0, withAlpha(PALETTE.black, strength));
      shade.addColorStop(0.28, withAlpha(PALETTE.black, 0));
      shade.addColorStop(0.72, withAlpha(PALETTE.black, 0));
      shade.addColorStop(1, withAlpha(PALETTE.black, strength));
      ctx.fillStyle = shade;
      ctx.fillRect(x, pad, cell, this.rows * cell);
      ctx.restore();
    }

    for (const row of rowsOnLine) {
      const y = rowCenter(row);
      const paid = winning && this.paying.has(row);
      ctx.fillStyle = paid ? withAlpha(PALETTE.gold, 0.9 * pulse) : withAlpha(PALETTE.red, this.rows > 1 ? 0.35 : 0.55);
      ctx.fillRect(side - 6, y - (paid ? 1.5 : 1), width - (side - 6) * 2, paid ? 3 : 2);
    }

    if (winning) {
      for (let reel = 0; reel < this.reels; reel += 1) {
        const x = side + reel * (cell + gap);
        for (let row = 0; row < this.rows; row += 1) {
          const y = pad + row * cell;
          if (this.cells.has(`${reel}:${row}`)) {
            roundedRect(ctx, x + 2, y + 2, cell - 4, cell - 4, 7);
            ctx.lineWidth = 3;
            ctx.strokeStyle = withAlpha(PALETTE.gold, pulse);
            ctx.stroke();
          } else {
            ctx.fillStyle = withAlpha(PALETTE.black, 0.4);
            ctx.fillRect(x, y, cell, cell);
          }
        }
      }
    }
  }
}
