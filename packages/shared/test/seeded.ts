export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

// A source that answers each draw with the middle of the given cell out of `size`, then falls back to `rest`.
export function cells(picks: readonly number[], size: number, rest: () => number = () => 0.5): () => number {
  let next = 0;
  return () => (next < picks.length ? ((picks[next++] as number) + 0.5) / size : rest());
}
