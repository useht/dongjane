export function drawIndex(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}
