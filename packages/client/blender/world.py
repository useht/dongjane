"""world.glb: the plaza and its autumn mountainside, and the mat prototype.

Everything is drawn in the game's own coordinates (Y up, +Z toward the viewer) through a Part whose
frame is GAME. The plaza (flat paving the monks kneel on), the granite steps and platform, the
rocks, the pines and the maples are placed from the layout in the inputs; only the dressing of the
hillside (where the far trees and boulders go) is chosen here. The mat is built last, at the origin,
so the baked occlusion never sees it.
"""

import math
import os

from mathutils import Vector

import common
from common import GAME, Part, at, fbm, from_game, hash01, mix, rgb, scaled, smoothstep, spun, to_game

SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources")
GROUND_TILE = 1.6  # metres of ground per repeat of the paving picture
STONE_TILE = 2.4  # metres of rock per repeat of the rock picture

PLAZA_HALF = 6.5  # the paving runs this far to each side
PLAZA_MARGIN = 1.2  # and this much past the last mat row
PLATFORM_HALF = 3.8
PLATFORM_BACK = 0.7  # the platform reaches this far behind the statue's pedestal into the hill
STEP_HALF = 2.6
STEP_RISE = 0.3
GROUND_LIMIT = 64.0

# (x, z, height above ground, radii, seed, segments); the outcrop stands behind Gatbawi
OUTCROP = (
    (0.0, -11.0, 2.4, (7.2, 4.6, 3.6), 1.0, 18),
    (-5.2, -9.6, 1.2, (3.4, 3.0, 2.8), 2.0, 16),
    (5.4, -9.8, 1.4, (3.6, 3.4, 3.0), 3.0, 16),
    (1.2, -12.8, 4.6, (4.6, 3.6, 2.8), 4.0, 18),
    (-3.0, -13.0, 3.4, (4.0, 3.4, 2.6), 5.0, 16),
    (-9.5, -8.0, 0.5, (3.0, 2.2, 2.4), 6.0, 22),
    (9.8, -7.5, 0.5, (3.2, 2.4, 2.4), 7.0, 22),
)
BOULDERS = (
    (-7.4, -0.8, 0.2, (1.3, 0.9, 1.1), 8.0, 18),
    (7.7, 1.2, 0.2, (1.5, 1.1, 1.2), 9.0, 18),
    (-8.0, 5.4, 0.15, (1.1, 0.8, 1.0), 10.0, 16),
    (7.5, 6.2, 0.15, (1.0, 0.7, 0.9), 11.0, 16),
    (-7.0, -3.8, 0.2, (1.2, 1.0, 1.3), 12.0, 16),
)
# (x, z, height); every tree stands outside the plaza and outside the camera's reach
NEAR_PINES = ((-11.2, -2.8, 8.2), (11.6, -4.6, 9.0), (-9.8, 4.2, 7.0), (10.6, 7.4, 7.6), (-10.4, -8.8, 8.8))
# (x, z, size, colour index into the maple palette)
NEAR_MAPLES = ((-9.8, 1.2, 1.15, 0), (10.0, -0.8, 1.2, 1), (-9.6, -5.6, 1.0, 2), (9.8, 4.6, 1.1, 0), (-10.8, 7.2, 1.0, 1))
FAR_PINES = 11
FAR_MAPLES = 9


class Plan:
    """What the world follows from the game, with the palette already in linear colour."""

    def __init__(self, inputs):
        layout = inputs["layout"]
        self.platform = layout["PLATFORM"]
        self.steps = layout["STEPS"]
        self.plaza = layout["PLAZA"]
        self.statue_z = layout["GATBAWI_Z"]
        self.mat = layout["MAT_SIZE"]
        self.mat_top = inputs["monk"]["MAT_TOP"]
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        self.front = self.plaza["maxZ"] + PLAZA_MARGIN
        self.back = self.platform["minZ"] - PLATFORM_BACK

    def outside(self, x, z):
        """How far (x, z) is from the paved plaza, negative inside it."""
        dx = abs(x) - PLAZA_HALF
        dz = max(self.plaza["minZ"] - z, z - self.front)
        inside = max(dx, dz)
        if inside < 0.0:
            return inside
        return math.hypot(max(dx, 0.0), max(dz, 0.0))

    def terrain(self, x, z):
        d = max(self.outside(x, z), 0.0)
        behind = -z - abs(self.platform["maxZ"])
        rolling = 0.8 * smoothstep(1.5, 10.0, d) * (0.5 + 0.5 * fbm(x * 0.13, 0.0, z * 0.13, 3.0))
        ridge = 14.0 * smoothstep(24.0, 60.0, d) * (0.55 + 0.45 * fbm(x * 0.06, 0.0, z * 0.06, 9.0))
        slope = 1.5 * smoothstep(0.0, 3.0, behind) + 0.35 * max(0.0, behind - 3.0)
        return rolling + ridge + slope


def axis_lines(low, high, step, limit):
    """Grid lines every `step` from low to high, then wider and wider out to `limit` on both sides."""
    count = round((high - low) / step)
    lines = [low + (high - low) * i / count for i in range(count + 1)]
    below, above, gap, lo, hi = [], [], step, low, high
    while hi < limit:
        gap *= 1.3
        lo, hi = lo - gap, hi + gap
        below.append(lo)
        above.append(hi)
    return list(reversed(below)) + lines + above


def ground(plan):
    part = Part("ground", frame=GAME)
    c = plan.c

    def tone(p):
        patch = 0.5 + 0.5 * fbm(p.x * 0.35, 0.0, p.z * 0.35, 8.0)
        speck = 0.5 + 0.5 * fbm(p.x * 1.1, 0.0, p.z * 1.1, 13.0)
        earth = mix(c["moss"], c["soil"], smoothstep(0.4, 0.75, patch))
        earth = mix(earth, c["litter"], 0.6 * smoothstep(0.5, 0.85, speck))
        rise = smoothstep(2.0, 9.0, p.y)
        earth = mix(earth, scaled(c["graniteShade"], 0.8), 0.5 * rise)
        paving = scaled(c["paving"], 0.88 + 0.12 * hash01(math.floor(p.x / 0.65), 0.0, math.floor(p.z / 0.65), 4.0))
        edge = plan.outside(p.x, p.z) + 0.7 * fbm(p.x * 0.7, 0.0, p.z * 0.7, 5.0)
        return mix(paving, earth, smoothstep(-0.15, 0.45, edge))

    columns = axis_lines(-PLAZA_HALF, PLAZA_HALF, 0.65, GROUND_LIMIT)
    rows = axis_lines(plan.plaza["minZ"], plan.front, 0.65, GROUND_LIMIT)
    part.heightfield(columns, rows, plan.terrain, tone)
    part.project_uv(GROUND_TILE)
    return part


def stone_tone(plan, seed):
    c = plan.c

    def tone(p):
        grain = 0.5 + 0.5 * fbm(p.x * 0.9, p.y * 0.9, p.z * 0.9, seed)
        base = mix(scaled(c["graniteShade"], 0.95 + 0.15 * grain), c["granite"], 0.35 + 0.4 * grain)
        patch = 0.5 + 0.5 * fbm(p.x * 0.5, p.y * 0.5, p.z * 0.5, seed + 5.0)
        low = 1.0 - smoothstep(0.2, 2.6, p.y - plan.terrain(p.x, p.z))
        moss = mix(c["moss"], c["litter"], smoothstep(0.5, 0.9, 0.5 + 0.5 * fbm(p.x * 1.4, p.y * 1.4, p.z * 1.4, seed + 9.0)))
        return mix(base, moss, min(0.75, 0.9 * low * smoothstep(0.4, 0.75, patch)))

    return tone


def steps(plan):
    """The granite platform Gatbawi sits on, four steps up to it from the plaza, and a low kerb round the paving."""
    part = Part("steps", frame=GAME)
    c = plan.c
    top = plan.platform["topY"]

    def tone(seed):
        base = stone_tone(plan, seed)
        return part.in_game(lambda p: scaled(mix(base(p), c["granite"], 0.5), 0.95 + 0.1 * hash01(math.floor(p.x), 0.0, math.floor(p.z * 2.0), seed)))

    def rough(faces, seed):
        part.displace(faces, lambda co: tuple(0.02 * fbm(co.x * 3.1, co.y * 3.1, co.z * 3.1, seed + i) for i in range(3)))

    front, back = plan.platform["maxZ"], plan.back
    rough(part.box((0.0, top / 2, (front + back) / 2), (2 * PLATFORM_HALF, top, front - back), tone(1.0), skip=("-y", "-z"), cuts=(10, 2, 4)), 1.0)
    count = round((plan.steps["maxZ"] - plan.steps["minZ"]) / 0.55)
    depth = (plan.steps["maxZ"] - plan.steps["minZ"]) / count
    for k in range(count):
        height = top * (k + 1) / count
        near = plan.steps["maxZ"] - depth * k
        blocks = 3
        width = (2 * STEP_HALF - 0.04 * (blocks - 1)) / blocks
        for b in range(blocks):
            x = -STEP_HALF + width / 2 + b * (width + 0.04)
            faces = part.box((x, height / 2, near - depth / 2), (width, height, depth - 0.03), tone(2.0 + 3 * k + b), skip=("-y", "-z"), cuts=(3, 1, 1))
            rough(faces, 2.0 + 3 * k + b)
    kerb = (0.3, 0.14)
    length = (plan.front - plan.plaza["minZ"]) / 6
    for side in (-1.0, 1.0):
        for i in range(6):
            z = plan.plaza["minZ"] + length * (i + 0.5)
            rough(part.box((side * (PLAZA_HALF - 0.05), kerb[1] / 2 - 0.01, z), (kerb[0], kerb[1], length - 0.04), tone(20.0 + i), skip=("-y",)), 20.0 + i)
    run = 2 * PLAZA_HALF / 8
    for i in range(8):
        x = -PLAZA_HALF + run * (i + 0.5)
        rough(part.box((x, kerb[1] / 2 - 0.01, plan.front - 0.05), (run - 0.04, kerb[1], kerb[0]), tone(30.0 + i), skip=("-y",)), 30.0 + i)
    part.project_uv(STONE_TILE)
    return part


def craggy(centre, seed, strength):
    """Pushes a rock's vertices in or out along the line from its centre, by ridged noise."""
    middle = from_game(Vector(centre))

    def offset(co):
        g = to_game(co)
        ridge = 1.0 - 2.0 * abs(fbm(g.x * 0.4, g.y * 0.4, g.z * 0.4, seed))
        grit = fbm(g.x * 1.5, g.y * 1.5, g.z * 1.5, seed + 3.0)
        return (co - middle) * (strength * (0.7 * ridge + 0.3 * grit))

    return offset


def rocks(plan):
    part = Part("rocks", frame=GAME)
    for index, (x, z, lift, radii, seed, segments) in enumerate(OUTCROP + BOULDERS):
        centre = (x, plan.terrain(x, z) + lift, z)
        faces = part.ellipsoid(centre, radii, segments, segments // 2 + 2, part.in_game(stone_tone(plan, seed)), smooth=False)
        part.displace(faces, craggy(centre, seed, 0.38 if index < len(OUTCROP) else 0.3))
    part.project_uv(STONE_TILE)
    return part


def pine(part, plan, x, z, height, seed):
    """A dark conifer: a trunk and four tiers of ragged cones."""
    c = plan.c
    base = plan.terrain(x, z)
    part.tube([(x, base - 0.3, z), (x, base + height * 0.3, z)], [0.03 * height, 0.012 * height], 6, c["trunk"])
    for tier in range(4):
        start = base + height * (0.16 + 0.17 * tier)
        radius = height * 0.24 * (1.0 - 0.2 * tier)
        rise = height * 0.3

        def tone(p, start=start, rise=rise):
            lit = smoothstep(start, start + rise, p.y)
            wobble = 0.85 + 0.3 * hash01(p.x, p.y, p.z, seed)
            return scaled(mix(c["pine"], c["pineLight"], 0.65 * lit), wobble)

        def ragged(h, angle, tier=tier):
            return 1.0 + 0.14 * (2.0 * hash01(angle, tier, 0.0, seed) - 1.0)

        with part.placed(spun(x, start, z)):
            part.lathe(((radius, 0.0), (radius * 0.6, rise * 0.5), (0.0, rise)), 8, part.in_game(tone), fold=ragged, cap_bottom=True)


def maple(part, plan, x, z, size, palette, seed, crowns=4):
    """A trunk with a crown of lumpy balls in autumn colours."""
    c = plan.c
    base = plan.terrain(x, z)
    leaves = (c["maple"], c["leafRed"], c["ginkgo"])
    part.tube(
        [(x, base - 0.2, z), (x + 0.12 * size, base + 1.0 * size, z - 0.1 * size), (x - 0.05 * size, base + 2.0 * size, z + 0.05 * size)],
        [0.2 * size, 0.14 * size, 0.1 * size],
        7,
        c["trunk"],
    )
    heart = Vector((x, base + 2.9 * size, z))
    offsets = ((0.0, 0.0, 0.0), (1.1, -0.35, 0.4), (-1.0, -0.25, -0.6), (0.2, 0.75, -0.9))
    for i, (ox, oy, oz) in enumerate(offsets[:crowns]):
        centre = heart + Vector((ox, oy, oz)) * size
        radii = (1.7 * size, 1.4 * size, 1.7 * size)
        hue = leaves[(palette + (i % 2)) % 3]

        def tone(p, hue=hue, centre=centre, size=size, i=i):
            top = smoothstep(-1.4 * size, 1.4 * size, p.y - centre.y)
            dapple = 0.82 + 0.3 * (0.5 + 0.5 * fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6, seed + i))
            return scaled(mix(scaled(hue, 0.8), hue, top), dapple)

        part.ellipsoid(tuple(centre), radii, 10, 7, part.in_game(tone), lump=0.1, seed=seed + i)


def scatter(count, seed, plan):
    """Spots on the hillside for the far trees: out of the plaza's way and clear of the outcrop."""
    spots = []
    for i in range(count):
        angle = math.tau * (i + 0.7 * hash01(i, 0.0, 0.0, seed)) / count
        radius = 18.0 + 26.0 * hash01(i, 1.0, 0.0, seed)
        x, z = radius * math.sin(angle) * 1.2, radius * math.cos(angle)
        near = abs(x) < 12.5 and -18.0 < z < 14.0
        if not near:
            spots.append((x, z, hash01(i, 2.0, 0.0, seed)))
    return spots


def pines(plan):
    part = Part("pine", frame=GAME)
    for i, (x, z, height) in enumerate(NEAR_PINES):
        pine(part, plan, x, z, height, 20.0 + i)
    for i, (x, z, r) in enumerate(scatter(FAR_PINES, 3.0, plan)):
        pine(part, plan, x, z, 7.0 + 4.0 * r, 40.0 + i)
    return part


def maples(plan):
    part = Part("maple", frame=GAME)
    for i, (x, z, size, palette) in enumerate(NEAR_MAPLES):
        maple(part, plan, x, z, size, palette, 60.0 + 5 * i)
    for i, (x, z, r) in enumerate(scatter(FAR_MAPLES, 7.0, plan)):
        maple(part, plan, x, z, 1.6 + 1.2 * r, i, 100.0 + 5 * i, crowns=3)
    return part


def mat(plan):
    """One woven mat, centred at the origin with its top at MAT_TOP; the game places twelve of them."""
    part = Part("mat", frame=GAME)
    c = plan.c
    width, depth, top = plan.mat["x"], plan.mat["z"], plan.mat_top
    edge = 0.06
    xs = (-width / 2, -width / 2 + edge, width / 2 - edge, width / 2)
    zs = (-depth / 2, -depth / 2 + edge, depth / 2 - edge, depth / 2)

    def on_picture(co):
        return ((co.x + width / 2) / width, 0.5 * (co.z + depth / 2) / depth)

    for i in range(3):
        for j in range(3):
            tint = c["straw"] if (i, j) == (1, 1) else c["strawBorder"]
            part.grid((xs[i], top, zs[j]), (0.0, 0.0, zs[j + 1] - zs[j]), (xs[i + 1] - xs[i], 0.0, 0.0), 1, 1, tint, uv=on_picture)
    sides = part.box((0.0, top / 2, 0.0), (width, top, depth), c["strawBorder"], skip=("+y", "-y"))
    part.map_uv(sides, lambda co: ((co.x + width / 2) / width, 0.004 + 0.01 * co.y / top))
    return part


def build(inputs, out_dir):
    plan = Plan(inputs)
    stone = common.textured_material("stone", os.path.join(SOURCES, "rock_boulder_dry_diff.jpg"), os.path.join(SOURCES, "rock_boulder_dry_nor_gl.jpg"))
    paving = common.textured_material("paving", os.path.join(SOURCES, "grey_stone_path_diff.jpg"), os.path.join(SOURCES, "grey_stone_path_nor_gl.jpg"))
    foliage = common.vertex_color_material("foliage")
    objects = {
        "ground": ground(plan).build(paving, crease=False),
        "steps": steps(plan).build(stone),
        "rocks": rocks(plan).build(stone),
        "pine": pines(plan).build(foliage),
        "maple": maples(plan).build(foliage),
    }
    common.bake_vertex_occlusion(list(objects.values()), distance=1.4, samples=48, floor=0.5)
    objects["mat"] = mat(plan).build(common.textured_material("mat", os.path.join(SOURCES, "tatami_mat_diff.jpg")), crease=False)
    names = inputs["names"]["WORLD_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"world meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "world.glb"))
    print("world triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
