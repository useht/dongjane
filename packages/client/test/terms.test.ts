import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The service says 월드, with 갓바위 (돗자리) outdoors and 법당 (방석) indoors; the code says zone and seat for both.
// The retired English words are spelled in pieces so this file does not trip over itself.
const piece = (...parts: string[]): string => parts.join("");
const RETIRED_ENGLISH = [
  new RegExp(`(?<!s)${piece("ha", "ll")}|${piece("Ha", "ll")}|${piece("HA", "LL")}`),
  new RegExp(`${piece("cus", "hion")}|${piece("Cus", "hion")}|${piece("CUS", "HION")}`),
  new RegExp(`${piece("mat", "Id")}|${piece("MAT", "_SPOTS")}|${piece("MAT", "_SIZE")}|${piece("MAT", "_COUNT")}|${piece("SPAWN", "_POINT")}`),
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
    expect(files).toContain("shared/src/sim.ts");
    expect(files).toContain("shared/src/layout.ts");
    expect(files).toContain("client/index.html");
    expect(files.length).toBeGreaterThan(60);
  });

  it("names both zones and both kinds of seat in the shared layout", () => {
    const layout = readFileSync(new URL("shared/src/layout.ts", ROOT), "utf8");
    for (const word of ["갓바위", "법당", "돗자리", "방석"]) expect(layout.includes(word), `layout says ${word}`).toBe(true);
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
