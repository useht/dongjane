import {
  type BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  type Texture,
} from "three";
import { mulberry32 } from "./textures.ts";

const X_MIN = 8.5;
const X_SPAN = 12;
const Z_MIN = -7;
const Z_SPAN = 14;
const Y_TOP = 11;
const RAIN_SPEED = 13;
const SNOW_SPEED = 1.1;
const SLANT = 0.14;
const VISIBLE_AMOUNT = 0.01;

export class Precipitation {
  readonly group = new Group();

  private readonly rain: LineSegments;
  private readonly snow: Points;
  private readonly seeds: Float32Array;
  private clock = 0;

  constructor(private readonly count: number, flake: Texture) {
    this.seeds = new Float32Array(count * 4);
    const rand = mulberry32(73);
    for (let i = 0; i < this.seeds.length; i += 1) this.seeds[i] = rand();

    const rainGeometry = new BufferGeometry();
    rainGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 6), 3));
    this.rain = new LineSegments(
      rainGeometry,
      new LineBasicMaterial({ color: 0xd8e4f0, transparent: true, opacity: 0.6, depthWrite: false, fog: false }),
    );
    this.rain.name = "rain";

    const snowGeometry = new BufferGeometry();
    snowGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.snow = new Points(
      snowGeometry,
      new PointsMaterial({ map: flake, color: 0xd8e4f0, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
    );
    this.snow.name = "snow";

    for (const object of [this.rain, this.snow]) {
      object.frustumCulled = false;
      object.visible = false;
      this.group.add(object);
    }
  }

  update(dt: number, motion: number, rain: number, snow: number, tint: number): void {
    this.clock += dt * motion;
    this.rain.visible = rain > VISIBLE_AMOUNT;
    this.snow.visible = snow > VISIBLE_AMOUNT;
    if (this.rain.visible) {
      (this.rain.material as LineBasicMaterial).color.setHex(tint);
      this.fillRain(Math.ceil(this.count * Math.min(1, rain)));
    }
    if (this.snow.visible) {
      (this.snow.material as PointsMaterial).color.setHex(tint);
      this.fillSnow(Math.ceil(this.count * Math.min(1, snow)));
    }
  }

  private seed(i: number, k: number): number {
    return this.seeds[i * 4 + k] as number;
  }

  private fillRain(visible: number): void {
    const geometry = this.rain.geometry;
    const position = geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < visible; i += 1) {
      const fall = (this.seed(i, 2) + (this.clock * RAIN_SPEED * (0.85 + this.seed(i, 3) * 0.3)) / Y_TOP) % 1;
      const length = 0.5 + this.seed(i, 3) * 0.35;
      const x = X_MIN + this.seed(i, 0) * X_SPAN - fall * Y_TOP * SLANT;
      const y = Y_TOP - fall * Y_TOP;
      const z = Z_MIN + this.seed(i, 1) * Z_SPAN;
      position.setXYZ(i * 2, x, y, z);
      position.setXYZ(i * 2 + 1, x + length * SLANT, y + length, z);
    }
    position.needsUpdate = true;
    geometry.setDrawRange(0, visible * 2);
  }

  private fillSnow(visible: number): void {
    const geometry = this.snow.geometry;
    const position = geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < visible; i += 1) {
      const sway = this.seed(i, 3) * Math.PI * 2;
      const fall = (this.seed(i, 2) + (this.clock * SNOW_SPEED * (0.7 + this.seed(i, 3) * 0.6)) / Y_TOP) % 1;
      position.setXYZ(
        i,
        X_MIN + this.seed(i, 0) * X_SPAN + Math.sin(this.clock * 0.6 + sway) * 0.5,
        Y_TOP - fall * Y_TOP,
        Z_MIN + this.seed(i, 1) * Z_SPAN + Math.cos(this.clock * 0.45 + sway) * 0.5,
      );
    }
    position.needsUpdate = true;
    geometry.setDrawRange(0, visible);
  }
}
