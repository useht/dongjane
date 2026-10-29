import { ZONE_COOLDOWN_MS, type Zone } from "@dongjane/shared";

export const ZONE_FADE_MS = 400;

// How long until the server will take another zone change from this visitor; 0 when it will.
export function zoneCooldownLeft(nowMs: number, lastRequestMs: number | null): number {
  if (lastRequestMs === null) return 0;
  return Math.max(0, lastRequestMs + ZONE_COOLDOWN_MS - nowMs);
}

export interface TransitionSteps {
  // Black out the screen; resolves once nothing of the old zone can be seen.
  cover(): Promise<void>;
  // Bring the screen back; resolves once it is fully visible again.
  reveal(): Promise<void>;
  // Everything the new zone needs before it can be shown. False when it could not be had.
  prepare(zone: Zone): Promise<boolean>;
  // Swap what is drawn, heard and steered over to the new zone, behind the black.
  apply(zone: Zone): void;
  // Preparing failed: the old zone stays, and the screen is about to come back on it.
  fail(zone: Zone): void;
}

// One zone swap at a time: the screen fades to black, the zone swaps behind it, and the screen fades back.
// A swap that is overtaken (the visitor left the world meanwhile) drops out without touching anything further.
export class ZoneTransition {
  private token = 0;
  private active = false;

  constructor(private readonly steps: TransitionSteps) {}

  get busy(): boolean {
    return this.active;
  }

  // Forgets any swap in flight; its remaining steps never run, and the veil is lifted at once.
  cancel(): void {
    this.token += 1;
    if (!this.active) return;
    this.active = false;
    void this.steps.reveal();
  }

  async run(zone: Zone): Promise<boolean> {
    if (this.active) return false;
    this.active = true;
    const token = ++this.token;
    const current = (): boolean => token === this.token;
    try {
      const [, ready] = await Promise.all([this.steps.cover(), this.steps.prepare(zone).catch(() => false)]);
      if (!current()) return false;
      if (!ready) {
        this.steps.fail(zone);
        await this.steps.reveal();
        return false;
      }
      this.steps.apply(zone);
      await this.steps.reveal();
      return current();
    } finally {
      if (current()) this.active = false;
    }
  }
}
