interface ScreenLock {
  readonly released: boolean;
  release(): Promise<void>;
}

interface ScreenWakeLocks {
  request(type: "screen"): Promise<ScreenLock>;
}

function browserWakeLocks(): ScreenWakeLocks | undefined {
  const scope = globalThis as unknown as { navigator?: { wakeLock?: ScreenWakeLocks } };
  return scope.navigator?.wakeLock;
}

// iPhone Safari suspends a page's sound when the screen locks, so the screen stays awake while the 법당 video plays.
// `set(true)` is repeated from a timer: it asks again if the browser took the lock back.
export class ScreenHold {
  private lock: ScreenLock | null = null;
  private wanted = false;
  private asking = false;

  constructor(private readonly locks: () => ScreenWakeLocks | undefined = browserWakeLocks) {}

  set(on: boolean): void {
    this.wanted = on;
    if (!on) {
      const lock = this.lock;
      this.lock = null;
      if (lock) void lock.release().catch(() => undefined);
      return;
    }
    if (this.lock && !this.lock.released) return;
    this.lock = null;
    const locks = this.locks();
    if (!locks || this.asking) return;
    this.asking = true;
    locks
      .request("screen")
      .then(
        (lock) => {
          if (this.wanted) this.lock = lock;
          else void lock.release().catch(() => undefined);
        },
        () => undefined,
      )
      .finally(() => {
        this.asking = false;
      });
  }
}
