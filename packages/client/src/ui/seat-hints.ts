import { SEAT_COUNT } from "@dongjane/shared";
import { Hint } from "./hint.ts";

const LOOK = { icon: "sit", label: "여기 앉기" } as const;

// One sit button per seat, floated above it.
export class SeatHints {
  private readonly hints: Hint[];

  constructor(layer: HTMLElement, onSit: (seatId: number) => void) {
    this.hints = Array.from({ length: SEAT_COUNT }, (_, id) => new Hint(layer, LOOK, () => onSit(id)));
  }

  place(id: number, x: number, y: number): void {
    this.hints[id]?.place(x, y);
  }

  seatAt(clientX: number, clientY: number): number | null {
    const id = this.hints.findIndex((hint) => hint.contains(clientX, clientY));
    return id < 0 ? null : id;
  }

  hide(id: number): void {
    this.hints[id]?.hide();
  }

  hideAll(): void {
    for (const hint of this.hints) hint.hide();
  }
}
