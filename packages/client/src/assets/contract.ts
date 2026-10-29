// What the Blender build promises and the runtime relies on. Pure data: the build script, the
// loader and the tests all read these lists, so a rename is made here once.
//
// Every listed name is a root node of its .glb with an identity transform: exactly one mesh, one
// triangle primitive and one material. No skins, animations, cameras, lights or extensions.
// Axes are three's: forward is -Z, up is +Y. Names are camelCase letters and digits only.

export const MONK_PARTS = ["head", "face", "skirt", "torso", "trim", "sleeveUpper", "sleeveLower", "hand", "foot"] as const;

export const HALL_MESHES = [
  "structure",
  "beams",
  "paper",
  "floor",
  "backdrop",
  "lanterns",
  "outdoor",
  "sky",
  "sunbeams",
  "cushionBody",
  "cushionTop",
] as const;

// Authored at the origin; the runtime instances them at the cushion spots.
export const HALL_PROTOTYPES = ["cushionBody", "cushionTop"] as const;

export const BUDDHA_MESHES = ["figure", "lotus", "halo", "glow"] as const;

// Carry TEXCOORD_0 and a texture; every other mesh carries COLOR_0 instead.
export const TEXTURED = ["floor", "backdrop", "sky", "sunbeams", "cushionTop"] as const;

export const BUDGET = {
  monk: { bytes: 120_000, tris: 2_600 },
  buddha: { bytes: 450_000, tris: 25_000 },
  hall: { bytes: 2_200_000, tris: 60_000 },
  totalBytes: 2_800_000,
} as const;

export type MonkPart = (typeof MONK_PARTS)[number];
