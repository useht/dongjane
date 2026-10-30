// Once this share of the card's coating is scratched away, the rest comes off by itself.
export const SCRATCH_REVEAL_AT = 0.6;

const LATTICE = 40;

// Which parts of the coating are gone, kept on a coarse lattice over the card so progress costs no pixel reads. Points and radii are
// fractions of the card's width and height (the card is square).
export class ScratchCoverage {
  private readonly cleared = new Uint8Array(LATTICE * LATTICE);
  private count = 0;

  get share(): number {
    return this.count / this.cleared.length;
  }

  get revealed(): boolean {
    return this.share >= SCRATCH_REVEAL_AT;
  }

  dot(x: number, y: number, radius: number): void {
    const low = (value: number) => Math.max(0, Math.floor((value - radius) * LATTICE));
    const high = (value: number) => Math.min(LATTICE - 1, Math.floor((value + radius) * LATTICE));
    for (let row = low(y); row <= high(y); row += 1) {
      for (let column = low(x); column <= high(x); column += 1) {
        const dx = (column + 0.5) / LATTICE - x;
        const dy = (row + 0.5) / LATTICE - y;
        const at = row * LATTICE + column;
        if (dx * dx + dy * dy > radius * radius || this.cleared[at]) continue;
        this.cleared[at] = 1;
        this.count += 1;
      }
    }
  }

  // A stroke from one pointer position to the next, as a run of dots no further apart than a lattice cell.
  stroke(fromX: number, fromY: number, toX: number, toY: number, radius: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) * LATTICE));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      this.dot(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius);
    }
  }

  clearAll(): void {
    this.cleared.fill(1);
    this.count = this.cleared.length;
  }

  reset(): void {
    this.cleared.fill(0);
    this.count = 0;
  }
}
