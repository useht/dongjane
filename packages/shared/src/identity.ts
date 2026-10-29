export function normalizeHue(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const hue = Math.round(raw) % 360;
  return hue < 0 ? hue + 360 : hue;
}

export function randomHue(random: () => number = Math.random): number {
  return Math.floor(random() * 360);
}

export function seatLabel(slot: number): string {
  return `${slot}번 동자`;
}
