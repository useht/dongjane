// What the Blender build promises and the runtime relies on. Pure data: the build script, the
// loader and the tests all read these lists, so a rename is made here once.
//
// Every listed name is a root node of its .glb with an identity transform: exactly one mesh, one
// triangle primitive and one material. No skins, animations, cameras, lights or extensions.
// Axes are three's: forward is -Z, up is +Y. Names are camelCase letters and digits only.

export const GATBAWI_MESHES = ["figure", "hatStone", "pedestal", "offerings"] as const;

export const WORLD_MESHES = ["ground", "steps", "rocks", "pine", "maple", "temple", "templeDoor", "mat"] as const;

// Authored at the origin; the runtime instances them at the mat spots.
export const WORLD_PROTOTYPES = ["mat"] as const;

// The open-air stage, its screen, the poles of the lantern canopy and one lantern to instance.
export const VENUE_MESHES = ["stage", "screen", "truss", "poles", "lantern"] as const;

// Authored at the origin, hook at the top; the runtime hangs them from the strings.
export const VENUE_PROTOTYPES = ["lantern"] as const;

// The temple's inside, loaded after the first frame: the room, the door that leads back out, the Buddha and one seat to instance.
export const DHARMA_MESHES = ["floor", "structure", "ceiling", "paper", "door", "mural", "buddha", "lotus", "halo", "glow", "seat"] as const;

// Authored at the origin; the runtime instances them at the seat spots.
export const DHARMA_PROTOTYPES = ["seat"] as const;

// Carry TEXCOORD_0 and a texture; every other mesh carries COLOR_0 instead.
export const TEXTURED = ["figure", "hatStone", "pedestal", "ground", "steps", "rocks", "mat"] as const;

export const BUDGET = {
  gatbawi: { bytes: 1_200_000, tris: 30_000 },
  world: { bytes: 1_600_000, tris: 46_000 },
  venue: { bytes: 450_000, tris: 25_000 },
  dharma: { bytes: 1_500_000, tris: 45_000 },
  // The sum of the actual file sizes of every glb loaded before the first frame (gatbawi, world,
  // venue); the lazy one (dharma) is held to its own budget instead.
  totalBytes: 3_000_000,
} as const;
