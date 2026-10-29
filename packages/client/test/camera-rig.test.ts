import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { BUDDHA_Z, SPAWN_POINT } from "@dongjane/shared";
import { CameraRig, DEFAULT_VIEW, configureCamera, lensFor, maxDistanceInside, projectToCanvas } from "../src/game/camera-rig.ts";
import { HALL_BOUNDS } from "../src/game/hall.ts";

const box = { minX: -6, maxX: 6, minY: 0.5, maxY: 5, minZ: -6, maxZ: 7 };

describe("maxDistanceInside", () => {
  it("returns the wanted distance when there is room", () => {
    expect(maxDistanceInside({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box, 3)).toBe(3);
  });

  it("stops at the nearest wall", () => {
    expect(maxDistanceInside({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: 1 }, box, 6)).toBeCloseTo(2, 6);
    expect(maxDistanceInside({ x: -4, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, box, 6)).toBeCloseTo(2, 6);
  });

  it("accounts for the ceiling on steep angles", () => {
    expect(maxDistanceInside({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, box, 9)).toBeCloseTo(4, 6);
  });

  it("never returns a negative distance", () => {
    expect(maxDistanceInside({ x: 0, y: 1, z: 8 }, { x: 0, y: 0, z: 1 }, box, 6)).toBe(0);
  });
});

describe("CameraRig", () => {
  const make = (): CameraRig => new CameraRig(new PerspectiveCamera(), box);

  it("keeps the camera inside the hall bounds near a wall", () => {
    const rig = make();
    rig.follow(0, 6.5, 1, true);
    rig.update(0.016);
    const { x, y, z } = rig.camera.position;
    expect(x).toBeGreaterThanOrEqual(box.minX);
    expect(x).toBeLessThanOrEqual(box.maxX);
    expect(y).toBeGreaterThanOrEqual(box.minY);
    expect(y).toBeLessThanOrEqual(box.maxY);
    expect(z).toBeLessThanOrEqual(box.maxZ);
  });

  it("clamps pitch and zoom", () => {
    const rig = make();
    rig.orbit(0, 10);
    expect(rig.pitch).toBeLessThanOrEqual(1.3);
    rig.orbit(0, -10);
    expect(rig.pitch).toBeGreaterThanOrEqual(0.16);
    for (let i = 0; i < 50; i += 1) rig.zoom(0.5);
    expect(rig.distance).toBeGreaterThanOrEqual(2.6);
    for (let i = 0; i < 50; i += 1) rig.zoom(2);
    expect(rig.distance).toBeLessThanOrEqual(9);
  });

  it("points forward toward the buddha at yaw 0 and rotates with orbit", () => {
    const rig = make();
    expect(rig.forward.z).toBeCloseTo(-1, 6);
    rig.yaw = Math.PI / 2;
    expect(rig.forward.x).toBeCloseTo(-1, 6);
  });

  it("does not sway when motion is reduced", () => {
    const a = make();
    const b = make();
    a.reduceMotion = true;
    b.reduceMotion = true;
    a.update(0.016);
    b.update(5);
    expect(a.camera.position.x).toBeCloseTo(b.camera.position.x, 6);
    expect(a.camera.position.y).toBeCloseTo(b.camera.position.y, 6);
  });
});

describe("lift", () => {
  const make = (): CameraRig => new CameraRig(new PerspectiveCamera(), box);

  it("raises the optical axis above the followed point without moving the camera", () => {
    const flat = make();
    const lifted = make();
    lifted.lift = 0.2;
    for (const rig of [flat, lifted]) {
      rig.reduceMotion = true;
      rig.follow(0, 1, 0, true);
      rig.update(0.016);
    }
    expect(lifted.camera.position.distanceTo(flat.camera.position)).toBeLessThan(1e-9);
    const axis = (rig: CameraRig) => rig.camera.getWorldDirection(new Vector3());
    expect(axis(lifted).y - axis(flat).y).toBeGreaterThan(0.1);
    expect(axis(lifted).x).toBeCloseTo(axis(flat).x, 9);
    expect(Math.asin(axis(flat).y) - Math.asin(axis(lifted).y)).toBeCloseTo(-0.2, 6);
  });
});

describe("projectToCanvas", () => {
  const framed = (hudTop: number, hudBottom: number): { camera: PerspectiveCamera; rig: CameraRig } => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, HALL_BOUNDS);
    rig.reduceMotion = true;
    configureCamera(camera, rig, 800, 600, hudTop, hudBottom);
    rig.follow(0, 3, 0, true);
    rig.update(0.016);
    camera.updateMatrixWorld();
    return { camera, rig };
  };

  it("puts the point above the monk's feet on screen, inside the canvas", () => {
    const { camera } = framed(0, 0);
    const feet = { x: 0, y: 0 };
    const above = { x: 0, y: 0 };
    expect(projectToCanvas(camera, 0, 0, 3, 800, 600, feet)).toBe(true);
    expect(projectToCanvas(camera, 0, 1.2, 3, 800, 600, above)).toBe(true);
    expect(feet.x).toBeGreaterThan(0);
    expect(feet.x).toBeLessThan(800);
    expect(above.x).toBeCloseTo(feet.x, 3);
    expect(above.y).toBeLessThan(feet.y);
  });

  it("follows the HUD view offset so hints line up with what is drawn", () => {
    const centered = framed(0, 0);
    const shifted = framed(100, 300);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    projectToCanvas(centered.camera, 0, 0.5, 3, 800, 600, a);
    projectToCanvas(shifted.camera, 0, 0.5, 3, 800, 600, b);
    expect(b.y).toBeLessThan(a.y);
  });

  it("rejects points behind the camera or off screen", () => {
    const { camera } = framed(0, 0);
    const out = { x: 0, y: 0 };
    expect(projectToCanvas(camera, 0, 1, 40, 800, 600, out)).toBe(false);
    expect(projectToCanvas(camera, 30, 1, 3, 800, 600, out)).toBe(false);
    expect(projectToCanvas(camera, 0, 40, 3, 800, 600, out)).toBe(false);
  });
});

// Screens as [width, height, top HUD band, bottom HUD band] in CSS pixels, matching --hud-top / --hud-bottom.
const SCREENS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ["phone portrait 390x844", 390, 844, 100, 112],
  ["phone portrait with notch and home bar", 390, 844, 159, 146],
  ["tablet portrait", 820, 1180, 100, 112],
  ["desktop 1280x800", 1280, 800, 100, 112],
  ["desktop 1920x1080", 1920, 1080, 100, 112],
];

describe("default framing", () => {
  it.each(SCREENS)("keeps the halo, altar and monk between the HUD bands on %s", (_name, width, height, top, bottom) => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, HALL_BOUNDS);
    rig.reduceMotion = true;
    configureCamera(camera, rig, width, height, top, bottom);
    expect(rig.pitch).toBe(DEFAULT_VIEW.pitch);
    rig.follow(SPAWN_POINT.x, SPAWN_POINT.z, 0, true);
    rig.update(0.016);
    camera.updateMatrixWorld();
    const screen = (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };

    const haloTop = screen(0, 4.78, BUDDHA_Z - 1.05);
    const bowl = screen(0, 1, BUDDHA_Z + 0.85);
    const outerCandle = screen(3.1, 1.18, BUDDHA_Z + 0.8);
    const feet = screen(SPAWN_POINT.x, 0, SPAWN_POINT.z);
    expect(haloTop.y).toBeGreaterThan(top);
    expect(bowl.y).toBeGreaterThan(top);
    expect(outerCandle.y).toBeGreaterThan(top);
    expect(outerCandle.x).toBeLessThan(width - 8);
    expect(feet.y).toBeLessThan(height - bottom);
  });

  it("uses a wider lens on portrait screens", () => {
    expect(lensFor(390 / 844).fov).toBeGreaterThan(lensFor(1280 / 800).fov);
  });
});
