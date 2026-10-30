import { describe, expect, it } from "vitest";
import { NPC_PER_ZONE } from "../src/constants.ts";
import { ZONES } from "../src/layout.ts";
import { type Persona, generatePersona } from "../src/persona.ts";
import { TempleSim } from "../src/sim.ts";

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % 4294967296) / 4294967296;
  };
}

const RANGES: Record<keyof Persona, readonly [number, number]> = {
  devotion: [0.3, 1],
  restless: [0.2, 0.9],
  sociability: [0.1, 0.9],
  shyness: [0.1, 0.9],
  frontRow: [0, 1],
};

describe("generatePersona", () => {
  it("keeps every trait inside its range", () => {
    const random = seededRandom(1);
    for (let n = 0; n < 500; n += 1) {
      const persona = generatePersona(random);
      for (const [trait, [low, high]] of Object.entries(RANGES)) {
        const value = persona[trait as keyof Persona];
        expect(value).toBeGreaterThanOrEqual(low);
        expect(value).toBeLessThanOrEqual(high);
      }
    }
  });

  it("reaches both ends of each trait", () => {
    const random = seededRandom(2);
    const personas = Array.from({ length: 500 }, () => generatePersona(random));
    for (const [trait, [low, high]] of Object.entries(RANGES)) {
      const values = personas.map((persona) => persona[trait as keyof Persona]);
      const margin = (high - low) * 0.1;
      expect(Math.min(...values)).toBeLessThan(low + margin);
      expect(Math.max(...values)).toBeGreaterThan(high - margin);
    }
  });

  it("draws devotion, restless, sociability, shyness and frontRow in that order", () => {
    const draws = [0, 0.25, 0.5, 0.75, 1];
    const persona = generatePersona(() => draws.shift() ?? Number.NaN);
    expect(draws).toEqual([]);
    expect(persona.devotion).toBeCloseTo(0.3);
    expect(persona.restless).toBeCloseTo(0.375);
    expect(persona.sociability).toBeCloseTo(0.5);
    expect(persona.shyness).toBeCloseTo(0.7);
    expect(persona.frontRow).toBe(1);
  });

  it("gives the same persona for the same seed and another one for a different seed", () => {
    expect(generatePersona(seededRandom(8))).toEqual(generatePersona(seededRandom(8)));
    expect(generatePersona(seededRandom(8))).not.toEqual(generatePersona(seededRandom(9)));
  });
});

const NPC_COUNT = NPC_PER_ZONE * ZONES.length;

describe("npc personas in the sim", () => {
  it("gives each of the world's npcs its own persona, repeatably", () => {
    const personasFor = (seed: number) => {
      const sim = new TempleSim({ clock: () => 0, random: seededRandom(seed), npcCount: NPC_PER_ZONE });
      return Array.from({ length: NPC_COUNT }, (_, n) => sim.personaOf(`npc-${n + 1}`));
    };

    const personas = personasFor(3);
    expect(personas.every((persona) => persona !== undefined)).toBe(true);
    expect(new Set(personas.map((persona) => JSON.stringify(persona))).size).toBe(NPC_COUNT);
    expect(personasFor(3)).toEqual(personas);
    expect(personasFor(4)).not.toEqual(personas);
  });

  it("uses the personas handed in for the first npcs and generates the rest", () => {
    const loner: Persona = { devotion: 1, restless: 0.2, sociability: 0.1, shyness: 0.9, frontRow: 0 };
    const greeter: Persona = { devotion: 0.3, restless: 0.9, sociability: 0.9, shyness: 0.1, frontRow: 1 };
    const sim = new TempleSim({
      clock: () => 0,
      random: seededRandom(5),
      npcCount: 3,
      personas: [loner, greeter],
    });
    sim.join("guest", 0);

    expect(sim.personaOf("npc-1")).toBe(loner);
    expect(sim.personaOf("npc-2")).toBe(greeter);
    const third = sim.personaOf("npc-3");
    expect(third).toBeDefined();
    expect(third).not.toEqual(loner);
    expect(third).not.toEqual(greeter);
    expect(sim.personaOf("guest")).toBeUndefined();
    expect(sim.personaOf("nobody")).toBeUndefined();
  });
});
