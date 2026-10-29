import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assetInputs } from "./asset-inputs.ts";
import { BLENDER_DIR, MODELS_DIR, STAMP_URL, type Stamp, inputsHash, modelHashes } from "./asset-stamp.ts";

const WINDOWS_BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe";

function findBlender(): { bin: string; version: string } {
  const candidates = [process.env.BLENDER_BIN, WINDOWS_BLENDER, "blender"].filter((bin): bin is string => Boolean(bin));
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return { bin, version: probe.stdout.split(/\r?\n/)[0]?.trim() ?? "" };
  }
  throw new Error(`Blender was not found (tried ${candidates.join(", ")}). Set BLENDER_BIN to the executable.`);
}

const { bin, version } = findBlender();
const inputsPath = fileURLToPath(new URL(".inputs.json", BLENDER_DIR));
const outDir = fileURLToPath(MODELS_DIR);
mkdirSync(outDir, { recursive: true });
writeFileSync(inputsPath, `${JSON.stringify(assetInputs(), null, 2)}\n`);

console.log(`${version} (${bin})`);
const run = spawnSync(
  bin,
  [
    "--background",
    "--factory-startup",
    "--python",
    fileURLToPath(new URL("build.py", BLENDER_DIR)),
    "--",
    "--inputs",
    inputsPath,
    "--out",
    outDir,
  ],
  { stdio: "inherit" },
);
if (run.status !== 0) throw new Error(`Blender exited with status ${run.status}`);

const stamp: Stamp = { blender: version, inputsHash: inputsHash(), outputs: modelHashes() };
writeFileSync(STAMP_URL, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`stamped ${Object.keys(stamp.outputs).join(", ")}`);
