import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { assetInputs } from "./asset-inputs.ts";

export const BLENDER_DIR = new URL("../blender/", import.meta.url);
export const MODELS_DIR = new URL("../src/assets/models/", import.meta.url);
export const STAMP_URL = new URL("stamp.json", MODELS_DIR);

export interface Stamp {
  blender: string;
  inputsHash: string;
  outputs: Record<string, string>;
}

const lineFeeds = (text: string): string => text.replace(/\r\n/g, "\n");

// Hash of everything that decides what the build produces: the Blender scripts (line endings
// normalised, because git may check them out with CRLF) and the game data they are fed.
export function inputsHash(): string {
  const hash = createHash("sha256");
  const scripts = readdirSync(BLENDER_DIR).filter((file) => file.endsWith(".py")).sort();
  for (const file of scripts) {
    hash.update(`${file}\0${lineFeeds(readFileSync(new URL(file, BLENDER_DIR), "utf8"))}\0`);
  }
  hash.update(JSON.stringify(assetInputs()));
  return hash.digest("hex");
}

export function fileHash(url: URL): string {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

export function modelHashes(): Record<string, string> {
  const files = readdirSync(MODELS_DIR).filter((file) => file.endsWith(".glb")).sort();
  return Object.fromEntries(files.map((file) => [file, fileHash(new URL(file, MODELS_DIR))]));
}

export function readStamp(): Stamp {
  return JSON.parse(readFileSync(STAMP_URL, "utf8")) as Stamp;
}
