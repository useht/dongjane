import { CanvasTexture, SRGBColorSpace } from "three";

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

export function nameTexture(name: string, tint: string): { texture: CanvasTexture; aspect: number } {
  const height = 72;
  const font = `600 38px "Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`;
  const [probe, pctx] = makeCanvas(8, 8);
  void probe;
  pctx.font = font;
  const textWidth = Math.ceil(pctx.measureText(name).width);
  const width = Math.max(96, textWidth + 48);
  const [canvas, ctx] = makeCanvas(width, height);
  ctx.fillStyle = "rgba(34,20,10,0.62)";
  ctx.beginPath();
  ctx.roundRect(2, 6, width - 4, height - 12, 28);
  ctx.fill();
  ctx.strokeStyle = tint;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff4dc";
  ctx.fillText(name, width / 2, height / 2 + 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: width / height };
}
