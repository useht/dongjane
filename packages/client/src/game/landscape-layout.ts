// Plain numbers about the outdoor scene that the runtime and its tests share. The statue, the
// plaza and the mats come from @dongjane/shared; only what is drawn around them is spelled here.

// The afternoon sun stands front-left of the plaza, so Gatbawi's face and the kneeling monks are lit.
export const SUN_POSITION = [-9.5, 15, 12.5] as const;
export const SUN_TARGET = [2.5, 1, 6.5] as const;
// The moon rises over the statue, in front of the default view.
export const MOON_DIRECTION = [0.3, 0.5, -0.8] as const;

export const SKY_RADIUS = 70;
export const SHADOW_HALF_EXTENT = 15;

// Where the camera may be outdoors. The ground and the far trees reach much further; these keep the lens
// above the plaza, the court and the stage, short of the trees and in front of the steps. On the west it
// reaches past the 법당's far wall, so the camera can follow a visitor all along its front.
export const LANDSCAPE_BOUNDS = {
  minX: -31,
  maxX: 14,
  minZ: -2.6,
  maxZ: 30,
  minY: 0.5,
  maxY: 14,
} as const;
