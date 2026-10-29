// What the Blender build promises and the runtime relies on. Pure data: the build script, the
// loader and the tests all read these lists, so a rename is made here once.
//
// Every listed name is a root node of its .glb with an identity transform: exactly one mesh, one
// triangle primitive and one material. No skins, animations, cameras, lights or extensions.
// Axes are three's: forward is -Z, up is +Y. Names are camelCase letters and digits only.

export const MONK_PARTS = ["head", "face", "skirt", "torso", "trim", "sleeveUpper", "sleeveLower", "hand", "foot"] as const;

export const GATBAWI_MESHES = ["figure", "hatStone", "pedestal", "offerings"] as const;

export const WORLD_MESHES = ["ground", "steps", "rocks", "pine", "maple", "temple", "templeDoor", "mat"] as const;

// Authored at the origin; the runtime instances them at the mat spots.
export const WORLD_PROTOTYPES = ["mat"] as const;

// The open-air stage, its screen, the poles of the lantern canopy and one lantern to instance.
export const VENUE_MESHES = ["stage", "screen", "truss", "poles", "lantern"] as const;

// Authored at the origin, hook at the top; the runtime hangs them from the strings.
export const VENUE_PROTOTYPES = ["lantern"] as const;

// Carry TEXCOORD_0 and a texture; every other mesh carries COLOR_0 instead.
export const TEXTURED = ["figure", "hatStone", "pedestal", "ground", "steps", "rocks", "mat"] as const;

export const BUDGET = {
  monk: { bytes: 120_000, tris: 2_600 },
  gatbawi: { bytes: 1_200_000, tris: 30_000 },
  world: { bytes: 1_600_000, tris: 46_000 },
  venue: { bytes: 450_000, tris: 25_000 },
  // The sum of the actual file sizes of every glb loaded before the first frame (monk, gatbawi, world,
  // venue); the lazy ones (the temple's inside) are held to their own budget instead.
  totalBytes: 3_000_000,
} as const;

export type MonkPart = (typeof MONK_PARTS)[number];
