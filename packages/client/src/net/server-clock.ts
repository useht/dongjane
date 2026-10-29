export class ServerClock {
  private offset: number | null = null;
  private lastSeen = Number.NaN;

  constructor(private readonly deviceNow: () => number = Date.now) {}

  observe(serverTime: number): void {
    if (!Number.isFinite(serverTime) || serverTime <= 0 || serverTime === this.lastSeen) return;
    this.lastSeen = serverTime;
    this.offset = serverTime - this.deviceNow();
  }

  now(): number | null {
    return this.offset === null ? null : this.deviceNow() + this.offset;
  }
}
