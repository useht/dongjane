import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace } from "three";

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

function toTexture(canvas: HTMLCanvasElement, anisotropy: number, repeat = false): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.wrapS = texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function floorTexture(anisotropy: number): CanvasTexture {
  const size = 1024;
  const [canvas, ctx] = makeCanvas(size, size);
  const rand = mulberry32(7);
  const planks = 26;
  const plankW = size / planks;
  ctx.fillStyle = "#a8743f";
  ctx.fillRect(0, 0, size, size);

  for (let column = 0; column < planks; column += 1) {
    let y = -rand() * 220;
    while (y < size) {
      const length = 180 + rand() * 260;
      const tone = 0.86 + rand() * 0.26;
      const hue = 28 + rand() * 6;
      ctx.fillStyle = `hsl(${hue} ${46 + rand() * 10}% ${(38 * tone).toFixed(1)}%)`;
      ctx.fillRect(column * plankW, y, plankW, length);

      ctx.globalAlpha = 0.16;
      for (let grain = 0; grain < 7; grain += 1) {
        const gx = column * plankW + rand() * plankW;
        ctx.strokeStyle = rand() > 0.5 ? "#5a3719" : "#d9a56a";
        ctx.lineWidth = 0.6 + rand() * 1.2;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.bezierCurveTo(gx + (rand() - 0.5) * 6, y + length * 0.3, gx + (rand() - 0.5) * 6, y + length * 0.7, gx + (rand() - 0.5) * 4, y + length);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#3a2210";
      ctx.fillRect(column * plankW, y, plankW, 1.5);
      ctx.globalAlpha = 1;
      y += length;
    }
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#35200f";
    ctx.fillRect(column * plankW, 0, 1.6, size);
    ctx.globalAlpha = 1;
  }

  return toTexture(canvas, anisotropy, true);
}

function lotus(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, petals: number, fill: string, stroke: string): void {
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.18);
    ctx.bezierCurveTo(radius * 0.32, -radius * 0.42, radius * 0.3, -radius * 0.82, 0, -radius);
    ctx.bezierCurveTo(-radius * 0.3, -radius * 0.82, -radius * 0.32, -radius * 0.42, 0, -radius * 0.18);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1.5, radius * 0.025);
    ctx.stroke();
    ctx.restore();
  }
}

export function backdropTexture(anisotropy: number): CanvasTexture {
  const width = 2048;
  const height = 880;
  const [canvas, ctx] = makeCanvas(width, height);
  const rand = mulberry32(21);

  ctx.fillStyle = "#e6d3ac";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 1400; i += 1) {
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = rand() > 0.5 ? "#8a6a3a" : "#fff3d6";
    ctx.fillRect(rand() * width, rand() * height, 2 + rand() * 40, 1 + rand() * 3);
  }
  ctx.globalAlpha = 1;

  const bandColors = ["#2f7d6b", "#c43d2d", "#2c5d9c", "#e6b43c"];
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = bandColors[i] as string;
    ctx.fillRect(0, i * 14, width, 14);
  }
  ctx.fillStyle = "#f4e7c4";
  for (let x = 20; x < width; x += 56) {
    ctx.beginPath();
    ctx.arc(x, 70, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  const mural = { x: width * 0.18, y: 110, w: width * 0.64, h: height - 150 };
  ctx.fillStyle = "#4a2c18";
  ctx.fillRect(mural.x - 14, mural.y - 14, mural.w + 28, mural.h + 28);
  ctx.fillStyle = "#d4a84a";
  ctx.fillRect(mural.x - 7, mural.y - 7, mural.w + 14, mural.h + 14);

  const sky = ctx.createLinearGradient(0, mural.y, 0, mural.y + mural.h);
  sky.addColorStop(0, "#1e4c4c");
  sky.addColorStop(0.55, "#2f6e63");
  sky.addColorStop(1, "#7a5a2e");
  ctx.fillStyle = sky;
  ctx.fillRect(mural.x, mural.y, mural.w, mural.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(mural.x, mural.y, mural.w, mural.h);
  ctx.clip();

  const cx = width / 2;
  const cy = mural.y + mural.h * 0.52;
  const halo = ctx.createRadialGradient(cx, cy, 20, cx, cy, mural.h * 0.62);
  halo.addColorStop(0, "rgba(255,238,170,0.95)");
  halo.addColorStop(0.35, "rgba(255,206,110,0.55)");
  halo.addColorStop(1, "rgba(255,206,110,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(mural.x, mural.y, mural.w, mural.h);

  for (let ring = 0; ring < 6; ring += 1) {
    ctx.strokeStyle = ring % 2 === 0 ? "rgba(255,226,150,0.65)" : "rgba(255,170,90,0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 110 + ring * 46, 0, Math.PI * 2);
    ctx.stroke();
  }
  lotus(ctx, cx, cy, 300, 16, "rgba(255,200,120,0.22)", "rgba(255,230,170,0.5)");

  for (let layer = 0; layer < 3; layer += 1) {
    ctx.fillStyle = ["#2a5a50", "#234a44", "#1b3b38"][layer] as string;
    ctx.beginPath();
    ctx.moveTo(mural.x, mural.y + mural.h);
    const base = mural.y + mural.h * (0.62 + layer * 0.12);
    for (let x = 0; x <= mural.w; x += 40) {
      const wave = Math.sin(x * 0.006 + layer * 2.1) * 30 + Math.sin(x * 0.017 + layer) * 14;
      ctx.lineTo(mural.x + x, base - wave);
    }
    ctx.lineTo(mural.x + mural.w, mural.y + mural.h);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 9; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = cx + side * (260 + (i >> 1) * 120 + rand() * 40);
    const y = mural.y + 70 + rand() * (mural.h * 0.55);
    ctx.fillStyle = "rgba(255,245,225,0.55)";
    for (let puff = 0; puff < 4; puff += 1) {
      ctx.beginPath();
      ctx.ellipse(x + puff * 30 - 45, y + Math.sin(puff * 1.7) * 8, 42 + puff * 4, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  for (const side of [-1, 1]) {
    const px = side < 0 ? mural.x * 0.5 : width - mural.x * 0.5;
    ctx.fillStyle = "#8a2d22";
    ctx.fillRect(px - 38, 100, 76, height - 100);
    ctx.fillStyle = "#e6b43c";
    ctx.fillRect(px - 38, 100, 6, height - 100);
    ctx.fillRect(px + 32, 100, 6, height - 100);
    lotus(ctx, px, 340, 80, 8, "#f4d98a", "#a8642a");
    lotus(ctx, px, 600, 80, 8, "#f4d98a", "#a8642a");
  }

  ctx.fillStyle = "#4a2c18";
  ctx.fillRect(0, height - 36, width, 36);
  return toTexture(canvas, anisotropy);
}

export function skyTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#35508f");
  g.addColorStop(0.45, "#a77fa6");
  g.addColorStop(0.75, "#f2a77a");
  g.addColorStop(1, "#ffd9a0");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  const sun = ctx.createRadialGradient(150, 420, 4, 150, 420, 120);
  sun.addColorStop(0, "rgba(255,250,220,0.95)");
  sun.addColorStop(0.3, "rgba(255,220,150,0.5)");
  sun.addColorStop(1, "rgba(255,200,130,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 256, 512);
  const rand = mulberry32(5);
  ctx.fillStyle = "rgba(255,236,220,0.45)";
  for (let i = 0; i < 7; i += 1) {
    const x = rand() * 256;
    const y = 250 + rand() * 170;
    ctx.beginPath();
    ctx.ellipse(x, y, 50 + rand() * 40, 8 + rand() * 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function cushionTexture(anisotropy: number): CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const rand = mulberry32(99);
  ctx.fillStyle = "#d89a2c";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 3) {
    ctx.fillStyle = `rgba(120,60,10,${0.05 + rand() * 0.06})`;
    ctx.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 3) {
    ctx.fillStyle = `rgba(255,220,140,${0.03 + rand() * 0.05})`;
    ctx.fillRect(x, 0, 1, size);
  }
  ctx.strokeStyle = "#8a3f1d";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  lotus(ctx, size / 2, size / 2, size * 0.34, 8, "#f1c35a", "#8a3f1d");
  ctx.fillStyle = "#8a3f1d";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas, anisotropy);
}

export function beamGlowTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(255,226,160,0.55)");
  g.addColorStop(1, "rgba(255,226,160,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const sideFade = ctx.createLinearGradient(0, 0, 64, 0);
  sideFade.addColorStop(0, "rgba(0,0,0,1)");
  sideFade.addColorStop(0.5, "rgba(0,0,0,0)");
  sideFade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = sideFade;
  ctx.fillRect(0, 0, 64, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function flameGlowTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, "rgba(255,246,200,1)");
  g.addColorStop(0.3, "rgba(255,190,90,0.7)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
