// Remembers the last knock counter seen per monk so only a counter that changes afterwards counts as a new knock.
export class KnockTracker {
  private readonly seen = new Map<string, number>();

  observe(monkId: string, seq: number): boolean {
    const previous = this.seen.get(monkId);
    this.seen.set(monkId, seq);
    return previous !== undefined && seq > previous;
  }

  forget(monkId: string): void {
    this.seen.delete(monkId);
  }

  reset(): void {
    this.seen.clear();
  }
}
