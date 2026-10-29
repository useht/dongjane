"""gatbawi.glb: the stone Buddha of Palgongsan with his hat stone, his pedestal and the offerings.

There is no licence-clean scan of the statue, so it is modelled by hand here. Everything is drawn in
the game's own coordinates (Y up, the face toward +Z) through a Part whose frame is GAME, around one
origin: the middle of the pedestal's foot. The game stands that origin on the platform at GATBAWI_Z.
The three stone meshes share one rock picture (box-projected UVs, vertex colours multiply it); the
offerings are plain vertex colours.
"""

import math
import os

from mathutils import Matrix, Vector

import common
from common import GAME, SPIN_Y, Part, at, fbm, interpolate, mix, rgb, scaled, smooth_profile, smoothstep, spun

SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources")
STONE_TILE = 1.6  # metres of statue per repeat of the rock picture

PEDESTAL_TIERS = ((3.4, 0.4, 1.9), (3.0, 0.32, 1.6))  # width, height, depth; stacked from y = 0
PEDESTAL_Z = 0.05
HEAD = Vector((0.0, 3.22, 0.04))
HEAD_RADII = (0.55, 0.56, 0.47)
HAT_BASE = 3.62
LAP = {"center": (0.0, 1.1, 0.1), "radii": (1.45, 0.42, 0.78)}
TORSO_BASE = 1.0
TORSO_SQUASH = 0.6
TORSO = ((1.05, 1.0), (1.0, 1.35), (0.92, 1.8), (0.88, 2.15), (0.95, 2.45), (0.72, 2.68), (0.34, 2.84), (0.3, 2.95))

TABLE_Z = 1.25
TABLE = (2.3, 0.46)  # width, depth
TABLE_HEIGHT = 0.38
POT_COUNT = 8


def stone_tone(c, seed):
    """Granite that is a little blotchy, stained in the cracks and mossy near the ground; a function of position."""
    granite, shade, moss = rgb(c["granite"]), rgb(c["graniteShade"]), rgb(c["moss"])

    def tone(p):
        blotch = 0.5 + 0.5 * fbm(p.x * 1.7, p.y * 1.7, p.z * 1.7, seed)
        base = mix(scaled(granite, 0.92 + 0.08 * blotch), shade, 0.38 * smoothstep(0.55, 0.95, blotch))
        patch = 0.5 + 0.5 * fbm(p.x * 3.1, p.y * 3.1, p.z * 3.1, seed + 11.0)
        low = 1.0 - smoothstep(0.05, 0.55, p.y)
        return mix(base, moss, min(0.7, 0.8 * low * smoothstep(0.35, 0.8, patch)))

    return tone


def head_z(x, y):
    """Where the face is at (x, y): the front of the head ellipsoid."""
    rx, ry, rz = HEAD_RADII
    inside = 1.0 - (x / rx) ** 2 - ((y - HEAD.y) / ry) ** 2
    return HEAD.z + rz * math.sqrt(max(inside, 0.0))


def torso_z(x, y):
    """Where the robe front is at (x, y): the torso lathe, flattened front to back."""
    radius = interpolate(TORSO, y)
    return TORSO_SQUASH * math.sqrt(max(radius * radius - x * x, 0.0))


def pedestal(c):
    part = Part("pedestal", frame=GAME)
    tone = part.in_game(stone_tone(c, 3.0))
    base = 0.0
    for width, height, depth in PEDESTAL_TIERS:
        faces = part.box((0.0, base + height / 2, PEDESTAL_Z), (width, height, depth), tone, skip=("-y",), cuts=(9, 2, 5))
        part.displace(faces, lambda co: tuple(0.025 * fbm(co.x * 2.3, co.y * 2.3, co.z * 2.3, seed) for seed in (1.0, 2.0, 3.0)))
        base += height
    part.project_uv(STONE_TILE)
    return part


def body(part, c):
    """The robed body: a broad lap, two knees and the torso with its pleats."""
    tone = part.in_game(stone_tone(c, 5.0))
    part.ellipsoid(LAP["center"], LAP["radii"], 40, 14, tone)
    for side in (-1.0, 1.0):
        part.ellipsoid((side * 0.92, 1.22, 0.52), (0.46, 0.3, 0.34), 20, 10, tone)

    def pleats(height, angle):
        band = smoothstep(1.05, 1.5, height) * (1.0 - smoothstep(2.3, 2.6, height))
        return 1.0 + 0.035 * band * math.cos(7.0 * angle) + 0.012 * math.cos(13.0 * angle + 1.0)

    profile = smooth_profile([(r, h - TORSO_BASE) for r, h in TORSO], 3)
    with part.placed(spun(0.0, TORSO_BASE, 0.0)):
        part.lathe(profile, 44, tone, fold=lambda h, a: pleats(h + TORSO_BASE, a), squash=TORSO_SQUASH)


def arms(part, c):
    tone = part.in_game(stone_tone(c, 7.0))
    for side in (-1.0, 1.0):
        arm = [(side * 0.86, 2.42, 0.02), (side * 1.12, 1.78, 0.08), (side * 1.03, 1.55, 0.5)]
        part.tube(arm, [0.27, 0.27, 0.21], 12, tone, up=(0.0, 0.0, 1.0))
        part.ellipsoid(arm[0], (0.27, 0.27, 0.27), 14, 8, tone)
        part.ellipsoid((side * 0.98, 1.47, 0.7), (0.21, 0.1, 0.23), 12, 6, tone)


def robe_lines(part, c):
    """A V neckline and a sash across the chest, raised a little off the robe."""
    groove = scaled(rgb(c["graniteShade"]), 0.62)
    sash_color = mix(rgb(c["graniteShade"]), rgb(c["granite"]), 0.55)
    lift = 0.03
    for side in (-1.0, 1.0):
        neck = [(side * 0.34 * t, 2.82 - 0.7 * t) for t in (1.0, 0.7, 0.4, 0.0)]
        part.tube([(x, y, torso_z(x, y) + lift) for x, y in neck], [0.026] * 4, 5, groove, up=(0.0, 0.0, 1.0), flat=0.6)
    sash = []
    for i in range(9):
        t = i / 8.0
        x, y = -0.5 + 1.15 * t, 2.62 - 0.95 * t
        sash.append((x, y, torso_z(x, y) + lift))
    part.tube(sash, [0.08] * 9, 6, sash_color, up=(0.0, 0.0, 1.0), flat=0.45)


def face(part, c):
    dark = scaled(rgb(c["graniteShade"]), 0.5)
    mid = rgb(c["graniteShade"])
    skin = part.in_game(stone_tone(c, 9.0))
    lift = 0.012

    def on_face(x, y, extra=lift):
        return (x, y, head_z(x, y) + extra)

    for side in (-1.0, 1.0):
        brow = [on_face(side * (0.08 + 0.2 * t), 3.4 + 0.035 * math.sin(math.pi * t)) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        part.tube(brow, [0.0, 0.022, 0.026, 0.02, 0.0], 5, mid, up=(0.0, 0.0, 1.0), flat=0.6)
        eye = [on_face(side * (0.09 + 0.18 * t), 3.31 - 0.02 * math.sin(math.pi * t)) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        part.tube(eye, [0.0, 0.014, 0.018, 0.014, 0.0], 5, dark, up=(0.0, 0.0, 1.0), flat=0.5)
        ear = [(side * 0.5, 3.4, 0.0), (side * 0.545, 3.12, 0.0), (side * 0.5, 2.8, 0.03)]
        part.tube(ear, [0.045, 0.075, 0.045], 6, skin, up=(1.0, 0.0, 0.0), flat=0.45)
        part.ellipsoid(on_face(side * 0.045, 3.1, 0.01), (0.022, 0.016, 0.02), 6, 4, dark)
    part.tube([on_face(0.0, 3.34), on_face(0.0, 3.24, 0.03), on_face(0.0, 3.14, 0.05)], [0.03, 0.04, 0.05], 6, skin, up=(1.0, 0.0, 0.0))
    part.ellipsoid(on_face(0.0, 3.1, 0.045), (0.07, 0.05, 0.05), 10, 6, skin)
    mouth = [on_face(x, 2.98 - 0.02 * (1.0 - (x / 0.13) ** 2) + 0.01 * (x / 0.13) ** 2) for x in (-0.13, -0.065, 0.0, 0.065, 0.13)]
    part.tube(mouth, [0.0, 0.014, 0.016, 0.014, 0.0], 5, dark, up=(0.0, 0.0, 1.0), flat=0.5)
    part.ellipsoid(on_face(0.0, 2.93, 0.018), (0.095, 0.03, 0.035), 10, 5, skin)


def figure(c):
    part = Part("figure", frame=GAME)
    body(part, c)
    arms(part, c)
    part.ellipsoid(tuple(HEAD), HEAD_RADII, 36, 20, part.in_game(stone_tone(c, 8.0)))
    face(part, c)
    robe_lines(part, c)
    part.project_uv(STONE_TILE)
    return part


def hat_stone(c):
    """A thin, irregular slab, slightly dished and tilted, overhanging the head all round."""
    part = Part("hatStone", frame=GAME)
    under = scaled(rgb(c["graniteShade"]), 0.8)
    upper = stone_tone(c, 12.0)

    def tone(p):
        return mix(under, upper(p), smoothstep(HAT_BASE - 0.02, HAT_BASE + 0.06, p.y))

    def outline(height, angle):
        return 1.0 + 0.07 * fbm(math.cos(angle) * 1.6, math.sin(angle) * 1.6, 0.0, 4.0) + 0.025 * math.cos(5.0 * angle + 0.4)

    profile = ((0.0, 0.0), (0.88, 0.0), (0.99, 0.045), (1.02, 0.12), (0.98, 0.2), (0.82, 0.235), (0.3, 0.215), (0.0, 0.205))
    with part.placed(spun(0.0, HAT_BASE, 0.02) @ Matrix.Rotation(0.035, 4, "X")):
        part.lathe(profile, 44, part.in_game(tone), fold=outline, squash=0.93)
    part.project_uv(STONE_TILE)
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


def build(inputs, out_dir):
    c = inputs["material"]
    stone = common.textured_material("gatbawi", os.path.join(SOURCES, "rock_boulder_dry_diff.jpg"), os.path.join(SOURCES, "rock_boulder_dry_nor_gl.jpg"))
    plain = common.vertex_color_material("offerings")
    objects = {
        "figure": figure(c).build(stone),
        "hatStone": hat_stone(c).build(stone),
        "pedestal": pedestal(c).build(stone),
        "offerings": offerings(c).build(plain),
    }
    common.bake_vertex_occlusion(list(objects.values()), distance=0.45, samples=64, floor=0.45)
    names = inputs["names"]["GATBAWI_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"gatbawi meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "gatbawi.glb"))
    print("gatbawi triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
