import type { Object3D, Raycaster, Vector3 } from "three";

// What a tap can land on in one part of the world: ground a monk may stand on, and the solid things that hide the ground behind them.
export interface FloorSurfaces {
  readonly floors: readonly Object3D[];
  readonly blockers: readonly Object3D[];
}

// Raycasting ignores `visible`, so a hidden wall or roof (the 법당's cutaway) has to be skipped by hand.
function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

// The floor point under the ray, or null when something solid is in front of it (or the ray meets nothing).
export function pickFloor(raycaster: Raycaster, parts: readonly FloorSurfaces[]): Vector3 | null {
  const floors = new Set<Object3D>();
  const targets: Object3D[] = [];
  for (const part of parts) {
    for (const floor of part.floors) {
      floors.add(floor);
      targets.push(floor);
    }
    targets.push(...part.blockers);
  }
  const hit = raycaster.intersectObjects(targets, true).find((candidate) => shown(candidate.object));
  return hit && floors.has(hit.object) ? hit.point : null;
}
