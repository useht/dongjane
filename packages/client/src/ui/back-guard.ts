export interface HistoryLike {
  pushState(state: unknown, title: string): void;
  back(): void;
}

export interface PopSource {
  addEventListener(type: "popstate", listener: () => void): void;
}

// Lets the phone's back gesture close the casino panel instead of leaving the game: opening the panel adds a history entry, and
// going back to it is the same as closing. When the panel closes some other way, the entry it added is taken off again.
export class BackGuard {
  private engaged = false;
  // The entry is taken off at the end of the turn that released it, so engaging again in that turn keeps it: a `back()` already
  // on its way would otherwise take off the entry the new engage pushed.
  private dropping = false;
  // popstates still to come from this guard's own `history.back()` calls, which are not the visitor going back.
  private own = 0;

  constructor(
    source: PopSource,
    private readonly history: HistoryLike,
    private readonly onBack: () => void,
  ) {
    source.addEventListener("popstate", this.popped);
  }

  get active(): boolean {
    return this.engaged;
  }

  engage(): void {
    if (this.engaged) return;
    this.engaged = true;
    if (this.dropping) {
      this.dropping = false;
      return;
    }
    this.history.pushState({ casino: true }, "");
  }

  release(): void {
    if (!this.engaged) return;
    this.engaged = false;
    this.dropping = true;
    queueMicrotask(this.drop);
  }

  private readonly drop = (): void => {
    if (!this.dropping) return;
    this.dropping = false;
    this.own += 1;
    this.history.back();
  };

  private readonly popped = (): void => {
    if (this.own > 0) {
      this.own -= 1;
      return;
    }
    if (!this.engaged) return;
    this.engaged = false;
    this.onBack();
  };
}
