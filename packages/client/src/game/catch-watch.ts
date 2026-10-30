export interface CatchState {
  catchSeq: number;
  lastCatch: number;
  bite: boolean;
}

export interface CatchReport {
  // The fish (or the empty hook) of a line that came in since the last look; null when none did.
  caught: number | null;
  // A fish took the bait since the last look.
  bitten: boolean;
}

// Tells what happened on the visitor's own line between two looks at the synced state. The first look only learns where the
// counter stands, so entering a world never announces a catch from before.
export class CatchWatcher {
  private seq: number | null = null;
  private biting = false;

  reset(): void {
    this.seq = null;
    this.biting = false;
  }

  observe(state: CatchState): CatchReport {
    const first = this.seq === null;
    const caught = !first && state.catchSeq !== this.seq ? state.lastCatch : null;
    const bitten = !first && state.bite && !this.biting;
    this.seq = state.catchSeq;
    this.biting = state.bite;
    return { caught, bitten };
  }
}
