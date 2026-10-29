"""gatbawi.glb: what stands around the stone Buddha of Palgongsan - his hat stone, his pedestal and the offerings.

The Buddha himself is buddha.glb (buddha.py); the game stands it on the pedestal's top. Everything here is drawn
in the game's own coordinates (Y up, the face toward +Z) through a Part whose frame is GAME, around one origin:
the middle of the pedestal's foot, which the game stands on the platform at GATBAWI_Z. The hat stone and the
pedestal carry UVs for the rock picture that world.glb already holds (box-projected; the game multiplies the vertex
colours into it), so this file stores no picture of its own; the offerings are plain vertex colours. The hat stone is drawn one metre in radius, centred on its underside: the game scales it to the statue's
head (its size comes from the head buddha.py measured) and sets it on the crown, and its picture is laid out
to match the size it will have.
"""

import math
import os

from mathutils import Matrix, Vector

import common
from common import GAME, SPIN_Y, Part, at, fbm, mix, rgb, scaled, smoothstep, spun

STONE_TILE = 1.6  # metres of statue per repeat of the rock picture

PEDESTAL_TIERS = ((3.4, 0.4, 1.9), (3.0, 0.32, 1.6))  # width, height, depth; stacked from y = 0

TABLE_Z = 1.25
TABLE = (2.3, 0.46)  # width, depth
TABLE_HEIGHT = 0.38
POT_COUNT = 8


def stone_tone(c, seed, size=1.0, mossy=True):
    """Granite that is a little blotchy, stained in the cracks and, when `mossy`, green near the ground.

    A function of position; `size` is the factor the game will scale the part by, so the blotches come out the size
    they would be on a part drawn at its final size."""
    granite, shade, moss = rgb(c["granite"]), rgb(c["graniteShade"]), rgb(c["moss"])
    frequency = 1.0 / size

    def tone(p):
        x, y, z = p.x * frequency, p.y * frequency, p.z * frequency
        blotch = 0.5 + 0.5 * fbm(x * 1.7, y * 1.7, z * 1.7, seed)
        base = mix(scaled(granite, 0.92 + 0.08 * blotch), shade, 0.38 * smoothstep(0.55, 0.95, blotch))
        if not mossy:
            return base
        patch = 0.5 + 0.5 * fbm(x * 3.1, y * 3.1, z * 3.1, seed + 11.0)
        low = 1.0 - smoothstep(0.05, 0.55, y)
        return mix(base, moss, min(0.7, 0.8 * low * smoothstep(0.35, 0.8, patch)))

    return tone


def pedestal(c, z):
    part = Part("pedestal", frame=GAME)
    tone = part.in_game(stone_tone(c, 3.0))
    base = 0.0
    for width, height, depth in PEDESTAL_TIERS:
        faces = part.box((0.0, base + height / 2, z), (width, height, depth), tone, skip=("-y",), cuts=(9, 2, 5))
        part.displace(faces, lambda co: tuple(0.025 * fbm(co.x * 2.3, co.y * 2.3, co.z * 2.3, seed) for seed in (1.0, 2.0, 3.0)))
        base += height
    part.project_uv(STONE_TILE)
    return part


def hat_stone(c, radius):
    """A thin, irregular slab, slightly dished and tilted, drawn one metre in radius on its underside's middle.

    `radius` is the size the game will scale it to; it sets the size of the rock picture's repeat and blotches."""
    part = Part("hatStone", frame=GAME)
    under = scaled(rgb(c["graniteShade"]), 0.8)
    upper = stone_tone(c, 12.0, radius, mossy=False)

    def tone(p):
        return mix(under, upper(p), smoothstep(-0.02, 0.06, p.y))

    def outline(height, angle):
        return 1.0 + 0.07 * fbm(math.cos(angle) * 1.6, math.sin(angle) * 1.6, 0.0, 4.0) + 0.025 * math.cos(5.0 * angle + 0.4)

    profile = ((0.0, 0.0), (0.88, 0.0), (0.99, 0.045), (1.02, 0.12), (0.98, 0.2), (0.82, 0.235), (0.3, 0.215), (0.0, 0.205))
    with part.placed(spun(0.0, 0.0, 0.0) @ Matrix.Rotation(0.035, 4, "X")):
        part.lathe(profile, 44, part.in_game(tone), fold=outline, squash=0.93)
    part.project_uv(STONE_TILE / radius)
    return part


def chrysanthemum(part, c, x, y, z, turn):
    """A pot with a round head of petals, standing at (x, y, z)."""
    pot, soil, leaf = rgb(c["pot"]), rgb(c["soil"]), rgb(c["leafGreen"])
    gold, deep = rgb(c["chrysanthemum"]), rgb(c["chrysanthemumDeep"])
    head = Vector((0.0, 0.3, 0.0))
    with part.placed(at(x, y, z)):
        with part.placed(spun(0.0, 0.0, 0.0)):
            part.lathe(
                ((0.075, 0.0), (0.1, 0.02), (0.115, 0.15), (0.125, 0.165), (0.105, 0.17), (0.09, 0.16)),
                12,
                lambda co: scaled(pot, 0.85 + 0.15 * smoothstep(0.0, 0.17, co.z)),
                cap_bottom=True,
            )
            part.lathe(((0.1, 0.158), (0.0, 0.158)), 12, soil)
        for i in range(6):
            angle = math.tau * i / 6 + turn
            reach = Vector((math.sin(angle), 0.0, math.cos(angle)))
            path = [reach * 0.05 + Vector((0.0, 0.17, 0.0)), reach * 0.12 + Vector((0.0, 0.25, 0.0)), reach * 0.17 + Vector((0.0, 0.3, 0.0))]
            part.tube(path, [0.0, 0.03, 0.0], 4, leaf, up=(0.0, 1.0, 0.0), flat=0.3)
        with part.placed(at(*head) @ SPIN_Y):
            part.sphere((0.0, 0.0, 0.0), (0.115, 0.115, 0.085), 12, 5, lambda co: mix(deep, gold, smoothstep(-0.05, 0.1, co.z)))
        for ring, (radius, rise, count, tint) in enumerate(((0.12, 0.0, 12, gold), (0.085, 0.045, 9, gold), (0.045, 0.075, 6, deep))):
            for i in range(count):
                angle = math.tau * (i + 0.5 * (ring % 2)) / count + turn
                out = Vector((math.sin(angle), 0.0, math.cos(angle)))
                path = [head + out * (radius * 0.45) + Vector((0.0, rise + 0.03, 0.0)), head + out * radius + Vector((0.0, rise + 0.045 - 0.02 * ring, 0.0))]
                part.tube(path, [0.026, 0.0], 4, tint, up=(0.0, 1.0, 0.0), flat=0.4)


def offerings(c):
    part = Part("offerings", frame=GAME)
    wood, dark = rgb(c["woodMid"]), rgb(c["woodDark"])
    width, depth = TABLE
    top = TABLE_HEIGHT
    part.box((0.0, top - 0.025, TABLE_Z), (width, 0.05, depth), lambda co: mix(wood, dark, 0.35 * smoothstep(0.1, 0.3, abs(co.x))), cuts=(8, 1, 3))
    part.box((0.0, top - 0.09, TABLE_Z), (width - 0.12, 0.08, depth - 0.1), dark, skip=("+y", "-y"))
    for sx in (-1.0, 1.0):
        for sz in (-1.0, 1.0):
            part.box((sx * (width / 2 - 0.1), (top - 0.05) / 2, TABLE_Z + sz * (depth / 2 - 0.08)), (0.08, top - 0.05, 0.08), dark, skip=("+y", "-y"))
    spacing = (width - 0.3) / (POT_COUNT - 1)
    for i in range(POT_COUNT):
        chrysanthemum(part, c, -(width - 0.3) / 2 + spacing * i, top, TABLE_Z, 0.37 * i)
    return part


def build(inputs, out_dir, head):
    """`head` is what buddha.py measured on the statue: the hat stone is made the size the game will give it."""
    c = inputs["material"]
    statue = inputs["layout"]["GATBAWI_STATUE"]
    if abs(sum(height for _, height, _ in PEDESTAL_TIERS) - statue["seatY"]) > 1e-6:
        raise RuntimeError("the pedestal is not as tall as the statue's seat in GATBAWI_STATUE")
    hat_radius = statue["hatHeads"] * head["headRadius"] * statue["height"]
    plain = common.vertex_color_material("gatbawi")
    # The hat stone is drawn at the origin, inside the pedestal: it is shaded alone, then kept out of the others' light.
    hat = hat_stone(c, hat_radius).build(plain)
    common.bake_vertex_occlusion([hat], distance=0.45 / hat_radius, samples=64, floor=0.45)
    hat.hide_render = True
    objects = {
        "hatStone": hat,
        "pedestal": pedestal(c, statue["seatZ"]).build(plain),
        "offerings": offerings(c).build(plain),
    }
    common.bake_vertex_occlusion([objects["pedestal"], objects["offerings"]], distance=0.45, samples=64, floor=0.45)
    hat.hide_render = False
    names = inputs["names"]["GATBAWI_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"gatbawi meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "gatbawi.glb"))
    print("gatbawi triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
