import { Vector3 } from "three";
import type { Intersection, Object3D, PerspectiveCamera, Raycaster, Vector2 } from "three";

// What a tap can land on in one part of the world: ground a monk may stand on, and the solid things that hide the ground behind them.
export interface FloorSurfaces {
  readonly floors: readonly Object3D[];
  readonly blockers: readonly Object3D[];
}

const lookDirection = new Vector3();

// Aims the ray through a screen point, starting where the renderer starts drawing. It clips whatever is nearer than the
// camera's near plane, measured along the view axis, so a slanted ray starts further out than `near`. What the lens never
// shows (a column the camera is brushing past) is then not something a tap can land on.
export function aimThroughCamera(raycaster: Raycaster, ndc: Vector2, camera: PerspectiveCamera): void {
  raycaster.setFromCamera(ndc, camera);
  camera.getWorldDirection(lookDirection);
  raycaster.near = camera.near / raycaster.ray.direction.dot(lookDirection);
}

// Raycasting ignores `visible`, so a hidden wall or roof (the 법당's cutaway) has to be skipped by hand.
function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

// The nearest thing the ray meets, floor or solid, skipping what is hidden.
export function pickHit(raycaster: Raycaster, parts: readonly FloorSurfaces[]): Intersection | null {
  const targets: Object3D[] = [];
  for (const part of parts) targets.push(...part.floors, ...part.blockers);
  return raycaster.intersectObjects(targets, true).find((candidate) => shown(candidate.object)) ?? null;
}

// The floor point under the ray, or null when something solid is in front of it (or the ray meets nothing).
export function pickFloor(raycaster: Raycaster, parts: readonly FloorSurfaces[]): Vector3 | null {
  const hit = pickHit(raycaster, parts);
  if (!hit) return null;
  for (const part of parts) {
    if (part.floors.some((floor) => floor === hit.object)) return hit.point;
  }
  return null;
}
