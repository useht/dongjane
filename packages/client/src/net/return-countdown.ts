const TICK_MS = 1000;

export class ReturnCountdown {
  private timer: ReturnType<typeof setInterval> | null = null;
  private deadline = 0;

  constructor(
    private readonly onTick: (secondsLeft: number) => void,
    private readonly onDone: () => void,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(seconds: number): void {
    this.cancel();
    this.deadline = Date.now() + seconds * 1000;
    this.onTick(seconds);
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  cancel(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private step(): void {
    const left = Math.round((this.deadline - Date.now()) / 1000);
    if (left > 0) {
      this.onTick(left);
      return;
    }
    this.cancel();
    this.onDone();
  }
}
