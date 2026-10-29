import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { ARRIVAL, DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_SEATS, GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_Z, PLATFORM } from "@dongjane/shared";
import { CameraRig, DEFAULT_VIEW, DHARMA_CAMERA_BOUNDS, DHARMA_KEEP_OUT, configureCamera, distanceBefore, lensFor, maxDistanceInside, projectToCanvas, projectUnclipped, regionFor, viewFor } from "../src/game/camera-rig.ts";
import { LANDSCAPE_BOUNDS } from "../src/game/landscape-layout.ts";
import { DHARMA, DHARMA_SHELL } from "../src/game/dharma-layout.ts";

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

describe("distanceBefore", () => {
  const solid = { minX: -2, maxX: 2, minY: 0, maxY: 4, minZ: -2, maxZ: 2 };

  it("returns the distance at which the ray first enters the box", () => {
    expect(distanceBefore({ x: 0, y: 1, z: 6 }, { x: 0, y: 0, z: -1 }, solid, 9)).toBeCloseTo(4, 6);
    expect(distanceBefore({ x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, solid, 9)).toBeCloseTo(3, 6);
  });

  it("returns the wanted distance when the ray stops short of the box, misses it or points away", () => {
    expect(distanceBefore({ x: 0, y: 1, z: 6 }, { x: 0, y: 0, z: -1 }, solid, 3)).toBe(3);
    expect(distanceBefore({ x: 5, y: 1, z: 6 }, { x: 0, y: 0, z: -1 }, solid, 9)).toBe(9);
    expect(distanceBefore({ x: 0, y: 1, z: 6 }, { x: 0, y: 0, z: 1 }, solid, 9)).toBe(9);
  });

  it("does not hold back an origin that is already inside the box", () => {
    expect(distanceBefore({ x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 1 }, solid, 9)).toBe(9);
  });
});

describe("the 법당's keep-out box", () => {
  it("is the footprint of the shell, from its plinth at the back to the porch's edge at the court", () => {
    expect(DHARMA_KEEP_OUT.minX).toBeCloseTo(DHARMA_ORIGIN.x - DHARMA.halfWidth - DHARMA_SHELL.plinth, 6);
    expect(DHARMA_KEEP_OUT.maxX).toBeCloseTo(DHARMA_ORIGIN.x + DHARMA.halfWidth + DHARMA_SHELL.plinth, 6);
    expect(DHARMA_KEEP_OUT.minZ).toBeCloseTo(DHARMA_ORIGIN.z + DHARMA.backZ - DHARMA_SHELL.plinth, 6);
    expect(DHARMA_KEEP_OUT.maxZ).toBe(DHARMA_ORIGIN.z + DHARMA_SHELL.porchZ);
    expect(DHARMA_KEEP_OUT.maxY).toBeGreaterThan(DHARMA_SHELL.beamTop + DHARMA_SHELL.rise);
  });

  it("stops a camera that swings round behind someone on the court from going through the front wall", () => {
    const behind = (keepOut: readonly (typeof DHARMA_KEEP_OUT)[]): CameraRig => {
      const rig = new CameraRig(new PerspectiveCamera(), LANDSCAPE_BOUNDS, undefined, keepOut);
      rig.reduceMotion = true;
      rig.yaw = Math.PI;
      rig.pitch = 0.3;
      rig.distance = 12;
      rig.follow(DHARMA_ORIGIN.x, DHARMA_KEEP_OUT.maxZ + 2, 1, true);
      rig.update(0.016);
      return rig;
    };
    expect(behind([]).camera.position.z, "without the box the camera passes into the wall").toBeLessThan(DHARMA_KEEP_OUT.maxZ);
    const { x, y, z } = behind([DHARMA_KEEP_OUT]).camera.position;
    expect(z).toBeGreaterThanOrEqual(DHARMA_KEEP_OUT.maxZ);
    expect(x).toBeCloseTo(DHARMA_ORIGIN.x, 1);
    expect(y).toBeGreaterThan(0);
  });

  it("leaves a camera that follows someone inside the room to the room's own box", () => {
    const rig = new CameraRig(new PerspectiveCamera(), DHARMA_CAMERA_BOUNDS, regionFor("dharma").limits, [DHARMA_KEEP_OUT]);
    rig.reduceMotion = true;
    rig.follow(DHARMA_ORIGIN.x, DHARMA_ORIGIN.z, 1, true);
    rig.update(0.016);
    const { x, z } = rig.camera.position;
    expect(Math.hypot(x - DHARMA_ORIGIN.x, z - DHARMA_ORIGIN.z)).toBeGreaterThan(regionFor("dharma").limits.minDistance * 0.5);
  });
});

describe("CameraRig", () => {
  const make = (): CameraRig => new CameraRig(new PerspectiveCamera(), box);

  it("keeps the camera inside the world bounds near a wall", () => {
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
    expect(rig.distance).toBeLessThanOrEqual(22);
  });

  it("takes another zone's bounds and zoom range, pulling the distance into them", () => {
    const rig = make();
    rig.distance = 16;
    const dharma = regionFor("dharma");
    rig.setRegion(dharma.bounds, dharma.limits);
    expect(rig.distance).toBe(dharma.limits.maxDistance);
    for (let i = 0; i < 50; i += 1) rig.zoom(0.5);
    expect(rig.distance).toBeGreaterThanOrEqual(dharma.limits.minDistance);
    const outdoors = regionFor("gatbawi");
    rig.setRegion(outdoors.bounds, outdoors.limits);
    for (let i = 0; i < 50; i += 1) rig.zoom(2);
    expect(rig.distance).toBeLessThanOrEqual(outdoors.limits.maxDistance);
    expect(outdoors.limits.maxDistance).toBeGreaterThan(dharma.limits.maxDistance);
  });

  it("slides to another box over the blend time instead of jumping, easing the distance into the new range", () => {
    const rig = make();
    rig.reduceMotion = false;
    rig.distance = 16;
    const dharma = regionFor("dharma");
    rig.setRegion(dharma.bounds, dharma.limits, 0.5);
    rig.follow(DHARMA_BOUNDS.maxX - 5, 2, 1, true);
    rig.update(0.1);
    expect(rig.distance).toBeLessThan(16);
    expect(rig.distance).toBeGreaterThan(dharma.limits.maxDistance);
    for (let i = 0; i < 10; i += 1) rig.update(0.1);
    expect(rig.distance).toBe(dharma.limits.maxDistance);
    const { x, y, z } = rig.camera.position;
    expect(x).toBeGreaterThanOrEqual(dharma.bounds.minX);
    expect(x).toBeLessThanOrEqual(dharma.bounds.maxX);
    expect(y).toBeLessThanOrEqual(dharma.bounds.maxY);
    expect(z).toBeLessThanOrEqual(dharma.bounds.maxZ);
  });

  it("changes box at once when motion is reduced", () => {
    const rig = make();
    rig.reduceMotion = true;
    rig.distance = 16;
    const dharma = regionFor("dharma");
    rig.setRegion(dharma.bounds, dharma.limits, 0.5);
    expect(rig.distance).toBe(dharma.limits.maxDistance);
  });

  it("keeps the room's box inside the room's walls, around the walkable floor", () => {
    expect(DHARMA_CAMERA_BOUNDS.minX).toBeGreaterThan(DHARMA_ORIGIN.x - DHARMA.halfWidth);
    expect(DHARMA_CAMERA_BOUNDS.maxX).toBeLessThan(DHARMA_ORIGIN.x + DHARMA.halfWidth);
    expect(DHARMA_CAMERA_BOUNDS.maxZ).toBeLessThan(DHARMA_ORIGIN.z + DHARMA.frontZ);
    expect(DHARMA_CAMERA_BOUNDS.minX).toBeLessThanOrEqual(DHARMA_BOUNDS.minX);
    expect(DHARMA_CAMERA_BOUNDS.maxX).toBeGreaterThanOrEqual(DHARMA_BOUNDS.maxX);
    expect(regionFor("dharma").bounds).toBe(DHARMA_CAMERA_BOUNDS);
  });

  it("points forward toward Gatbawi at yaw 0 and rotates with orbit", () => {
    const rig = make();
    rig.yaw = 0;
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
  const make = (): CameraRig => {
    const rig = new CameraRig(new PerspectiveCamera(), box);
    rig.yaw = 0;
    return rig;
  };

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
    const rig = new CameraRig(camera, LANDSCAPE_BOUNDS);
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

describe("projectUnclipped", () => {
  const framed = (): PerspectiveCamera => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, LANDSCAPE_BOUNDS);
    rig.reduceMotion = true;
    configureCamera(camera, rig, 800, 600, 0, 0);
    rig.follow(0, 3, 0, true);
    rig.update(0.016);
    camera.updateMatrixWorld();
    return camera;
  };

  it("agrees with projectToCanvas for a point inside the view", () => {
    const camera = framed();
    const clipped = { x: 0, y: 0 };
    const unclipped = { x: 0, y: 0 };
    expect(projectToCanvas(camera, 0, 1, 3, 800, 600, clipped)).toBe(true);
    expect(projectUnclipped(camera, 0, 1, 3, 800, 600, unclipped)).toBe(true);
    expect(unclipped.x).toBeCloseTo(clipped.x, 3);
    expect(unclipped.y).toBeCloseTo(clipped.y, 3);
  });

  it("still places a point that is off screen, which is what a video corner needs", () => {
    const camera = framed();
    const out = { x: 0, y: 0 };
    expect(projectToCanvas(camera, 30, 1, 3, 800, 600, out)).toBe(false);
    expect(projectUnclipped(camera, 30, 1, 3, 800, 600, out)).toBe(true);
    expect(out.x).toBeGreaterThan(800);
    expect(projectUnclipped(camera, 0, 14, 3, 800, 600, out)).toBe(true);
    expect(out.y).toBeLessThan(0);
  });

  it("gives up on a point behind the camera", () => {
    const camera = framed();
    const out = { x: 0, y: 0 };
    const behind = camera.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
    expect(projectUnclipped(camera, behind.x, behind.y, behind.z, 800, 600, out)).toBe(false);
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
  const halfMat = { x: GATBAWI_SEAT_SIZE.x / 2, z: GATBAWI_SEAT_SIZE.z / 2 };
  const spawn = ARRIVAL;

  const frame = (width: number, height: number): CameraRig => {
    const rig = new CameraRig(new PerspectiveCamera(), LANDSCAPE_BOUNDS);
    const view = viewFor("gatbawi", width / height);
    rig.yaw = view.yaw;
    rig.pitch = view.pitch;
    rig.distance = view.distance;
    return rig;
  };

  it("pulls the view back on tall screens and in on wide ones", () => {
    expect(viewFor("gatbawi", 390 / 844).distance).toBeGreaterThan(viewFor("gatbawi", 1280 / 800).distance);
    expect(viewFor("gatbawi", 390 / 844).pitch).toBe(DEFAULT_VIEW.pitch);
    expect(viewFor("dharma", 1).distance).toBeLessThan(viewFor("gatbawi", 390 / 844).distance);
  });

  it.each(SCREENS)("keeps Gatbawi, all fifty mats and the monk between the HUD bands on %s", (_name, width, height, top, bottom) => {
    const rig = frame(width, height);
    const camera = rig.camera;
    rig.reduceMotion = true;
    configureCamera(camera, rig, width, height, top, bottom);
    rig.follow(spawn.x, spawn.z, 0, true);
    rig.update(0.016);
    camera.updateMatrixWorld();
    const screen = (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height, depth: p.z };
    };

    const hatTop = screen(0, PLATFORM.topY + 4.1, GATBAWI_Z);
    expect(hatTop.y).toBeGreaterThan(top);
    expect(hatTop.depth).toBeLessThan(1);
    for (const spot of GATBAWI_SEATS) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = screen(spot.x + sx * halfMat.x, 0.03, spot.z + sz * halfMat.z);
          expect(corner.x, `mat ${spot.id} corner`).toBeGreaterThan(8);
          expect(corner.x, `mat ${spot.id} corner`).toBeLessThan(width - 8);
          expect(corner.y, `mat ${spot.id} corner`).toBeGreaterThan(top);
          expect(corner.y, `mat ${spot.id} corner`).toBeLessThan(height - bottom);
        }
      }
    }
    const feet = screen(spawn.x, 0, spawn.z);
    const head = screen(spawn.x, 1.5, spawn.z);
    expect(head.y).toBeGreaterThan(top);
    expect(feet.y).toBeLessThan(height - bottom);
  });

  it("keeps the camera inside the bounds and in front of the trees", () => {
    const rig = frame(390, 844);
    const camera = rig.camera;
    rig.reduceMotion = true;
    rig.follow(spawn.x, spawn.z, 0, true);
    rig.update(0.016);
    const { x, y, z } = camera.position;
    expect(x).toBeGreaterThanOrEqual(LANDSCAPE_BOUNDS.minX);
    expect(x).toBeLessThanOrEqual(LANDSCAPE_BOUNDS.maxX);
    expect(y).toBeGreaterThanOrEqual(LANDSCAPE_BOUNDS.minY);
    expect(y).toBeLessThanOrEqual(LANDSCAPE_BOUNDS.maxY);
    expect(z).toBeLessThanOrEqual(LANDSCAPE_BOUNDS.maxZ);
    expect(z).toBeCloseTo(spawn.z + DEFAULT_VIEW.distance * Math.cos(DEFAULT_VIEW.pitch) * Math.cos(DEFAULT_VIEW.yaw), 2);
  });

  it("uses a wider lens on portrait screens", () => {
    expect(lensFor(390 / 844).fov).toBeGreaterThan(lensFor(1280 / 800).fov);
  });
});
