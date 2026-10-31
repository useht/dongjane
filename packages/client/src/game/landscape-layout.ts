// Plain numbers about the outdoor scene that the runtime and its tests share. The statue, the
// plaza and the mats come from @dongjane/shared; only what is drawn around them is spelled here.

// The afternoon sun stands front-left of the plaza, so Gatbawi's face and the kneeling monks are lit.
export const SUN_POSITION = [-9.5, 15, 12.5] as const;
export const SUN_TARGET = [2.5, 1, 6.5] as const;
// The moon rises over the statue, in front of the default view.
export const MOON_DIRECTION = [0.3, 0.5, -0.8] as const;

// The scanned Buddha (buddha.glb, 1 m tall) is scaled to `height` and stood on the pedestal's top, `seatY` above the platform
// and `seatZ` in front of the pedestal's foot (gatbawi.py draws the pedestal to match). The hat stone is authored one metre
// in radius; the game makes its radius `hatHeads` head radii (the head's radius is in the glb) and sinks its underside
// `hatSink` head radii under the crown, so the topknot is hidden in it.
export const GATBAWI_STATUE = { height: 3.4, seatY: 0.72, seatZ: 0.05, hatHeads: 2.3, hatSink: 0.5 } as const;

export const SKY_RADIUS = 70;
export const SHADOW_HALF_EXTENT = 15;

// Where the camera may be outdoors. The ground and the far trees reach much further; these keep the lens
// above the plaza, the court and the stage, short of the trees and in front of the steps. On the west it
// reaches past the 법당's back wall (its front faces the plaza), so the camera can follow a visitor along the court. On the east it
// reaches over the sand and a little way out over the sea, so a visitor at the waterline is framed with the water. On the south it reaches past the casino's back wall, so the camera can follow a visitor down the coast road to its door and, outside it, round the whole building.
export const LANDSCAPE_BOUNDS = {
  minX: -31,
  maxX: 24,
  minZ: -2.6,
  maxZ: 74,
  minY: 0.5,
  maxY: 14,
} as const;
