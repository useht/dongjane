import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { pickFloor } from "../src/game/floor-pick.ts";

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
