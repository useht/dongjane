import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_DIR, assetInputs, buddhaSource } from "../scripts/asset-inputs.ts";
import { fileHash, inputsHash, modelHashes, readStamp } from "../scripts/asset-stamp.ts";

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

// The Buddha is made from a scan this repository carries (or fetches, when it is too big to carry) with its licence beside it.
describe("the Buddha's source", () => {
  const source = buddhaSource();

  it("names its page, author and licence, with the replica notice the museum gives", () => {
    for (const field of [source.title, source.url, source.author, source.licence, source.licenceKind, source.replicaNotice]) {
      expect(field.trim()).not.toBe("");
    }
    expect(source.url.startsWith("https://")).toBe(true);
    expect(source.licenceKind).toContain("출처표시");
    expect(source.licence).toContain("출처표시");
    expect(source.replicaNotice).toContain("복제품");
  });

  it("is the file committed beside source.json, whose sha256 the stamp is built on", () => {
    expect(statSync(new URL(source.file, SOURCE_DIR)).size, "a source over 25 MB is fetched, not committed").toBeLessThanOrEqual(25_000_000);
    expect(fileHash(new URL(source.file, SOURCE_DIR))).toBe(source.sha256);
    expect(assetInputs().buddha.sha256).toBe(source.sha256);
  });

  it("brings the material file and the picture it names, each as described", () => {
    expect(Object.keys(source.companions).sort()).toEqual(["mno000435-30004.mtl", "museum31744_diffuse_2048_q85.jpg"]);
    for (const [file, sha256] of Object.entries(source.companions)) {
      expect(fileHash(new URL(file, SOURCE_DIR)), file).toBe(sha256);
    }
    expect(assetInputs().buddha.companions).toEqual(source.companions);
  });
});
