// Remembers the last hop counter seen per monk so only a counter that changes afterwards triggers a hop.
export class JumpTracker {
  private readonly seen = new Map<string, number>();

  observe(monkId: string, seq: number): boolean {
    const previous = this.seen.get(monkId);
    this.seen.set(monkId, seq);
    return previous !== undefined && previous !== seq;
  }

  forget(monkId: string): void {
    this.seen.delete(monkId);
  }
}
