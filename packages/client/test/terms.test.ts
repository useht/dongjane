import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The service says 월드 and 돗자리. The retired words are spelled in pieces so this file does not trip over itself.
const piece = (...parts: string[]): string => parts.join("");
const RETIRED_KOREAN = [piece("법", "당"), piece("방", "석")];
const RETIRED_ENGLISH = [
  new RegExp(`(?<!s)${piece("ha", "ll")}|${piece("Ha", "ll")}|${piece("HA", "LL")}`),
  new RegExp(`${piece("cus", "hion")}|${piece("Cus", "hion")}|${piece("CUS", "HION")}`),
];

const TEXT = /\.(ts|css|html|py|json|md)$/;
const ROOT = new URL("../../", import.meta.url);

function sources(): string[] {
  const files = ["client/index.html", "client/vite.config.ts"];
  for (const pkg of ["shared", "server", "client"]) {
    for (const directory of ["src", "test", "scripts", "blender"]) {
      let entries: string[];
      try {
        entries = readdirSync(new URL(`${pkg}/${directory}/`, ROOT), { recursive: true, encoding: "utf8" });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = entry.replaceAll("\\", "/");
        if (TEXT.test(path) && !path.includes("node_modules")) files.push(`${pkg}/${directory}/${path}`);
      }
    }
  }
  return files;
}

describe("terms", () => {
  const files = sources();

  it("finds the sources it is meant to guard", () => {
    expect(files).toContain("client/src/app.ts");
    expect(files).toContain("server/src/sim.ts");
    expect(files).toContain("shared/src/layout.ts");
    expect(files).toContain("client/index.html");
    expect(files.length).toBeGreaterThan(60);
  });

  it("says 월드 and 돗자리, never the retired Korean words", () => {
    for (const file of files) {
      const text = readFileSync(new URL(file, ROOT), "utf8");
      for (const word of RETIRED_KOREAN) expect(text.includes(word), `${file} says ${word}`).toBe(false);
    }
  });

  it("uses the new identifiers and file names, never the retired English ones", () => {
    for (const file of files) {
      const text = readFileSync(new URL(file, ROOT), "utf8");
      for (const word of RETIRED_ENGLISH) {
        expect(word.test(text), `${file} contains ${word}`).toBe(false);
        expect(word.test(file), `${file} is named ${word}`).toBe(false);
      }
    }
  });
});
