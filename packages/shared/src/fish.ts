export interface Fish {
  readonly id: number;
  readonly name: string;
  readonly weight: number;
}

// Ids are stable on the wire (Monk.lastCatch); 0 is the empty hook.
export const NO_FISH = 0;
export const FISH: readonly Fish[] = [
  { id: 1, name: "고등어", weight: 45 },
  { id: 2, name: "농어", weight: 25 },
  { id: 3, name: "우럭", weight: 20 },
  { id: 4, name: "숭어", weight: 10 },
];
const TOTAL_WEIGHT = FISH.reduce((sum, fish) => sum + fish.weight, 0);

export function fishById(id: number): Fish | undefined {
  return FISH.find((fish) => fish.id === id);
}

export function pickFish(random: () => number): Fish {
  let pick = random() * TOTAL_WEIGHT;
  for (const fish of FISH) {
    if (pick < fish.weight) return fish;
    pick -= fish.weight;
  }
  return FISH[FISH.length - 1] as Fish;
}
