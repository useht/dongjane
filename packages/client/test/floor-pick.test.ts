import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { aimThroughCamera, pickFloor } from "../src/game/floor-pick.ts";

function floorAt(y: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new MeshBasicMaterial());
  mesh.position.y = y;
  mesh.updateMatrixWorld();
  return mesh;
}

function boxAt(x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld();
  return mesh;
}

function down(x: number, z: number): Raycaster {
  return new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0));
}

describe("pickFloor", () => {
  it("returns the floor point under the ray", () => {
    const floor = floorAt(0);
    const point = pickFloor(down(3, -4), [{ floors: [floor], blockers: [] }]);
    expect(point?.x).toBeCloseTo(3, 6);
    expect(point?.y).toBeCloseTo(0, 6);
    expect(point?.z).toBeCloseTo(-4, 6);
  });

  it("returns null when a solid thing is in front of the floor", () => {
    const part = { floors: [floorAt(0)], blockers: [boxAt(0, 1, 0)] };
    expect(pickFloor(down(0, 0), [part])).toBeNull();
    expect(pickFloor(down(5, 5), [part])).not.toBeNull();
  });

  it("sees blockers inside a group", () => {
    const group = new Group();
    group.add(boxAt(0, 1, 0));
    group.updateMatrixWorld(true);
    expect(pickFloor(down(0, 0), [{ floors: [floorAt(0)], blockers: [group] }])).toBeNull();
  });

  it("ignores a blocker that is hidden, or that sits in a hidden group", () => {
    const hidden = boxAt(0, 1, 0);
    hidden.visible = false;
    expect(pickFloor(down(0, 0), [{ floors: [floorAt(0)], blockers: [hidden] }])).not.toBeNull();

    const group = new Group();
    group.add(boxAt(0, 1, 0));
    group.visible = false;
    group.updateMatrixWorld(true);
    expect(pickFloor(down(0, 0), [{ floors: [floorAt(0)], blockers: [group] }])).not.toBeNull();
  });

  it("returns null when the ray meets nothing", () => {
    const ray = new Raycaster(new Vector3(0, 10, 0), new Vector3(0, 1, 0));
    expect(pickFloor(ray, [{ floors: [floorAt(0)], blockers: [] }])).toBeNull();
  });

  it("takes the nearest surface across several parts of the world", () => {
    const ground = { floors: [floorAt(0)], blockers: [] };
    const room = { floors: [floorAt(0.5)], blockers: [boxAt(0, 2, 8)] };
    expect(pickFloor(down(0, 0), [ground, room])?.y).toBeCloseTo(0.5, 6);
    expect(pickFloor(down(0, 8), [ground, room])).toBeNull();
    expect(pickFloor(down(0, 0), [ground])?.y).toBeCloseTo(0, 6);
  });
});

describe("aimThroughCamera", () => {
  const NEAR = 0.1;
  const screenPoints = [new Vector2(0, 0), new Vector2(1, 1), new Vector2(-1, 1), new Vector2(1, -1), new Vector2(-1, -1)];

  // Five metres up, looking straight down at the floor, with a wide lens.
  function lookingDown(): PerspectiveCamera {
    const camera = new PerspectiveCamera(62, 16 / 9, NEAR, 80);
    camera.position.set(0, 5, 0);
    camera.rotation.x = -Math.PI / 2;
    camera.updateMatrixWorld(true);
    return camera;
  }

  function pickThrough(camera: PerspectiveCamera, ndc: Vector2, blockers: Mesh[]): Vector3 | null {
    const raycaster = new Raycaster();
    aimThroughCamera(raycaster, ndc, camera);
    return pickFloor(raycaster, [{ floors: [floorAt(0)], blockers }]);
  }

  it("starts a ray straight ahead at the near plane", () => {
    const raycaster = new Raycaster();
    aimThroughCamera(raycaster, new Vector2(0, 0), lookingDown());
    expect(raycaster.near).toBeCloseTo(NEAR, 6);
  });

  it("starts a slanted ray where it crosses the near plane, which is measured along the view axis", () => {
    const camera = lookingDown();
    const raycaster = new Raycaster();
    aimThroughCamera(raycaster, new Vector2(1, 1), camera);
    expect(raycaster.near).toBeGreaterThan(NEAR * 1.5);
    const start = raycaster.ray.at(raycaster.near, new Vector3()).applyMatrix4(camera.matrixWorldInverse);
    expect(-start.z).toBeCloseTo(NEAR, 6);
  });

  it("lets a tap through a surface the lens clips, even at the edge of the view", () => {
    // 0.08 m ahead along the axis, a corner ray meets it at about 0.13 m: past the near distance, but never drawn.
    const clipped = floorAt(4.92);
    for (const ndc of screenPoints) {
      const point = pickThrough(lookingDown(), ndc, [clipped]);
      expect(point?.y).toBeCloseTo(0, 6);
    }
  });

  it("still stops a tap at a surface the lens draws", () => {
    const drawn = floorAt(4.88);
    for (const ndc of screenPoints) expect(pickThrough(lookingDown(), ndc, [drawn])).toBeNull();
    expect(pickThrough(lookingDown(), new Vector2(0, 0), [boxAt(0, 3.5, 0)])).toBeNull();
  });

  it("answers by what the lens draws as the camera sways past a surface it is brushing", () => {
    const surface = floorAt(4);
    for (const gap of [0.02, 0.05, 0.08, 0.12, 0.15, 0.3]) {
      const camera = lookingDown();
      camera.position.y = 4 + gap;
      camera.updateMatrixWorld(true);
      const point = pickThrough(camera, new Vector2(0.3, -0.2), [surface]);
      if (gap < NEAR) expect(point?.y).toBeCloseTo(0, 6);
      else expect(point).toBeNull();
    }
  });
});
