import { MAX_BET, ROULETTE_MAX_BETS, ROULETTE_POCKETS, type RouletteSpin, canStake, rouletteColor, spinRoulette } from "@dongjane/shared";
import { RouletteSlip, type SlipTarget, targetKey } from "../casino/bets.ts";
import { COLOR_NAMES, formatCoins, formatNet, rouletteLabel, rouletteMultiplier } from "../casino/describe.ts";
import { crossedSymbol } from "../casino/reels.ts";
import { WHEEL_ORDER, WHEEL_SPIN_MS, WHEEL_STEP, ballAt, landingRotation, wheelRotation } from "../casino/wheel.ts";
import { withAlpha } from "../theme.ts";
import { ChipPicker, FrameLoop, type GameHost, type MachineView, PALETTE, type SpinButton, canvasFont, prepareCanvas, spinButton } from "./casino-kit.ts";
import { button, h } from "./dom.ts";

const SIZE = 280;
const CENTER = SIZE / 2;
const RIM = 132;
const TRACK_OUTER = 122;
const TRACK_INNER = 98;
const POCKET_INNER = 66;
const HUB = 58;
const BALL_RADIUS = 6;
const FULL_TURNS = 3;

const OUTSIDE: readonly SlipTarget[] = [{ kind: "red" }, { kind: "black" }, { kind: "odd" }, { kind: "even" }, { kind: "low" }, { kind: "high" }];
const DOZENS: readonly SlipTarget[] = [
  { kind: "dozen", pick: 1 },
  { kind: "dozen", pick: 2 },
  { kind: "dozen", pick: 3 },
];

interface Run {
  spin: RouletteSpin;
  startedAt: number | null;
  from: number;
  to: number;
}

const pocketFill = (pocket: number): string => {
  const color = rouletteColor(pocket);
  return color === "red" ? PALETTE.red : color === "black" ? PALETTE.black : PALETTE.felt;
};

// A roulette table: the wheel on a canvas, the places to put chips, and the slip of what is laid.
export class RouletteView implements MachineView {
  readonly root = h("div", "casino-view casino-roulette");
  private readonly canvas = h("canvas", "casino-canvas casino-wheel");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly wheelFace: HTMLCanvasElement;
  private readonly slip = new RouletteSlip();
  private readonly places = new Map<string, { node: HTMLButtonElement; stack: HTMLElement; target: SlipTarget }>();
  private readonly chips: ChipPicker;
  private readonly spinner: SpinButton;
  private readonly undo: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly headline = h("strong", "casino-headline");
  private readonly verdict = h("p", "casino-verdict");
  private readonly lines = h("ul", "casino-lines");
  private readonly note = h("p", "casino-note");
  private readonly summary = h("span", "casino-slip-total");
  private readonly loop = new FrameLoop((now) => this.step(now));
  private rotation = 0;
  private ballAngle = 0;
  private ballDrop = 0;
  private ballShown = false;
  private run: Run | null = null;
  private last: RouletteSpin | null = null;

  constructor(private readonly host: GameHost) {
    this.ctx = prepareCanvas(this.canvas, SIZE, SIZE);
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "룰렛 바퀴");
    this.wheelFace = this.drawWheelFace();
    this.chips = new ChipPicker(host.sounds, () => this.refresh());
    this.spinner = spinButton(() => this.spin());
    this.undo = button("되돌리기", "casino-small", () => this.take(() => this.slip.undo()));
    this.clear = button("모두 치우기", "casino-small", () => this.take(() => (this.slip.clear(), true)));

    const outside = h("div", "casino-outside");
    for (const target of OUTSIDE) outside.append(this.place(target, rouletteLabel(target)));
    const dozens = h("div", "casino-dozens");
    for (const target of DOZENS) dozens.append(this.place(target, rouletteLabel(target)));
    const numbers = h("div", "casino-numbers");
    for (let pocket = 0; pocket < ROULETTE_POCKETS; pocket += 1) {
      const node = this.place({ kind: "straight", pick: pocket }, String(pocket));
      node.classList.add("number", rouletteColor(pocket));
      if (pocket === 0) node.classList.add("zero");
      numbers.append(node);
    }
    const table = h("div", "casino-table", outside, dozens, numbers);
    const result = h("div", "casino-result", this.headline, this.verdict, this.lines);
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    this.note.setAttribute("role", "status");
    this.note.setAttribute("aria-live", "polite");
    const slip = h("div", "casino-slip", this.summary, h("span", "casino-slip-tools", this.undo, this.clear));
    this.root.append(h("div", "casino-frame", this.canvas), result, table, h("div", "casino-actions", slip, this.note, this.chips.root, this.spinner.node));
    this.headline.textContent = "칸을 눌러 판돈을 걸어 보세요";
    this.paint();
  }

  get busy(): boolean {
    return this.run !== null;
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.slip.fit(this.host.bank.wallet);
    this.refresh();
    this.paint();
  }

  hide(): void {
    if (this.run) this.land(false);
    this.loop.stop();
    this.root.classList.add("hidden");
  }

  redraw(): void {
    this.paint();
  }

  refresh(): void {
    const wallet = this.host.bank.wallet;
    const locked = this.busy;
    this.chips.update(wallet, locked, this.slip.stake);
    for (const { node, stack, target } of this.places.values()) {
      const amount = this.slip.amountOn(target);
      stack.textContent = amount > 0 ? String(amount) : "";
      node.classList.toggle("laid", amount > 0);
      node.disabled = locked;
      node.setAttribute("aria-label", this.placeLabel(target, amount));
    }
    this.undo.disabled = locked || this.slip.empty;
    this.clear.disabled = locked || this.slip.empty;
    this.summary.textContent = this.slip.empty ? "걸린 엽전 없음" : `걸린 엽전 ${formatCoins(this.slip.stake)} · ${this.slip.count}곳`;
    const ready = !locked && this.slip.canSpin(wallet);
    this.spinner.set("룰렛 돌리기", this.slip.empty ? "먼저 판돈을 걸어 주세요" : formatCoins(this.slip.stake), ready);
  }

  spin(): void {
    if (this.run || this.root.classList.contains("hidden")) return;
    if (!this.host.prepareSpin()) {
      this.slip.fit(this.host.bank.wallet);
      this.refresh();
      return;
    }
    this.slip.fit(this.host.bank.wallet);
    if (!this.slip.canSpin(this.host.bank.wallet)) {
      this.note.textContent = this.slip.empty ? "먼저 칸을 눌러 판돈을 걸어 주세요." : "엽전이 모자라요.";
      this.refresh();
      return;
    }
    const spin = spinRoulette(this.slip.bets, () => this.host.random());
    if (!this.host.bank.settle({ stake: spin.stake, payout: spin.payout })) {
      this.refresh();
      return;
    }
    this.host.sounds.click();
    this.last = null;
    this.note.textContent = "";
    this.clearHits();
    this.root.classList.remove("win", "lose");
    this.headline.textContent = "돌리는 중…";
    delete this.headline.dataset.color;
    this.verdict.textContent = "";
    this.lines.replaceChildren();
    const from = this.rotation;
    this.run = { spin, startedAt: null, from, to: landingRotation(from, spin.number, this.host.reduceMotion() ? 0 : FULL_TURNS) };
    this.ballShown = true;
    this.refresh();
    if (this.host.reduceMotion()) {
      this.land(true);
      return;
    }
    this.canvas.scrollIntoView({ block: "nearest" });
    this.loop.start();
  }

  private place(target: SlipTarget, text: string): HTMLButtonElement {
    const stack = h("span", "casino-stack");
    const node = h("button", "casino-place", h("span", "casino-place-label", text), stack);
    node.type = "button";
    node.addEventListener("click", (event) => {
      if (event.detail > 0) node.blur();
      this.lay(target);
    });
    this.places.set(targetKey(target), { node, stack, target });
    return node;
  }

  private placeLabel(target: SlipTarget, amount: number): string {
    const name = target.kind === "straight" ? `${target.pick}번` : rouletteLabel(target);
    const pay = `${rouletteMultiplier(target)}배`;
    return amount > 0 ? `${name}, ${pay}, 걸린 엽전 ${amount}` : `${name}, ${pay}`;
  }

  private lay(target: SlipTarget): void {
    if (this.run) return;
    const chip = this.chips.selected;
    const wallet = this.host.bank.wallet;
    if (chip === 0) {
      this.note.textContent = "엽전이 모자라요.";
    } else if (this.slip.add(target, chip, wallet)) {
      this.host.sounds.click();
      this.clearHits();
      this.note.textContent = "";
    } else {
      this.note.textContent = this.refusal(target, chip);
    }
    this.refresh();
  }

  private take(change: () => boolean): void {
    if (this.run) return;
    if (change()) {
      this.host.sounds.click();
      this.clearHits();
    }
    this.note.textContent = "";
    this.refresh();
  }

  private clearHits(): void {
    for (const { node } of this.places.values()) node.classList.remove("hit");
  }

  // Why a chip was turned away, in words. The rules themselves are the slip's (and the shared ones behind it).
  private refusal(target: SlipTarget, chip: number): string {
    if (this.slip.amountOn(target) === 0 && this.slip.count >= ROULETTE_MAX_BETS) return `한 번에 ${ROULETTE_MAX_BETS}곳까지 걸 수 있어요.`;
    if (this.slip.amountOn(target) + chip > MAX_BET) return `한 곳에는 ${formatCoins(MAX_BET)}까지 걸 수 있어요.`;
    if (!canStake(this.host.bank.wallet, this.slip.stake + chip)) return "엽전이 모자라요.";
    return "여기에는 더 걸 수 없어요.";
  }

  private step(now: number): boolean {
    const run = this.run;
    if (!run) return false;
    run.startedAt ??= now;
    const elapsed = now - run.startedAt;
    const before = this.rotation;
    this.rotation = wheelRotation(run.from, run.to, elapsed, WHEEL_SPIN_MS);
    const ball = ballAt(elapsed, WHEEL_SPIN_MS);
    this.ballAngle = ball.angle;
    this.ballDrop = ball.drop;
    if (elapsed < WHEEL_SPIN_MS && crossedSymbol(before / WHEEL_STEP, this.rotation / WHEEL_STEP)) this.host.sounds.tick();
    if (elapsed >= WHEEL_SPIN_MS) {
      this.land(true);
      return false;
    }
    this.paint();
    return true;
  }

  // The ball is in its pocket: the result goes on show and the coins are counted.
  private land(sound: boolean): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.loop.stop();
    const { spin } = run;
    this.rotation = run.to % (Math.PI * 2);
    this.ballAngle = 0;
    this.ballDrop = 0;
    this.last = spin;
    const hits = new Set(spin.results.filter((entry) => entry.win).map((entry) => targetKey(entry.bet)));
    for (const [key, { node }] of this.places) node.classList.toggle("hit", hits.has(key));
    const anyWin = spin.results.some((entry) => entry.win);
    this.headline.textContent = `${spin.number}번 ${COLOR_NAMES[spin.color]}`;
    this.headline.dataset.color = spin.color;
    this.verdict.textContent = spin.net > 0 ? `당첨! ${formatNet(spin.net)}` : anyWin ? `${formatNet(spin.net)} (일부 당첨)` : "아쉬워요, 꽝";
    this.lines.replaceChildren(
      ...spin.results.map((entry) => h("li", entry.win ? "won" : "", `${rouletteLabel(entry.bet)} ${formatCoins(entry.bet.amount)} → ${entry.win ? "당첨" : "꽝"} ${formatNet(entry.net)}`)),
    );
    this.root.classList.toggle("win", spin.payout > 0);
    this.root.classList.toggle("lose", spin.payout === 0);
    if (sound) {
      this.host.sounds.stop();
      if (spin.results.some((entry) => entry.win && entry.bet.kind === "straight")) this.host.sounds.jackpot();
      else if (spin.payout > 0) this.host.sounds.coin();
    }
    this.host.syncBalance();
    this.slip.fit(this.host.bank.wallet);
    this.refresh();
    this.paint();
  }

  // The pockets, their numbers and the hub, painted once at rest (zero at the top) and turned as a picture afterwards.
  private drawWheelFace(): HTMLCanvasElement {
    const face = document.createElement("canvas");
    const ctx = prepareCanvas(face, SIZE, SIZE);
    ctx.translate(CENTER, CENTER);
    WHEEL_ORDER.forEach((pocket, index) => {
      const middle = index * WHEEL_STEP - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(0, 0, TRACK_INNER, middle - WHEEL_STEP / 2, middle + WHEEL_STEP / 2);
      ctx.arc(0, 0, POCKET_INNER, middle + WHEEL_STEP / 2, middle - WHEEL_STEP / 2, true);
      ctx.closePath();
      ctx.fillStyle = pocketFill(pocket);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(PALETTE.goldPale, 0.7);
      ctx.stroke();
    });
    ctx.font = canvasFont(800, 11);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.cream;
    WHEEL_ORDER.forEach((pocket, index) => {
      ctx.save();
      ctx.rotate(index * WHEEL_STEP);
      ctx.fillText(String(pocket), 0, -(TRACK_INNER + POCKET_INNER) / 2);
      ctx.restore();
    });
    const hub = ctx.createRadialGradient(-12, -12, 4, 0, 0, HUB);
    hub.addColorStop(0, PALETTE.goldPale);
    hub.addColorStop(1, PALETTE.goldDeep);
    ctx.beginPath();
    ctx.arc(0, 0, HUB, 0, Math.PI * 2);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.redDeep;
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.strokeStyle = PALETTE.redDeep;
    for (const turn of [0, Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(Math.sin(turn) * 36, -Math.cos(turn) * 36);
      ctx.lineTo(-Math.sin(turn) * 36, Math.cos(turn) * 36);
      ctx.stroke();
    }
    return face;
  }

  private paint(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.translate(CENTER, CENTER);

    ctx.beginPath();
    ctx.arc(0, 0, RIM, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.redDeep;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.goldDeep;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, TRACK_OUTER, 0, Math.PI * 2);
    ctx.arc(0, 0, TRACK_INNER, 0, Math.PI * 2, true);
    ctx.fillStyle = PALETTE.black;
    ctx.fill();

    ctx.save();
    ctx.rotate(this.rotation);
    ctx.drawImage(this.wheelFace, -CENTER, -CENTER, SIZE, SIZE);
    ctx.restore();

    if (this.ballShown) {
      const pocketRadius = (TRACK_INNER + POCKET_INNER) / 2;
      const radius = pocketRadius + (TRACK_OUTER - BALL_RADIUS - 2 - pocketRadius) * this.ballDrop;
      const x = Math.sin(this.ballAngle) * radius;
      const y = -Math.cos(this.ballAngle) * radius;
      const shine = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, BALL_RADIUS);
      shine.addColorStop(0, PALETTE.cream);
      shine.addColorStop(1, PALETTE.goldPale);
      ctx.beginPath();
      ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = shine;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(PALETTE.black, 0.6);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(-9, -RIM - 6);
    ctx.lineTo(9, -RIM - 6);
    ctx.lineTo(0, -TRACK_OUTER + 4);
    ctx.closePath();
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE.ink;
    ctx.stroke();
    ctx.restore();
  }
}
