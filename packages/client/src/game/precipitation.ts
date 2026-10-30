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
import { THEME } from "../theme.ts";
import { mulberry32 } from "./textures.ts";

// The falling volume is a square round the spot the camera is aimed at. Each drop keeps its place in the world and the
// square slides under it, so walking does not drag the rain along.
const RANGE = 14;
const SPAN = RANGE * 2;
const Y_TOP = 11;
const RAIN_SPEED = 13;
const SNOW_SPEED = 1.1;
const SLANT = 0.14;
const VISIBLE_AMOUNT = 0.01;

function within(value: number, centre: number): number {
  return centre + ((((value - centre + RANGE) % SPAN) + SPAN) % SPAN) - RANGE;
}

export class Precipitation {
  readonly group = new Group();

  private readonly rain: LineSegments;
  private readonly snow: Points;
  private readonly seeds: Float32Array;
  private readonly centre = { x: 0, z: 0 };
  private clock = 0;

  constructor(private readonly count: number, flake: Texture) {
    this.seeds = new Float32Array(count * 4);
    const rand = mulberry32(73);
    for (let i = 0; i < this.seeds.length; i += 1) this.seeds[i] = rand();

    const rainGeometry = new BufferGeometry();
    rainGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 6), 3));
    this.rain = new LineSegments(
      rainGeometry,
      new LineBasicMaterial({ color: THEME.scene.precipDay, transparent: true, opacity: 0.6, depthWrite: false, fog: false }),
    );
    this.rain.name = "rain";

    const snowGeometry = new BufferGeometry();
    snowGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.snow = new Points(
      snowGeometry,
      new PointsMaterial({ map: flake, color: THEME.scene.precipDay, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
    );
    this.snow.name = "snow";

    for (const object of [this.rain, this.snow]) {
      object.frustumCulled = false;
      object.visible = false;
      this.group.add(object);
    }
  }

  update(dt: number, motion: number, rain: number, snow: number, tint: number, focus: { x: number; z: number }): void {
    this.clock += dt * motion;
    this.centre.x = focus.x;
    this.centre.z = focus.z;
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

  dispose(): void {
    for (const object of [this.rain, this.snow]) {
      object.geometry.dispose();
      (object.material as LineBasicMaterial | PointsMaterial).dispose();
    }
    this.group.removeFromParent();
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
      const x = within(this.seed(i, 0) * SPAN - fall * Y_TOP * SLANT, this.centre.x);
      const y = Y_TOP - fall * Y_TOP;
      const z = within(this.seed(i, 1) * SPAN, this.centre.z);
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
        within(this.seed(i, 0) * SPAN + Math.sin(this.clock * 0.6 + sway) * 0.5, this.centre.x),
        Y_TOP - fall * Y_TOP,
        within(this.seed(i, 1) * SPAN + Math.cos(this.clock * 0.45 + sway) * 0.5, this.centre.z),
      );
    }
    position.needsUpdate = true;
    geometry.setDrawRange(0, visible);
  }
}
