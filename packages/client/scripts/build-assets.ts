import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SOURCE_DIR, assetInputs, buddhaSource } from "./asset-inputs.ts";
import { BLENDER_DIR, MODELS_DIR, STAMP_URL, type Stamp, fileHash, inputsHash, modelHashes } from "./asset-stamp.ts";

const WINDOWS_BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe";

function findBlender(): { bin: string; version: string } {
  const candidates = [process.env.BLENDER_BIN, WINDOWS_BLENDER, "blender"].filter((bin): bin is string => Boolean(bin));
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return { bin, version: probe.stdout.split(/\r?\n/)[0]?.trim() ?? "" };
  }
  throw new Error(`Blender was not found (tried ${candidates.join(", ")}). Set BLENDER_BIN to the executable.`);
}

// The scan of the Buddha: the file committed beside source.json, or (for a source too big to commit, over about 25 MB) the copy
// fetched into the git-ignored cache. Either way its sha256 must be the one source.json states, which the stamp is built on.
async function fetchSource(): Promise<string> {
  const source = buddhaSource();
  const committed = new URL(source.file, SOURCE_DIR);
  const cached = new URL(`../blender/.cache/${source.sha256}-${source.file}`, import.meta.url);
  const verified = (url: URL): boolean => existsSync(url) && fileHash(url) === source.sha256;
  if (existsSync(committed)) {
    if (!verified(committed)) throw new Error(`${source.file} is not the file source.json describes (sha256 ${source.sha256})`);
    return fileURLToPath(committed);
  }
  if (!verified(cached)) {
    if (!source.download) throw new Error(`${source.file} is missing and source.json has no "download" to fetch it from`);
    const response = await fetch(source.download);
    if (!response.ok) throw new Error(`${source.download}: ${response.status} ${response.statusText}`);
    mkdirSync(new URL("./", cached), { recursive: true });
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
    if (!verified(cached)) throw new Error(`${source.download} is not the file source.json describes (sha256 ${source.sha256})`);
  }
  return fileURLToPath(cached);
}

const { bin, version } = findBlender();
const inputs = assetInputs();
const sourcePath = await fetchSource();
const inputsPath = fileURLToPath(new URL(".inputs.json", BLENDER_DIR));
const outDir = fileURLToPath(MODELS_DIR);
mkdirSync(outDir, { recursive: true });
writeFileSync(inputsPath, `${JSON.stringify({ ...inputs, buddha: { ...inputs.buddha, path: sourcePath } }, null, 2)}\n`);

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
