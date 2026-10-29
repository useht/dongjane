"""world.glb: the plaza and its autumn mountainside, the temple's outside and its door, and the mat prototype.

Everything is drawn in the game's own coordinates (Y up, +Z toward the viewer) through a Part whose
frame is GAME. The plaza (flat paving the monks kneel on), the granite steps and platform, the
rocks, the pines and the maples are placed from the layout in the inputs; only the dressing of the
hillside (where the far trees and boulders go) is chosen here. The mat is built last, at the origin,
so the baked occlusion never sees it. The hillside keeps clear of the plaza, of the camera's box
(x -8.2..14, z -2.6..30), of the stage on the north-east side and of the temple on the west side.
"""

import math
import os

from mathutils import Vector

import common
import temple
from common import GAME, Part, at, fbm, from_game, hash01, mix, rgb, scaled, smoothstep, spun, to_game

SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources")
GROUND_TILE = 1.6  # metres of ground per repeat of the paving picture
STONE_TILE = 2.4  # metres of rock per repeat of the rock picture

PLAZA_MARGIN = 0.6  # the paving runs this far past the walkable edge at the front
PLATFORM_HALF = 3.8
PLATFORM_BACK = 0.7  # the platform reaches this far behind the statue's pedestal into the hill
STEP_HALF = 2.6
STEP_RISE = 0.3
GROUND_LIMIT = 64.0

# (x, z, height above ground, radii, seed, segments); the outcrop stands behind Gatbawi and leaves
# the north-east corner (x 4..16, z -13..-5) free for the stage
OUTCROP = (
    (-0.8, -11.0, 2.4, (4.8, 4.6, 3.6), 1.0, 18),
    (-5.6, -9.6, 1.2, (3.4, 3.0, 2.8), 2.0, 16),
    (-9.6, -11.4, 1.4, (3.6, 3.4, 3.0), 3.0, 16),
    (-0.8, -12.8, 4.6, (4.0, 3.6, 2.8), 4.0, 18),
    (-4.6, -13.0, 3.4, (4.0, 3.4, 2.6), 5.0, 16),
    (-11.5, -7.5, 0.5, (3.0, 2.2, 2.4), 6.0, 22),
    (19.4, -8.5, 0.5, (3.2, 2.4, 2.4), 7.0, 22),
)
BOULDERS = (
    (-10.2, -1.6, 0.2, (1.3, 0.9, 1.1), 8.0, 18),
    (15.8, 1.2, 0.2, (1.5, 1.1, 1.2), 9.0, 18),
    (-10.0, 15.4, 0.15, (1.1, 0.8, 1.0), 10.0, 16),
    (15.6, 11.8, 0.15, (1.0, 0.7, 0.9), 11.0, 16),
    (-9.6, -4.4, 0.2, (1.2, 1.0, 1.3), 12.0, 16),
)
# (x, z, height); every tree stands outside the plaza, the camera's box, the stage and the temple
NEAR_PINES = ((-12.4, -4.2, 8.2), (18.0, -3.4, 9.0), (-20.0, 4.0, 7.0), (18.4, 9.0, 7.6), (-13.0, -9.4, 8.8), (-19.6, 14.6, 7.8))
# (x, z, size, colour index into the maple palette)
NEAR_MAPLES = ((-13.4, -1.0, 1.15, 0), (19.4, 3.0, 1.2, 1), (-12.6, 16.8, 1.0, 2), (19.6, 14.4, 1.1, 0), (-22.0, 9.0, 1.0, 1))
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
        self.mat = layout["GATBAWI_SEAT_SIZE"]
        self.mat_top = layout["GATBAWI_SEAT_TOP"]
        venue = inputs["venue"]
        self.stage = venue["STAGE"]
        self.stage_yaw = venue["STAGE_YAW"]
        self.temple = venue["TEMPLE"]
        self.pads = venue["PADS"]
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        self.left, self.right = self.plaza["minX"], self.plaza["maxX"]
        self.front = self.plaza["maxZ"] + PLAZA_MARGIN
        self.back = self.platform["minZ"] - PLATFORM_BACK

    def outside(self, x, z):
        """How far (x, z) is from the paved plaza, negative inside it."""
        dx = max(self.left - x, x - self.right)
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
        return (rolling + ridge + slope) * self.level(x, z)

    def level(self, x, z):
        """0 on the stage's and the temple's footprints and a margin round them, easing to 1 over `blend` metres."""
        stage, temple_box, pads = self.stage, self.temple, self.pads
        cos, sin = math.cos(self.stage_yaw), math.sin(self.stage_yaw)
        dx, dz = x - stage["x"], z - stage["z"]
        across = abs(dx * cos - dz * sin) - (stage["width"] / 2 + pads["stageMargin"])
        along = abs(dx * sin + dz * cos) - (stage["depth"] / 2 + pads["stageMargin"])
        from_stage = math.hypot(max(across, 0.0), max(along, 0.0)) + min(max(across, along), 0.0)
        margin = pads["templeMargin"]
        across = abs(x - (temple_box["minX"] + temple_box["maxX"]) / 2) - ((temple_box["maxX"] - temple_box["minX"]) / 2 + margin)
        along = abs(z - (temple_box["minZ"] + temple_box["maxZ"]) / 2) - ((temple_box["maxZ"] - temple_box["minZ"]) / 2 + margin)
        from_temple = math.hypot(max(across, 0.0), max(along, 0.0)) + min(max(across, along), 0.0)
        return smoothstep(0.0, pads["blend"], min(from_stage, from_temple))


def axis_lines(low, high, step, limit):
    """Grid lines every `step` from low to high, then wider and wider out to `limit` on both sides."""
    count = round((high - low) / step)
    lines = [low + (high - low) * i / count for i in range(count + 1)]
    below, above, gap, lo, hi = [], [], step, low, high
    while hi < limit or lo > -limit:
        gap *= 1.3
        lo, hi = lo - gap, hi + gap
        below.append(lo)
        above.append(hi)
    return list(reversed(below)) + lines + above


def refine(lines, low, high, step):
    """Replaces the grid lines between the lines nearest `low` and `high` by evenly spaced ones about `step` apart."""
    start = max(v for v in lines if v <= low)
    end = min(v for v in lines if v >= high)
    count = max(1, math.ceil((end - start) / step))
    kept = [v for v in lines if v < start or v > end]
    return sorted(kept + [start + (end - start) * i / count for i in range(count + 1)])


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

    columns = axis_lines(plan.left, plan.right, 0.65, GROUND_LIMIT)
    rows = axis_lines(plan.plaza["minZ"], plan.front, 0.65, GROUND_LIMIT)
    # Finer lines where the terrain is levelled, so the pads meet the hillside without a coarse fold.
    columns = refine(columns, plan.right, plan.stage["x"] + 11.0, 1.2)
    rows = refine(rows, plan.stage["z"] - 10.0, plan.plaza["minZ"], 1.2)
    columns = refine(columns, plan.temple["minX"] - 5.0, plan.left, 1.2)
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
    length = (plan.front - plan.plaza["minZ"]) / 8
    for edge, inward in ((plan.left, 1.0), (plan.right, -1.0)):
        for i in range(8):
            z = plan.plaza["minZ"] + length * (i + 0.5)
            rough(part.box((edge + inward * 0.05, kerb[1] / 2 - 0.01, z), (kerb[0], kerb[1], length - 0.04), tone(20.0 + i), skip=("-y",)), 20.0 + i)
    count = 16
    run = (plan.right - plan.left) / count
    for i in range(count):
        x = plan.left + run * (i + 0.5)
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
    """Spots on the hillside for the far trees: swung from the west over the north to the east, and pushed
    outward until they clear the box the plaza, the stage, the temple and the camera occupy."""
    spots = []
    for i in range(count):
        angle = -2.4 + 4.8 * (i + 0.7 * hash01(i, 0.0, 0.0, seed)) / count
        radius = 26.0 + 22.0 * hash01(i, 1.0, 0.0, seed)
        for _ in range(8):
            x, z = radius * math.sin(angle) * 1.15, 4.0 - radius * math.cos(angle)
            if not (-30.0 < x < 30.0 and -22.0 < z < 38.0):
                break
            radius += 6.0
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
    """One woven mat, centred at the origin with its top at the seat height the game gives it; the game places fifty of them."""
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
        "temple": temple.building(plan).build(foliage),
        "templeDoor": temple.door(plan).build(foliage),
    }
    common.bake_vertex_occlusion(list(objects.values()), distance=1.4, samples=48, floor=0.5)
    objects["mat"] = mat(plan).build(common.textured_material("mat", os.path.join(SOURCES, "tatami_mat_diff.jpg")), crease=False)
    names = inputs["names"]["WORLD_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"world meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "world.glb"))
    print("world triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
