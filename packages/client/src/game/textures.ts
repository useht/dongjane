import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { FONT_STACK, THEME, withAlpha } from "../theme.ts";

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

// A candle flame and the dust in its light: a white-hot core inside a soft amber falloff, drawn additively.
export function flameGlowTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const material = THEME.material;
  const g = ctx.createRadialGradient(32, 38, 1, 32, 36, 30);
  g.addColorStop(0, withAlpha(material.flameCore, 1));
  g.addColorStop(0.18, withAlpha(material.flameCore, 0.95));
  g.addColorStop(0.4, withAlpha(material.flameMid, 0.55));
  g.addColorStop(0.7, withAlpha(material.flameEdge, 0.16));
  g.addColorStop(1, withAlpha(material.flameEdge, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
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

// Long, faint troughs lying along the shore (z) across a white sea: the sea's colour times this picture, drifting toward the beach.
export function seaTexture(): CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const scene = THEME.scene;
  ctx.fillStyle = scene.white;
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(77);
  for (let i = 0; i < 70; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const across = 4 + rand() * 9;
    const along = 30 + rand() * 80;
    ctx.fillStyle = withAlpha(scene.skyTopNight, 0.05 + rand() * 0.09);
    for (const shiftX of [-size, 0, size]) {
      for (const shiftY of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + shiftX, y + shiftY, across, along, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = toTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

// The foam of one wave, drawn across its width (u runs from the land to the sea): a bright, ragged front trailing off toward the land.
export function foamTexture(): CanvasTexture {
  const width = 128;
  const height = 64;
  const [canvas, ctx] = makeCanvas(width, height);
  const scene = THEME.scene;
  const fade = ctx.createLinearGradient(0, 0, width, 0);
  fade.addColorStop(0, withAlpha(scene.white, 0));
  fade.addColorStop(0.7, withAlpha(scene.white, 0.35));
  fade.addColorStop(0.9, withAlpha(scene.white, 0.9));
  fade.addColorStop(1, withAlpha(scene.white, 0));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);
  const rand = mulberry32(19);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 140; i += 1) {
    const x = width * (0.45 + rand() * 0.55);
    const y = rand() * height;
    ctx.fillStyle = withAlpha(scene.white, 0.2 + rand() * 0.5);
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rand() * 7, 1 + rand() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = toTexture(canvas);
  texture.wrapT = RepeatWrapping;
  return texture;
}

// What the LED screen shows when the concert video is not playing: a night sky of lotus lanterns and the festival's name.
export function stagePosterTexture(): CanvasTexture {
  const width = 1024;
  const height = 576;
  const [canvas, ctx] = makeCanvas(width, height);
  const scene = THEME.scene;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, scene.skyTopNight);
  sky.addColorStop(1, scene.skyHorizonNight);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const lanterns = [scene.lanternPink, scene.lanternWhite, scene.lanternYellow, scene.lanternOrange, scene.lanternGreen, scene.lanternViolet];
  const rand = mulberry32(73);
  for (let i = 0; i < 46; i += 1) {
    const x = rand() * width;
    const y = 30 + rand() * (height - 60);
    const radius = 10 + rand() * 18;
    const color = lanterns[i % lanterns.length] as string;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    glow.addColorStop(0, withAlpha(color, 0.55));
    glow.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius * 3, y - radius * 3, radius * 6, radius * 6);
    ctx.fillStyle = withAlpha(color, 0.92);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = (petal / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(angle) * radius * 0.45, y + Math.sin(angle) * radius * 0.45, radius * 0.5, radius * 0.3, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = withAlpha(scene.skyTopNight, 0.55);
  ctx.fillRect(0, height * 0.36, width, height * 0.28);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = scene.lanternWhite;
  ctx.font = `700 96px ${FONT_STACK}`;
  ctx.fillText("연등회", width / 2, height * 0.46);
  ctx.fillStyle = withAlpha(scene.lanternWhite, 0.75);
  ctx.font = `500 34px ${FONT_STACK}`;
  ctx.fillText("동자네 무대", width / 2, height * 0.58);
  return toTexture(canvas);
}
