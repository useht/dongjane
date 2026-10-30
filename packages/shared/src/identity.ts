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

export function visitorTitle(bowCount: number): string | null {
  if (!(bowCount >= 1)) return null;
  if (bowCount < 5) return "초심 수행자";
  if (bowCount < 15) return "정진 수행자";
  if (bowCount < 30) return "도를 닦는 이";
  return "도인";
}
