import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { THEME, withAlpha } from "../theme.ts";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The sun and the moon: a bright disc inside a soft halo. Sprites tint it, so it is warm by day and pale at night.
export function discGlowTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const scene = THEME.scene;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, withAlpha(scene.sunDisc, 1));
  g.addColorStop(0.16, withAlpha(scene.sunDisc, 1));
  g.addColorStop(0.2, withAlpha(scene.sunHalo, 0.7));
  g.addColorStop(0.5, withAlpha(scene.sunHalo, 0.18));
  g.addColorStop(1, withAlpha(scene.sunHalo, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas);
}

export function flakeTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(32, 32);
  const scene = THEME.scene;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0, withAlpha(scene.white, 1));
  g.addColorStop(0.5, withAlpha(scene.white, 0.7));
  g.addColorStop(1, withAlpha(scene.white, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return toTexture(canvas);
}

// Wraps around the dome horizontally; the top row is the zenith and the bottom row fades out at the horizon.
export function cloudTexture(): CanvasTexture {
  const width = 1024;
  const height = 256;
  const [canvas, ctx] = makeCanvas(width, height);
  const scene = THEME.scene;
  const rand = mulberry32(41);
  ctx.fillStyle = withAlpha(scene.white, 0.3);
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 120; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radius = 26 + rand() * 66;
    const alpha = 0.35 + rand() * 0.3;
    for (const shift of [-width, 0, width]) {
      const blob = ctx.createRadialGradient(x + shift, y, 0, x + shift, y, radius);
      blob.addColorStop(0, withAlpha(scene.white, alpha));
      blob.addColorStop(1, withAlpha(scene.white, 0));
      ctx.fillStyle = blob;
      ctx.fillRect(x + shift - radius, y - radius, radius * 2, radius * 2);
    }
  }
  ctx.globalCompositeOperation = "destination-in";
  const fade = ctx.createLinearGradient(0, 0, 0, height);
  fade.addColorStop(0, withAlpha(scene.white, 1));
  fade.addColorStop(0.65, withAlpha(scene.white, 1));
  fade.addColorStop(1, withAlpha(scene.white, 0));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);
  const texture = toTexture(canvas);
  texture.wrapS = RepeatWrapping;
  return texture;
}

// One white leaf with a faint midrib; every drifting leaf tints it with its own autumn colour.
export function leafTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const scene = THEME.scene;
  ctx.fillStyle = scene.white;
  ctx.beginPath();
  ctx.moveTo(32, 3);
  ctx.quadraticCurveTo(60, 26, 32, 61);
  ctx.quadraticCurveTo(4, 26, 32, 3);
  ctx.fill();
  ctx.strokeStyle = withAlpha(THEME.material.woodDark, 0.55);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(32, 60);
  ctx.stroke();
  return toTexture(canvas);
}
