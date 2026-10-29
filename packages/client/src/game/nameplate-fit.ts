export interface PlateFit {
  // Horizontal move, in normalized device units, that brings the whole plate back inside the viewport.
  shift: number;
  opacity: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

// ndcX / ndcY locate the plate centre (viewport spans -1..1); halfWidth is the plate's half width in the same units.
export function fitPlate(ndcX: number, ndcY: number, halfWidth: number, edge = 0.03, fadeBand = 0.25): PlateFit {
  const reach = Math.max(0, 1 - edge - halfWidth);
  const shift = clamp(ndcX, -reach, reach) - ndcX;
  const overshoot = Math.max(Math.abs(ndcX), Math.abs(ndcY)) - 1;
  const opacity = overshoot <= 0 ? 1 : clamp(1 - overshoot / fadeBand, 0, 1);
  return { shift, opacity };
}
