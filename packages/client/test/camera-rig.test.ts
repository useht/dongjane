import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { ARRIVAL, CASINO_AISLE_EAST, CASINO_FLOOR, CASINO_YARD, DHARMA_BOUNDS, DHARMA_ORIGIN, DHARMA_ROOM, DHARMA_SEATS, DHARMA_YAW, GATBAWI_SEATS, GATBAWI_SEAT_SIZE, GATBAWI_Z, MACHINE_SPOTS, PLATFORM, type MachineSpot, dharmaToWorld, machineFootprint, worldToDharma } from "@dongjane/shared";
import {
  CAMERA_CLEARANCE,
  CASINO_MACHINE_BOXES,
  CameraRig,
  DEFAULT_VIEW,
  DHARMA_CAMERA_BOUNDS,
  DHARMA_KEEP_OUT,
  DHARMA_KEEP_OUTS,
  DHARMA_PILLARS_KEEP_OUT,
  DHARMA_SILLS,
  KEEP_OUTS,
  SWAY,
  WORLD_SOLIDS,
  casinoRegion,
  configureCamera,
  distanceBefore,
  lensFor,
  maxDistanceInside,
  pointInRoom,
  projectToCanvas,
  projectUnclipped,
  regionFor,
  startViewFor,
  viewFor,
  type Box,
} from "../src/game/camera-rig.ts";
import { CASINO_CAMERA_BOUNDS, CASINO_KEEP_OUT, CASINO_ROOM, CASINO_SHELL, CASINO_TOP, machineHeight } from "../src/game/casino-layout.ts";
import { LANDSCAPE_BOUNDS } from "../src/game/landscape-layout.ts";
import { BUDDHA_AT, DHARMA, DHARMA_SHELL, FRONT_PILLARS_X, WALL_OPENINGS } from "../src/game/dharma-layout.ts";
import { loadGlb, triangleCorners } from "./glb.ts";

const box = { minX: -6, maxX: 6, minY: 0.5, maxY: 5, minZ: -6, maxZ: 7 };

// A box on the floor as the room sees it: the room's frame is the world's turned a quarter turn about DHARMA_ORIGIN.
function inRoomFrame(floor: { minX: number; maxX: number; minZ: number; maxZ: number }): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const a = worldToDharma(floor.minX, floor.minZ);
  const b = worldToDharma(floor.maxX, floor.maxZ);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

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
    // The back of the room is on the world's -x side and its door side on the +x side.
    expect(DHARMA_KEEP_OUT.minX).toBeCloseTo(DHARMA_ORIGIN.x + DHARMA.backZ - DHARMA_SHELL.plinth, 6);
    expect(DHARMA_KEEP_OUT.maxX).toBe(DHARMA_ORIGIN.x + DHARMA_SHELL.porchZ);
    expect(DHARMA_KEEP_OUT.minZ).toBeCloseTo(DHARMA_ORIGIN.z - DHARMA.halfWidth - DHARMA_SHELL.plinth, 6);
    expect(DHARMA_KEEP_OUT.maxZ).toBeCloseTo(DHARMA_ORIGIN.z + DHARMA.halfWidth + DHARMA_SHELL.plinth, 6);
    expect(DHARMA_KEEP_OUT.maxY).toBeGreaterThan(DHARMA_SHELL.beamTop + DHARMA_SHELL.rise);
  });

  it("stops a camera that swings round behind someone on the court from going through the front wall", () => {
    const behind = (keepOut: readonly (typeof DHARMA_KEEP_OUT)[]): CameraRig => {
      const rig = new CameraRig(new PerspectiveCamera(), LANDSCAPE_BOUNDS, undefined, keepOut);
      rig.reduceMotion = true;
      // The camera stands on the side of the followed point its yaw names: -DHARMA_YAW puts it on their -x side, toward the temple.
      rig.yaw = -DHARMA_YAW;
      rig.pitch = 0.3;
      rig.distance = 12;
      rig.follow(DHARMA_KEEP_OUT.maxX + 2, DHARMA_ORIGIN.z, 1, true);
      rig.update(0.016);
      return rig;
    };
    expect(behind([]).camera.position.x, "without the box the camera passes into the wall").toBeLessThan(DHARMA_KEEP_OUT.maxX);
    const { x, y, z } = behind([DHARMA_KEEP_OUT]).camera.position;
    expect(x).toBeGreaterThanOrEqual(DHARMA_KEEP_OUT.maxX);
    expect(z).toBeCloseTo(DHARMA_ORIGIN.z, 1);
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

describe("the 법당's camera clearance", () => {
  const SOLIDS = ["structure", "ceiling", "mural", "halo", "lotus"];

  // Every triangle the room draws that the lens could end up against, in world metres, with each one's bounding box and the
  // floor-plan cells it touches, so a lens position only has to test the triangles in the cells around it.
  const CELL = 1;
  const loadRoom = (): { corners: number[]; low: Float32Array; high: Float32Array; count: number; cells: Map<string, number[]> } => {
    const glb = loadGlb(new URL("../src/assets/models/dharma.glb", import.meta.url));
    const corners = SOLIDS.flatMap((name) => triangleCorners(glb, name));
    for (let i = 0; i < corners.length; i += 3) {
      const placed = dharmaToWorld(corners[i] as number, corners[i + 2] as number);
      corners[i] = placed.x;
      corners[i + 2] = placed.z;
    }
    const count = corners.length / 9;
    const low = new Float32Array(count * 3);
    const high = new Float32Array(count * 3);
    for (let t = 0; t < count; t += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const values = [0, 3, 6].map((corner) => corners[t * 9 + corner + axis] as number);
        low[t * 3 + axis] = Math.min(...values);
        high[t * 3 + axis] = Math.max(...values);
      }
    }
    const cells = new Map<string, number[]>();
    for (let t = 0; t < count; t += 1) {
      for (let ix = Math.floor(low[t * 3]! / CELL); ix <= Math.floor(high[t * 3]! / CELL); ix += 1) {
        for (let iz = Math.floor(low[t * 3 + 2]! / CELL); iz <= Math.floor(high[t * 3 + 2]! / CELL); iz += 1) {
          const key = `${ix},${iz}`;
          const list = cells.get(key);
          if (list) list.push(t);
          else cells.set(key, [t]);
        }
      }
    }
    return { corners, low, high, count, cells };
  };
  let loaded: ReturnType<typeof loadRoom> | undefined;
  const room = (): ReturnType<typeof loadRoom> => (loaded ??= loadRoom());

  // Rays through the whole picture and a tenth of a margin beyond its edges.
  const fan: Vector2[] = [];
  for (let row = 0; row < 7; row += 1) for (let column = 0; column < 9; column += 1) fan.push(new Vector2((column / 8) * 2.2 - 1.1, 1.1 - (row / 6) * 2.2));

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const hit = new Vector3();
  const raycaster = new Raycaster();

  // How near the lens comes to a surface of the room that faces it, in the picture or just outside it; `limit` when nothing is nearer.
  const clearanceAt = (room: ReturnType<typeof loadRoom>, camera: PerspectiveCamera, limit: number): number => {
    const { x, y, z } = camera.position;
    const { low, high, cells } = room;
    const candidates = new Set<number>();
    for (let ix = Math.floor((x - limit) / CELL); ix <= Math.floor((x + limit) / CELL); ix += 1) {
      for (let iz = Math.floor((z - limit) / CELL); iz <= Math.floor((z + limit) / CELL); iz += 1) {
        for (const t of cells.get(`${ix},${iz}`) ?? []) candidates.add(t);
      }
    }
    const near: number[] = [];
    for (const t of candidates) {
      if (low[t * 3]! > x + limit || high[t * 3]! < x - limit) continue;
      if (low[t * 3 + 1]! > y + limit || high[t * 3 + 1]! < y - limit) continue;
      if (low[t * 3 + 2]! > z + limit || high[t * 3 + 2]! < z - limit) continue;
      near.push(t);
    }
    const rays = fan.map((point) => {
      raycaster.setFromCamera(point, camera);
      return raycaster.ray.clone();
    });
    let best = limit;
    for (const t of near) {
      a.fromArray(room.corners, t * 9);
      b.fromArray(room.corners, t * 9 + 3);
      c.fromArray(room.corners, t * 9 + 6);
      for (const ray of rays) {
        if (ray.intersectTriangle(a, b, c, true, hit)) best = Math.min(best, hit.distanceTo(ray.origin));
      }
    }
    return best;
  };

  const span = (from: number, to: number, step: number): number[] =>
    Array.from({ length: Math.ceil((to - from) / step) + 1 }, (_, i) => Math.min(to, from + i * step));

  // The nearest the lens ever comes to the room, following a monk to every spot on the walkable floor, on a phone and on a desktop
  // screen, with the camera swung to each extreme of its idle sway.
  const nearestLens = (room: ReturnType<typeof loadRoom>, bounds: Box, keepOut: readonly Box[]): { clearance: number; where: string } => {
    const view = viewFor("dharma", 1);
    const limits = regionFor("dharma").limits;
    let worst = { clearance: Infinity, where: "" };
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ] as const) {
      const camera = new PerspectiveCamera();
      const rig = new CameraRig(camera, bounds, limits, keepOut, WORLD_SOLIDS);
      rig.reduceMotion = true;
      rig.distance = view.distance;
      configureCamera(camera, rig, width, height, 100, 112);
      for (const mx of span(DHARMA_BOUNDS.minX, DHARMA_BOUNDS.maxX, 0.8)) {
        for (const mz of span(DHARMA_BOUNDS.minZ, DHARMA_BOUNDS.maxZ, 0.8)) {
          for (const yaw of [-SWAY.yaw, 0, SWAY.yaw]) {
            for (const pitch of [-SWAY.pitch, 0, SWAY.pitch]) {
              rig.yaw = view.yaw + yaw;
              rig.pitch = view.pitch + pitch;
              rig.follow(mx, mz, 0, true);
              rig.update(0);
              camera.updateMatrixWorld(true);
              const clearance = clearanceAt(room, camera, CAMERA_CLEARANCE * 2);
              if (clearance < worst.clearance) {
                const { x, y, z } = camera.position;
                const lens = worldToDharma(x, z);
                const follow = worldToDharma(mx, mz);
                const [lx, lz] = [lens.x, lens.z].map((v) => v.toFixed(2));
                const [fx, fz] = [follow.x, follow.z].map((v) => v.toFixed(1));
                worst = { clearance, where: `${width}x${height}, following room (${fx}, ${fz}) with yaw ${yaw}, pitch ${pitch}: lens at room (${lx}, ${y.toFixed(2)}, ${lz})` };
              }
            }
          }
        }
      }
    }
    return worst;
  };

  it("keeps the lens at least the clearance from every surface the room draws, wherever the monk stands and however the camera sways", () => {
    const worst = nearestLens(room(), DHARMA_CAMERA_BOUNDS, DHARMA_KEEP_OUTS);
    expect(worst.clearance, worst.where).toBeGreaterThanOrEqual(CAMERA_CLEARANCE);
  }, 30_000);

  it("catches the camera box that let the lens up into the beams, which the rule above is there to prevent", () => {
    const old = { ...DHARMA_CAMERA_BOUNDS, minZ: DHARMA_ORIGIN.z - 9.6, maxZ: DHARMA_ORIGIN.z + 9.6, maxY: 7 };
    expect(nearestLens(room(), old, [DHARMA_KEEP_OUT]).clearance).toBeLessThan(CAMERA_CLEARANCE);
  }, 30_000);

  it("keeps a keep-out box round each front pillar, wider than the pillar by the clearance", () => {
    expect(DHARMA_KEEP_OUTS).toEqual([DHARMA_KEEP_OUT, ...DHARMA_PILLARS_KEEP_OUT]);
    expect(DHARMA_PILLARS_KEEP_OUT).toHaveLength(FRONT_PILLARS_X.length);
    FRONT_PILLARS_X.forEach((x, i) => {
      const pillar = DHARMA_PILLARS_KEEP_OUT[i] as Box;
      // A pillar at x across the front wall stands at z = DHARMA_ORIGIN.z - x in the world, on the wall's outside face at x = DHARMA_ORIGIN.x + frontZ.
      const across = dharmaToWorld(x, DHARMA.frontZ).z;
      expect(across - pillar.minZ).toBeGreaterThanOrEqual(CAMERA_CLEARANCE + 0.28);
      expect(pillar.maxZ - across).toBeGreaterThanOrEqual(CAMERA_CLEARANCE + 0.28);
      expect(pillar.maxX).toBe(DHARMA_ORIGIN.x + DHARMA.frontZ);
    });
  });

  it("lifts the lens out of the front pillars and the window sills when a monk stands along the front wall", () => {
    const front = [...DHARMA_PILLARS_KEEP_OUT, ...DHARMA_SILLS];
    expect(DHARMA_SILLS).toHaveLength(WALL_OPENINGS.filter((opening) => opening.wall === "front").length);
    expect(WORLD_SOLIDS).toEqual(expect.arrayContaining(front));
    const inside = (solids: readonly Box[]): number => {
      const view = viewFor("dharma", 1);
      const region = regionFor("dharma");
      let count = 0;
      for (const x of span(-DHARMA.halfWidth + 1, DHARMA.halfWidth - 1, 0.1)) {
        const rig = new CameraRig(new PerspectiveCamera(), region.bounds, region.limits, DHARMA_KEEP_OUTS, solids);
        rig.reduceMotion = true;
        rig.yaw = view.yaw;
        rig.pitch = view.pitch;
        rig.distance = view.distance;
        const monk = dharmaToWorld(x, DHARMA_ROOM.maxZ);
        rig.follow(monk.x, monk.z, 0, true);
        rig.update(0);
        const { position } = rig.camera;
        if (front.some((box) => position.x > box.minX && position.x < box.maxX && position.y > box.minY && position.y < box.maxY && position.z > box.minZ && position.z < box.maxZ)) count += 1;
      }
      return count;
    };
    expect(inside([]), "without the solids the lens ends up in them").toBeGreaterThan(0);
    expect(inside(WORLD_SOLIDS)).toBe(0);
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
    const camera = inRoomFrame(DHARMA_CAMERA_BOUNDS);
    const floor = inRoomFrame(DHARMA_BOUNDS);
    expect(camera.minX).toBeGreaterThan(-DHARMA.halfWidth);
    expect(camera.maxX).toBeLessThan(DHARMA.halfWidth);
    expect(camera.maxZ).toBeLessThan(DHARMA.frontZ);
    // The side pillars stand just outside the floor's edge, so the box stops up to the clearance short of it.
    expect(camera.minX - floor.minX).toBeLessThanOrEqual(CAMERA_CLEARANCE + 1e-9);
    expect(floor.maxX - camera.maxX).toBeLessThanOrEqual(CAMERA_CLEARANCE + 1e-9);
    expect(regionFor("dharma").bounds).toBe(DHARMA_CAMERA_BOUNDS);
  });

  it("points forward toward Gatbawi at yaw 0 and rotates with orbit", () => {
    const rig = make();
    rig.yaw = 0;
    expect(rig.forward.z).toBeCloseTo(-1, 6);
    rig.yaw = Math.PI / 2;
    expect(rig.forward.x).toBeCloseTo(-1, 6);
  });

  it("opens in the 법당 looking from the door toward the altar, the way the room is turned", () => {
    const rig = make();
    rig.yaw = viewFor("dharma", 1.6).yaw;
    const door = dharmaToWorld(0, DHARMA.frontZ);
    const altar = dharmaToWorld(BUDDHA_AT.x, BUDDHA_AT.z);
    const length = Math.hypot(altar.x - door.x, altar.z - door.z);
    expect(rig.forward.x).toBeCloseTo((altar.x - door.x) / length, 6);
    expect(rig.forward.z).toBeCloseTo((altar.z - door.z) / length, 6);
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
  const plazaBack = { x: 0, z: 14 };

  const frame = (width: number, height: number, view = viewFor("gatbawi", width / height)): CameraRig => {
    const rig = new CameraRig(new PerspectiveCamera(), LANDSCAPE_BOUNDS);
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

  it.each(SCREENS)("starts close behind the monk, with the monk between the HUD bands on %s", (_name, width, height, top, bottom) => {
    const start = startViewFor("gatbawi", width / height);
    expect(start.distance).toBeLessThan(viewFor("gatbawi", width / height).distance);
    const rig = frame(width, height, start);
    const camera = rig.camera;
    rig.reduceMotion = true;
    configureCamera(camera, rig, width, height, top, bottom);
    rig.follow(plazaBack.x, plazaBack.z, 0, true);
    rig.update(0.016);
    camera.updateMatrixWorld();
    const screenY = (y: number) => ((1 - new Vector3(plazaBack.x, y, plazaBack.z).project(camera).y) / 2) * height;
    expect(screenY(1.5)).toBeGreaterThan(top);
    expect(screenY(0)).toBeLessThan(height - bottom);
  });

  it.each(SCREENS)("starts inside the 법당 with the monk, wherever the arrival puts them, between the HUD bands on %s", (_name, width, height, top, bottom) => {
    const region = regionFor("dharma");
    const start = startViewFor("dharma", width / height);
    for (const x of [ARRIVAL.x - ARRIVAL.spread / 2, ARRIVAL.x, ARRIVAL.x + ARRIVAL.spread / 2]) {
      const rig = new CameraRig(new PerspectiveCamera(), region.bounds);
      rig.setRegion(region.bounds, region.limits);
      rig.yaw = start.yaw;
      rig.pitch = start.pitch;
      rig.distance = start.distance;
      rig.reduceMotion = true;
      configureCamera(rig.camera, rig, width, height, top, bottom);
      rig.follow(x, ARRIVAL.z, 0, true);
      rig.update(0.016);
      rig.camera.updateMatrixWorld();
      expect(pointInRoom(rig.camera.position), `camera inside the room for a monk at ${x}`).toBe(true);
      expect(rig.camera.position.distanceTo(new Vector3(x, 1, ARRIVAL.z)), `camera clear of a monk at ${x}`).toBeGreaterThan(3.5);
      const screenY = (y: number) => ((1 - new Vector3(x, y, ARRIVAL.z).project(rig.camera).y) / 2) * height;
      expect(screenY(1.5), `head of a monk at ${x}`).toBeGreaterThan(top);
      expect(screenY(0), `feet of a monk at ${x}`).toBeLessThan(height - bottom);
    }
  });

  it.each(SCREENS)("keeps Gatbawi, all fifty mats and the monk between the HUD bands on %s", (_name, width, height, top, bottom) => {
    const rig = frame(width, height);
    const camera = rig.camera;
    rig.reduceMotion = true;
    configureCamera(camera, rig, width, height, top, bottom);
    rig.follow(plazaBack.x, plazaBack.z, 0, true);
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
    const feet = screen(plazaBack.x, 0, plazaBack.z);
    const head = screen(plazaBack.x, 1.5, plazaBack.z);
    expect(head.y).toBeGreaterThan(top);
    expect(feet.y).toBeLessThan(height - bottom);
  });

  it("keeps the camera inside the bounds and in front of the trees", () => {
    const rig = frame(390, 844);
    const camera = rig.camera;
    rig.reduceMotion = true;
    rig.follow(plazaBack.x, plazaBack.z, 0, true);
    rig.update(0.016);
    const { x, y, z } = camera.position;
    expect(x).toBeGreaterThanOrEqual(LANDSCAPE_BOUNDS.minX);
    expect(x).toBeLessThanOrEqual(LANDSCAPE_BOUNDS.maxX);
    expect(y).toBeGreaterThanOrEqual(LANDSCAPE_BOUNDS.minY);
    expect(y).toBeLessThanOrEqual(LANDSCAPE_BOUNDS.maxY);
    expect(z).toBeLessThanOrEqual(LANDSCAPE_BOUNDS.maxZ);
    expect(z).toBeCloseTo(plazaBack.z + DEFAULT_VIEW.distance * Math.cos(DEFAULT_VIEW.pitch) * Math.cos(DEFAULT_VIEW.yaw), 2);
  });

  it("uses a wider lens on portrait screens", () => {
    expect(lensFor(390 / 844).fov).toBeGreaterThan(lensFor(1280 / 800).fov);
  });
});

describe("the casino's camera", () => {
  const { bounds, limits } = casinoRegion();
  const aisle = { x: (CASINO_AISLE_EAST.minX + CASINO_AISLE_EAST.maxX) / 2, z: (CASINO_AISLE_EAST.minZ + CASINO_AISLE_EAST.maxZ) / 2 };
  const inBox = (position: { x: number; y: number; z: number }, within: Box): boolean =>
    position.x >= within.minX && position.x <= within.maxX && position.y >= within.minY && position.y <= within.maxY && position.z >= within.minZ && position.z <= within.maxZ;

  it("keeps a keep-out box for the building beside the 법당's, from its walls to over the ridge of the sign's eave", () => {
    expect(KEEP_OUTS).toEqual([...DHARMA_KEEP_OUTS, CASINO_KEEP_OUT]);
    expect(CASINO_KEEP_OUT.minX).toBe(CASINO_SHELL.minX);
    expect(CASINO_KEEP_OUT.maxX).toBe(CASINO_SHELL.maxX);
    expect(CASINO_KEEP_OUT.minZ).toBe(CASINO_SHELL.minZ);
    expect(CASINO_KEEP_OUT.maxZ).toBe(CASINO_SHELL.maxZ);
    expect(CASINO_KEEP_OUT.maxY).toBeGreaterThan(CASINO_TOP);
    expect(CASINO_KEEP_OUT.minY).toBeLessThan(0);
  });

  it("gives the room's box over the whole room, inside its walls and above its hidden roof, with a zoom range of its own", () => {
    expect(bounds).toBe(CASINO_CAMERA_BOUNDS);
    expect(bounds.minX).toBeGreaterThan(CASINO_ROOM.minX);
    expect(bounds.maxX).toBeLessThan(CASINO_ROOM.maxX);
    expect(bounds.minZ).toBeGreaterThan(CASINO_ROOM.minZ);
    expect(bounds.maxZ).toBeLessThan(CASINO_ROOM.maxZ);
    expect(bounds.minY).toBeGreaterThan(0);
    expect(bounds.maxY, "the roof is hidden inside, so the camera may look down from above it").toBeGreaterThan(CASINO_SHELL.topY);
    for (const [x, z] of [[CASINO_FLOOR.minX, CASINO_FLOOR.minZ], [CASINO_FLOOR.maxX, CASINO_FLOOR.maxZ]] as const) {
      expect(x).toBeGreaterThan(bounds.minX);
      expect(x).toBeLessThan(bounds.maxX);
      expect(z).toBeGreaterThan(bounds.minZ);
      expect(z).toBeLessThan(bounds.maxZ);
    }
    expect(limits.minDistance).toBeLessThan(limits.maxDistance);
    expect(limits.minPitch).toBeLessThan(limits.maxPitch);
    expect(limits.maxDistance, "the room is smaller than the open air").toBeLessThan(regionFor("gatbawi").limits.maxDistance);
  });

  it("keeps a camera that follows a visitor on the aisle inside the room's box, however it is turned and zoomed", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const [pitch, distance] of [[limits.minPitch, limits.maxDistance], [limits.maxPitch, limits.maxDistance], [0.6, limits.minDistance]] as const) {
        const rig = new CameraRig(new PerspectiveCamera(), bounds, limits, [CASINO_KEEP_OUT]);
        rig.reduceMotion = true;
        rig.yaw = yaw;
        rig.pitch = pitch;
        rig.distance = distance;
        rig.follow(aisle.x, aisle.z, 1, true);
        rig.update(0.016);
        const { x, y, z } = rig.camera.position;
        expect(inBox({ x, y, z }, { ...bounds, minX: bounds.minX - 1e-6, maxX: bounds.maxX + 1e-6, minZ: bounds.minZ - 1e-6, maxZ: bounds.maxZ + 1e-6 }), `yaw ${yaw}, pitch ${pitch}, distance ${distance}: ${x}, ${y}, ${z}`).toBe(true);
      }
    }
  });

  it("stops a camera that swings round behind someone in the yard from going through the building's front", () => {
    const behind = (keepOut: readonly Box[]): CameraRig => {
      const rig = new CameraRig(new PerspectiveCamera(), LANDSCAPE_BOUNDS, undefined, keepOut);
      rig.reduceMotion = true;
      // Yaw 0 puts the camera on the +z side of the followed point: from the yard that is the building.
      rig.yaw = 0;
      rig.pitch = 0.3;
      rig.distance = 12;
      rig.follow((CASINO_YARD.minX + CASINO_YARD.maxX) / 2, CASINO_YARD.maxZ - 2, 1, true);
      rig.update(0.016);
      return rig;
    };
    const without = behind([]).camera.position;
    expect(inBox(without, CASINO_KEEP_OUT), "without the box the camera passes into the building").toBe(true);
    const { x, y, z } = behind([CASINO_KEEP_OUT]).camera.position;
    expect(inBox({ x, y, z }, CASINO_KEEP_OUT)).toBe(false);
    expect(z).toBeLessThan(CASINO_SHELL.minZ);
    expect(y).toBeGreaterThan(0);
  });

  it("lets a camera look at the casino from the shore's side: the world's bounds reach past the building", () => {
    expect(LANDSCAPE_BOUNDS.maxZ).toBeGreaterThan(CASINO_SHELL.maxZ);
  });

  describe("beside the machines", () => {
    // The rows of machines stand against the walls, so the camera's box (inside the walls) reaches into them.
    const HINT_LIFT = 0.2; // app.ts's MACHINE_HINT_LIFT: the play hint floats this far over the machine's top
    const eastRow = MACHINE_SPOTS.filter((spot) => spot.x > CASINO_AISLE_EAST.maxX);
    const grid = { pitches: [limits.minPitch, 0.3, 0.62, 0.9], distances: [limits.minDistance, 4, 8, limits.maxDistance] };

    // The camera of a visitor standing at the front of `spot`, turned and zoomed as given, in a window of 1280 by 800.
    function viewAt(spot: MachineSpot, yaw: number, pitch: number, distance: number, solids: readonly Box[] = CASINO_MACHINE_BOXES): PerspectiveCamera {
      const camera = new PerspectiveCamera();
      const rig = new CameraRig(camera, bounds, limits, KEEP_OUTS, solids);
      rig.reduceMotion = true;
      rig.yaw = yaw;
      rig.pitch = pitch;
      rig.distance = distance;
      configureCamera(camera, rig, 1280, 800, 0, 0);
      rig.follow(spot.frontX, spot.frontZ, 1, true);
      rig.update(0.016);
      camera.updateMatrixWorld();
      return camera;
    }

    const bodyAt = ({ x, y, z }: { x: number; y: number; z: number }): MachineSpot | undefined =>
      MACHINE_SPOTS.find((other) => {
        const footprint = machineFootprint(other);
        return x > footprint.minX && x < footprint.maxX && z > footprint.minZ && z < footprint.maxZ && y < machineHeight(other.kind);
      });

    it("holds a box over each machine: its body widened by the camera's clearance, and inside the building's keep-out", () => {
      expect(CASINO_MACHINE_BOXES).toHaveLength(MACHINE_SPOTS.length);
      MACHINE_SPOTS.forEach((spot, index) => {
        const footprint = machineFootprint(spot);
        const held = CASINO_MACHINE_BOXES[index] as Box;
        expect(held.minX).toBeCloseTo(footprint.minX - CAMERA_CLEARANCE, 9);
        expect(held.maxX).toBeCloseTo(footprint.maxX + CAMERA_CLEARANCE, 9);
        expect(held.minZ).toBeCloseTo(footprint.minZ - CAMERA_CLEARANCE, 9);
        expect(held.maxZ).toBeCloseTo(footprint.maxZ + CAMERA_CLEARANCE, 9);
        expect(held.maxY).toBeCloseTo(machineHeight(spot.kind) + CAMERA_CLEARANCE, 9);
        expect(held.minY).toBeLessThan(0);
        expect(held.minX, spot.id).toBeGreaterThan(CASINO_KEEP_OUT.minX);
        expect(held.maxX, spot.id).toBeLessThan(CASINO_KEEP_OUT.maxX);
        expect(held.minZ, spot.id).toBeGreaterThan(CASINO_KEEP_OUT.minZ);
        expect(held.maxZ, spot.id).toBeLessThan(CASINO_KEEP_OUT.maxZ);
      });
    });

    it("never ends up inside a machine, with the visitor at any machine, however the camera is turned and zoomed", () => {
      for (const spot of MACHINE_SPOTS) {
        for (let turn = 0; turn < 8; turn += 1) {
          for (const pitch of [limits.minPitch, 0.4, 0.8, limits.maxPitch]) {
            for (const distance of [limits.minDistance, 5, limits.maxDistance]) {
              const { x, y, z } = viewAt(spot, (turn * Math.PI) / 4, pitch, distance).position;
              const label = `${spot.id}, yaw ${turn}/8 turn, pitch ${pitch}, distance ${distance}: ${x}, ${y}, ${z}`;
              expect(bodyAt({ x, y, z })?.id, label).toBeUndefined();
              expect(x, label).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
              expect(x, label).toBeLessThanOrEqual(bounds.maxX + 1e-6);
              expect(y, label).toBeLessThanOrEqual(bounds.maxY + 1e-6);
              expect(z, label).toBeGreaterThanOrEqual(bounds.minZ - 1e-6);
              expect(z, label).toBeLessThanOrEqual(bounds.maxZ + 1e-6);
            }
          }
        }
      }
    });

    it("keeps the play hint on screen at the east wall's machines when the camera is turned a quarter turn, which pushes it against the wall", () => {
      const anchorShows = (camera: PerspectiveCamera, spot: MachineSpot): boolean =>
        projectToCanvas(camera, spot.x, machineHeight(spot.kind) + HINT_LIFT, spot.z, 1280, 800, { x: 0, y: 0 });
      let insideWithout = 0;
      let hiddenWithout = 0;
      for (const spot of eastRow) {
        for (const pitch of grid.pitches) {
          for (const distance of grid.distances) {
            const before = viewAt(spot, Math.PI / 2, pitch, distance, []);
            if (bodyAt(before.position)) insideWithout += 1;
            if (!anchorShows(before, spot)) hiddenWithout += 1;
            const after = viewAt(spot, Math.PI / 2, pitch, distance);
            const { x, y, z } = after.position;
            expect(bodyAt({ x, y, z }), `${spot.id}, pitch ${pitch}, distance ${distance}: ${x}, ${y}, ${z}`).toBeUndefined();
            expect(anchorShows(after, spot), `${spot.id}, pitch ${pitch}, distance ${distance}`).toBe(true);
          }
        }
      }
      expect(insideWithout, "without the boxes the camera ends up in the machines' bodies").toBeGreaterThan(0);
      expect(hiddenWithout, "and then the hint is off screen").toBeGreaterThan(0);
    });

    it("pins the failing case: a visitor at the east row's first machine, the camera low and far against the wall", () => {
      const spot = eastRow.reduce((first, other) => (other.z < first.z ? other : first));
      const before = viewAt(spot, Math.PI / 2, limits.minPitch, limits.maxDistance, []).position;
      expect(before.x).toBeCloseTo(bounds.maxX, 6);
      expect(bodyAt(before)?.id, "it is in a machine's body").toBeDefined();
      const after = viewAt(spot, Math.PI / 2, limits.minPitch, limits.maxDistance).position;
      expect(after.y, "now over the row, looking down").toBeGreaterThan(machineHeight("classic") + CAMERA_CLEARANCE - 1e-6);
      expect(after.x).toBeLessThanOrEqual(bounds.maxX);
    });

    it("leaves a camera that is clear of every machine where it was", () => {
      const spot = { ...(MACHINE_SPOTS[0] as MachineSpot), frontX: aisle.x, frontZ: aisle.z };
      for (const yaw of [0, Math.PI]) {
        const without = viewAt(spot, yaw, 0.62, 4, []).position;
        const raised = viewAt(spot, yaw, 0.62, 4).position;
        expect(bodyAt(without)).toBeUndefined();
        expect(raised.distanceTo(without)).toBeLessThan(1e-9);
      }
    });
  });
});
