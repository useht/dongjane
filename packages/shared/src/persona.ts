export interface Persona {
  readonly devotion: number;
  readonly restless: number;
  readonly sociability: number;
  readonly shyness: number;
  readonly frontRow: number;
}

export function generatePersona(random: () => number): Persona {
  return {
    devotion: 0.3 + random() * 0.7,
    restless: 0.2 + random() * 0.7,
    sociability: 0.1 + random() * 0.8,
    shyness: 0.1 + random() * 0.8,
    frontRow: random(),
  };
}
