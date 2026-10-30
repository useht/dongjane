// What the Blender build promises and the runtime relies on. Pure data: the build script, the
// loader and the tests all read these lists, so a rename is made here once.
//
// Every listed name is a root node of its .glb with an identity transform: exactly one mesh, one
// triangle primitive and one material. No skins, animations, cameras, lights or extensions.
// Axes are three's: forward is -Z, up is +Y. Names are camelCase letters and digits only.

// Gatbawi's hat stone, authored at unit size (the game scales it to the Buddha's head), the pedestal and the table of offerings.
// The statue itself is the scanned Buddha below, which is also the one on the 법당's altar.
export const GATBAWI_MESHES = ["hatStone", "pedestal", "offerings"] as const;

// The scanned Buddha: one mesh stood on the origin facing +Z, `height` tall, with at most `maxTriangles` triangles and one grey
// picture of its own light and shade (`textureSize` pixels square) that the game tints. Its node carries `headTop` (the middle of
// the crown, in the model's metres) and `headRadius`, which place the hat stone on the hill and the halo in the 법당.
export const BUDDHA_MESHES = ["buddha"] as const;
export const BUDDHA = { height: 1, maxTriangles: 16_000, textureSize: 1024 } as const;
export const BUDDHA_EXTRAS = ["headTop", "headRadius"] as const;

// The 법당 stands in the world as four shells: the plinth that stays, the side and back walls, the front wall (which the game
// hides when the camera looks in from the court) and the roof (hidden with it).
export const WORLD_MESHES = ["ground", "steps", "rocks", "pine", "maple", "dharmaBase", "dharmaWalls", "dharmaFront", "dharmaRoof", "mat"] as const;

// Authored at the origin; the runtime instances them at the mat spots.
export const WORLD_PROTOTYPES = ["mat"] as const;

// The open-air stage, its screen, the poles of the lantern canopy and one lantern to instance.
export const VENUE_MESHES = ["stage", "screen", "truss", "poles", "lantern"] as const;

// Authored at the origin, hook at the top; the runtime hangs them from the strings.
export const VENUE_PROTOTYPES = ["lantern"] as const;

// The 법당's inside, loaded with the others before the first frame: the room, the lotus, halo and glow behind the Buddha (who is buddha.glb) and one seat to instance.
export const DHARMA_MESHES = ["floor", "structure", "ceiling", "mural", "lotus", "halo", "glow", "seat"] as const;

// Authored at the origin; the runtime instances them at the seat spots.
export const DHARMA_PROTOTYPES = ["seat"] as const;

// The casino at the end of the coast road. Outside: the walls, the front wall (with the doorway and the sign tower) and the roof, of
// which the game hides the front and the roof while a visitor is inside; the paving of the road and the yard; the board of the
// sign and the lit windows, which glow. Inside: the carpet, the coffered ceiling, two gold columns and the neon strips.
export const CASINO_MESHES = [
  "casinoWalls",
  "casinoFront",
  "casinoRoof",
  "casinoSign",
  "casinoNeon",
  "casinoYard",
  "coastRoad",
  "casinoFloor",
  "casinoCeiling",
  "casinoColumns",
  "slotCabinet",
  "rouletteTable",
  "scratchKiosk",
] as const;

// Authored at the origin, centred on their footprint with the front toward -z; the runtime instances them at the machine spots.
export const CASINO_PROTOTYPES = ["slotCabinet", "rouletteTable", "scratchKiosk"] as const;

// Carry TEXCOORD_0 and a texture; every other mesh carries COLOR_0 instead.
export const TEXTURED = ["buddha", "ground", "steps", "rocks", "mat", "casinoFloor"] as const;

// Carry TEXCOORD_0 and COLOR_0 but no picture of their own: the game gives them the rock picture of world.glb's steps and
// rocks, so each picture is stored once in the files the first frame loads.
export const BORROWS_STONE = ["hatStone", "pedestal"] as const;

// Likewise, the road and the yard carry TEXCOORD_0 and COLOR_0 and are given the paving picture of world.glb's ground.
export const BORROWS_PAVING = ["casinoYard", "coastRoad"] as const;

export const BUDGET = {
  gatbawi: { bytes: 250_000, tris: 6_000 },
  buddha: { bytes: 750_000, tris: BUDDHA.maxTriangles },
  world: { bytes: 2_000_000, tris: 46_000 },
  venue: { bytes: 450_000, tris: 25_000 },
  dharma: { bytes: 1_000_000, tris: 45_000 },
  casino: { bytes: 800_000, tris: 25_000 },
  // The monk is the Korean monk main ships (assets/monk/monk.glb, built by its own script); main.ts loads it before the first frame.
  monk: { bytes: 95_000 },
  // The sum of the actual file sizes of every glb and the monk; raised from 3_000_000 because the room is now part of the first frame,
  // and from 4_000_000 because the casino (787 kB with its two carpet pictures and 12k triangles) loads with them.
  totalBytes: 4_800_000,
} as const;
