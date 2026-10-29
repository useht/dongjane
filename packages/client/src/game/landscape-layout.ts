// Plain numbers about the outdoor scene that the runtime and its tests share. The statue, the
// plaza and the mats come from @dongjane/shared; only what is drawn around them is spelled here.

// The afternoon sun stands front-left of the plaza, so Gatbawi's face and the kneeling monks are lit.
export const SUN_POSITION = [-12, 15, 6] as const;
export const SUN_TARGET = [0, 1, -1] as const;
// The moon rises over the statue, in front of the default view.
export const MOON_DIRECTION = [0.3, 0.5, -0.8] as const;

export const SKY_RADIUS = 70;
export const SHADOW_HALF_EXTENT = 10;

// Where the camera may be. The ground and the far trees reach much further; these keep the lens
// beside the plaza, short of the trees and in front of the steps.
export const LANDSCAPE_BOUNDS = {
  minX: -7,
  maxX: 7,
  minZ: -2.6,
  maxZ: 15,
  minY: 0.5,
  maxY: 12,
} as const;
