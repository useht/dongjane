export const EMOTE_SHOW_MS = 4000;

export interface ActiveEmote {
  monkId: string;
  emote: number;
  shownAt: number;
}

// Remembers the last emoticon counter seen per monk so only a counter that changes afterwards raises a bubble.
export class EmoteTracker {
  private readonly seen = new Map<string, number>();
  private readonly shown = new Map<string, ActiveEmote>();

  observe(monkId: string, seq: number, emote: number, nowMs: number): boolean {
    const previous = this.seen.get(monkId);
    this.seen.set(monkId, seq);
    if (previous === undefined || previous === seq) return false;
    this.shown.set(monkId, { monkId, emote, shownAt: nowMs });
    return true;
  }

  active(nowMs: number): IterableIterator<ActiveEmote> {
    for (const [id, entry] of this.shown) {
      if (nowMs - entry.shownAt >= EMOTE_SHOW_MS) this.shown.delete(id);
    }
    return this.shown.values();
  }

  forget(monkId: string): void {
    this.seen.delete(monkId);
    this.shown.delete(monkId);
  }
}
