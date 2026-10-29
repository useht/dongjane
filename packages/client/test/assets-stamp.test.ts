import { describe, expect, it } from "vitest";
import { inputsHash, modelHashes, readStamp } from "../scripts/asset-stamp.ts";

// The .glb files are build outputs: this fails when a script or game constant changed without
// `pnpm assets` being re-run, or when a model was edited by hand.
describe("asset stamp", () => {
  const stamp = readStamp();

  it("matches the scripts and game data the models were built from", () => {
    expect(stamp.inputsHash, "run `pnpm assets`").toBe(inputsHash());
  });

  it("matches the model files on disk", () => {
    expect(stamp.outputs, "run `pnpm assets`").toEqual(modelHashes());
  });

  it("records the Blender that built them", () => {
    expect(stamp.blender).toMatch(/^Blender \d+\.\d+/);
  });
});
