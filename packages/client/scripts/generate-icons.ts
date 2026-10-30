import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { brandMarkSvg } from "./brand-mark.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function png(svg: string, size: number, file: string): Promise<void> {
  const out = resolve(root, "public/icons", file);
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log("wrote", out);
}

await mkdir(resolve(root, "public/icons"), { recursive: true });
const plain = brandMarkSvg(1);
const safe = brandMarkSvg(0.78);

await writeFile(resolve(root, "public/favicon.svg"), plain);
await png(plain, 192, "icon-192.png");
await png(plain, 512, "icon-512.png");
await png(safe, 512, "icon-maskable-512.png");
await png(plain, 180, "apple-touch-icon.png");
