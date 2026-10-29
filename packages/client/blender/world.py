"""world.glb: the prayer world, the garden seen through its window, and the mat prototypes.

Everything is drawn in the game's own coordinates (Y up, +Z toward the viewer) through a Part whose
frame is GAME. Inside `part.placed(...)` a door bay is drawn in its own frame: x along the wall,
y up, z into the world. Walls, beams and pillars are subdivided so the baked occlusion has vertices
to land on; faces nobody can see are never built.
"""

import math
import os
import random

from mathutils import Matrix, Vector

import common
import flat_textures
from common import GAME, Part, at, cells, hash01, hidden, mix, rgb, scaled, smooth_profile, smoothstep, spun, turned

STEP = 0.75
WHITE = (1.0, 1.0, 1.0)

SILL = 0.9
OPENING = 3.7
WALL_DEPTH = 0.5
SIDE_BAYS = ((-4.25, 4.3), (-0.05, 4.1), (4.0, 4.0))  # (centre z, width) along each side wall
FRONT_BAYS = ((-4.25, 4.3), (0.0, 4.2), (4.25, 4.3))  # (centre x, width) along the front wall
WINDOW_BAY = 1  # the middle bay of the right wall stands open to the garden
PILLAR_Z = (-6.4, -2.1, 2.0, 6.0)
FRONT_PILLAR_Z = 7.4
BEAM_Z = (-6.4, -2.1, 2.0, 6.0, 7.4)
BEAM_DEPTH = 0.36
PURLIN_WIDTH = 0.34
LANTERN_X = (-4.4, -1.5, 1.5, 4.4)
LANTERN_Z = (-3.2, 0.8, 4.8)
SKY_DISTANCE = 32.0
SKY_CENTER_Y = 5.5
GARDEN_WALL_X = 9.3
MAT_RADIUS = 0.4


class Plan:
    """What the world follows from the game, with the palette already in linear colour."""

    def __init__(self, inputs):
        layout, world = inputs["layout"], inputs["world"]
        self.half = layout["LANDSCAPE_HALF_WIDTH"]
        self.front = layout["LANDSCAPE_FRONT_Z"]
        self.buddha = layout["BUDDHA_Z"]
        self.wall = world["WALL_X"]
        self.back = world["BACK_Z"]
        self.height = world["HEIGHT"]
        self.altar_top = world["ALTAR_TOP"]
        self.candles = world["CANDLE_SPOTS"]
        self.sun = Vector(world["SUN_POSITION"])
        self.target = Vector(world["SUN_TARGET"])
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        self.scene = inputs["scene"]
        self.purlins = (-self.wall + 0.45, -3.4, 0.0, 3.4, self.wall - 0.45)

    def bays(self):
        """(placement, width, is the open window) for every wooden bay of the three walls."""
        for index, (z, width) in enumerate(SIDE_BAYS):
            yield at(-self.wall, 0.0, z) @ turned(math.pi / 2), width, False
            yield at(self.wall, 0.0, z) @ turned(-math.pi / 2), width, index == WINDOW_BAY
        for x, width in FRONT_BAYS:
            yield at(x, 0.0, self.front) @ turned(math.pi), width, False


def speckled(color, amount, seed):
    """A colour that varies a little from place to place, like hand-finished plaster."""
    return lambda co: scaled(color, 1.0 - amount + 2.0 * amount * hash01(co.x, co.y, co.z, seed))


def panel(part, corner, across, along, color, step=STEP, uv=None):
    """A flat grid cut into cells of about `step`; it faces across x along."""
    columns = max(1, round(Vector(across).length / step))
    rows = max(1, round(Vector(along).length / step))
    return part.grid(corner, across, along, columns, rows, color, uv=uv)


def piece(part, center, size, color, *shown, step=STEP):
    part.box(center, size, color, skip=hidden(*shown), cuts=cells(size, step))


def bay_wood(part, plan, width, window):
    c = plan.c
    inner = width - 0.2
    top = SILL + OPENING
    head = plan.height - top
    dark = c["woodDark"]

    piece(part, (0.0, SILL / 2, 0.07), (width, SILL, 0.14), c["woodMid"], "+z", "+y")
    piece(part, (0.0, top + head / 2, 0.08), (width, head, 0.16), c["plasterShade"], "+z", "-y")
    piece(part, (0.0, top + 0.04, 0.095), (width, 0.08, 0.17), dark, "+z")
    for offset, color in ((0.125, c["dancheongGreen"]), (0.245, c["dancheongRed"]), (0.365, c["dancheongYellow"])):
        piece(part, (0.0, top + offset, 0.1), (width, 0.09, 0.19), color, "+z", "+y", "-y")
    for side in (-1.0, 1.0):
        piece(part, (side * (inner / 2 + 0.05), SILL + OPENING / 2, 0.07), (0.1, OPENING, 0.12), dark, "+z", "+x", "-x")

    columns = max(2, round(inner / 0.42))
    for i in range(1, columns):
        x = -inner / 2 + inner * i / columns
        piece(part, (x, SILL + OPENING / 2, 0.08), (0.035, OPENING, 0.05), dark, "+z", "+x", "-x")
    for k in range(6):
        piece(part, (0.0, SILL + OPENING * k / 5, 0.075), (inner, 0.035, 0.04), dark, "+z", "+y", "-y")
    if window:
        piece(part, (0.0, SILL + 0.02, 0.14), (width + 0.1, 0.08, 0.34), c["woodMid"], "+z", "+y", "-y", "+x", "-x")
    else:
        piece(part, (0.0, SILL + OPENING / 2, 0.09), (0.1, OPENING, 0.1), dark, "+z", "+x", "-x")


def bay_paper(part, plan, width):
    inner = width - 0.2

    def sheet(co):
        return scaled(plan.c["paper"], 0.9 + 0.1 * math.sin(math.pi * (co.y - SILL) / OPENING))

    part.grid((-inner / 2, SILL, 0.04), (inner, 0.0, 0.0), (0.0, OPENING, 0.0), 1, 4, sheet)


def walls(part, plan):
    c, wall, back, front, height = plan.c, plan.wall, plan.back, plan.front, plan.height
    plaster = speckled(c["plaster"], 0.04, 1.0)
    side_lo = min(z - width / 2 for z, width in SIDE_BAYS)
    side_hi = max(z + width / 2 for z, width in SIDE_BAYS)
    front_lo = min(x - width / 2 for x, width in FRONT_BAYS)
    front_hi = max(x + width / 2 for x, width in FRONT_BAYS)
    window_lo = SIDE_BAYS[WINDOW_BAY][0] - SIDE_BAYS[WINDOW_BAY][1] / 2
    window_hi = SIDE_BAYS[WINDOW_BAY][0] + SIDE_BAYS[WINDOW_BAY][1] / 2
    top = SILL + OPENING

    # Doors hide the left wall between its corner strips. The right wall stays whole behind its
    # doors because the sun must not reach the world through anything but the window.
    for z0, z1 in ((back, side_lo), (side_hi, front)):
        panel(part, (-wall, 0.0, z0), (0.0, height, 0.0), (0.0, 0.0, z1 - z0), plaster)
    for z0, z1, y0, y1 in (
        (back, window_lo, 0.0, height),
        (window_hi, front, 0.0, height),
        (window_lo, window_hi, 0.0, SILL),
        (window_lo, window_hi, top, height),
    ):
        panel(part, (wall, y0, z0), (0.0, 0.0, z1 - z0), (0.0, y1 - y0, 0.0), plaster)
    for x0, x1 in ((-wall, front_lo), (front_hi, wall)):
        panel(part, (x0, 0.0, front), (0.0, height, 0.0), (x1 - x0, 0.0, 0.0), plaster)

    # The wall is thick; its opening shows four plastered sides.
    thickness = (WALL_DEPTH, 0.0, 0.0)
    reveal = plaster
    panel(part, (wall, top, window_lo), thickness, (0.0, 0.0, window_hi - window_lo), reveal, step=0.5)
    panel(part, (wall, SILL, window_lo), (0.0, 0.0, window_hi - window_lo), thickness, reveal, step=0.5)
    panel(part, (wall, SILL, window_lo), thickness, (0.0, OPENING, 0.0), reveal, step=0.5)
    panel(part, (wall, SILL, window_hi), (0.0, OPENING, 0.0), thickness, reveal, step=0.5)


def pillar(part, plan, x, z):
    c, height = plan.c, plan.height
    base, crown = 0.28, height - 0.2
    entasis = smooth_profile(
        [(radius, base + (crown - base) * t) for radius, t in ((0.272, 0.0), (0.283, 0.13), (0.29, 0.4), (0.272, 0.7), (0.25, 0.92), (0.246, 1.0))],
        2,
    )

    def lacquer(co):
        return scaled(c["lacquer"], 0.9 + 0.1 * math.sin(math.pi * co.z / height))

    ring = height - 0.55
    with part.placed(spun(x, 0.0, z)):
        part.lathe(entasis, 14, lacquer)
        part.lathe(((0.38, 0.0), (0.38, 0.2), (0.345, base), (0.0, base)), 14, c["stone"])
        part.lathe(((0.288, ring - 0.035), (0.305, ring), (0.288, ring + 0.035)), 14, c["gold"])
        part.lathe(((0.25, height - 0.52), (0.36, height - 0.35)), 14, scaled(c["dancheongGreen"], 0.8))
    part.box((x, height - 0.2, z), (0.7, 0.3, 0.7), c["dancheongGreen"], skip=hidden("+x", "-x", "+z", "-z", "-y"))


def altar(part, plan):
    c = plan.c
    z = plan.buddha - 0.3

    def slab(width, height, depth, y, color):
        size = (width, height, depth)
        part.box((0.0, y, z), size, color, skip=hidden("+x", "-x", "+z", "-z", "+y"), cuts=cells(size, STEP))

    slab(7.8, 0.32, 3.2, 0.16, c["lacquer"])
    slab(7.9, 0.05, 3.3, 0.34, c["gold"])
    slab(6.8, 0.26, 2.6, 0.47, c["lacquerDeep"])
    slab(6.9, 0.05, 2.7, plan.altar_top - 0.01, c["gold"])
    accents = (c["gold"], c["dancheongGreen"], c["dancheongYellow"], c["dancheongRed"])
    for i in range(7):
        part.box((-3.0 + i, 0.16, z + 1.61), (0.6, 0.18, 0.04), accents[i % len(accents)], skip=hidden("+z", "+x", "-x", "+y", "-y"))

    with part.placed(spun(0.0, plan.altar_top, plan.buddha + 0.85)):
        part.lathe(((0.0, 0.0), (0.24, 0.02), (0.3, 0.1), (0.24, 0.2), (0.3, 0.26), (0.27, 0.28), (0.0, 0.26)), 16, c["brass"])
    for x, candle_z in plan.candles:
        with part.placed(spun(x, plan.altar_top, candle_z)):
            part.lathe(((0.15, 0.0), (0.13, 0.06), (0.0, 0.06)), 12, c["brass"])
            part.lathe(((0.055, 0.06), (0.05, 0.4), (0.0, 0.4)), 10, c["wax"])
            part.lathe(((0.004, 0.4), (0.004, 0.45)), 4, c["wick"])


def structure(plan):
    part = Part("structure", frame=GAME)
    walls(part, plan)
    for placement, width, window in plan.bays():
        with part.placed(placement):
            bay_wood(part, plan, width, window)
    for z in PILLAR_Z:
        pillar(part, plan, -plan.wall + 0.45, z)
        pillar(part, plan, plan.wall - 0.45, z)
    for x in (-plan.wall + 0.45, plan.wall - 0.45):
        pillar(part, plan, x, FRONT_PILLAR_Z)
    altar(part, plan)
    return part


def paper(plan):
    part = Part("paper", frame=GAME)
    for placement, width, window in plan.bays():
        if not window:
            with part.placed(placement):
                bay_paper(part, plan, width)
    return part


def ceiling(part, plan):
    c, half, height = plan.c, plan.half, plan.height
    xs, zs = [-half], [plan.back]
    for x in plan.purlins:
        xs += [x - PURLIN_WIDTH / 2, x + PURLIN_WIDTH / 2]
    for z in BEAM_Z:
        zs += [z - BEAM_DEPTH / 2, z + BEAM_DEPTH / 2]
    xs.append(half)
    zs.append(plan.front)
    boards = (scaled(c["dancheongGreen"], 0.55), scaled(c["lacquerDeep"], 0.9))
    for i, (x0, x1) in enumerate(zip(xs, xs[1:])):
        for j, (z0, z1) in enumerate(zip(zs, zs[1:])):
            covered = i % 2 == 1 or i == len(xs) - 2 or i == 0 or j % 2 == 1
            color = c["woodCeiling"] if covered else boards[(i // 2 + j // 2) % 2]
            panel(part, (x0, height, z0), (x1 - x0, 0.0, 0.0), (0.0, 0.0, z1 - z0), color, step=1.0)
            if not covered:
                mid_x, mid_z = (x0 + x1) / 2, (z0 + z1) / 2
                piece(part, (mid_x, height - 0.025, mid_z), (x1 - x0, 0.05, 0.08), c["woodMid"], "-y", "+z", "-z", step=1.0)
                piece(part, (mid_x, height - 0.025, mid_z), (0.08, 0.05, z1 - z0), c["woodMid"], "-y", "+x", "-x", step=1.0)


def beams(plan):
    part = Part("beams", frame=GAME)
    c, half, height = plan.c, plan.half, plan.height
    ceiling(part, plan)
    bands = (
        (height - 0.8, 0.07, c["dancheongGreen"]),
        (height - 0.87, 0.05, c["dancheongRed"]),
        (height - 0.915, 0.03, c["dancheongYellow"]),
    )
    for z in BEAM_Z:
        piece(part, (0.0, height - 0.55, z), (2 * half, 0.42, BEAM_DEPTH), c["woodDark"], "+z", "-z", "-y", step=1.0)
        for y, thickness, color in bands:
            piece(part, (0.0, y, z), (2 * half, thickness, 0.4), color, "+z", "-z", "-y", step=1.0)
    length = plan.front - plan.back
    for x in plan.purlins:
        piece(part, (x, height - 0.2, (plan.front + plan.back) / 2), (PURLIN_WIDTH, 0.42, length), c["woodMid"], "-y", "+x", "-x", step=1.0)
    return part


def lantern(part, plan, tone, x, y, z):
    c = plan.c
    body = smooth_profile([(0.0, -0.3), (0.12, -0.28), (0.24, -0.15), (0.28, 0.0), (0.24, 0.15), (0.12, 0.28), (0.0, 0.3)], 2)

    def paper_lit(co):
        ribs = 0.88 + 0.12 * math.cos(6.0 * math.atan2(co.y, co.x))
        glow = 1.0 - 0.28 * (co.z / 0.3) ** 2
        return scaled(tone, ribs * glow)

    with part.placed(spun(x, y, z)):
        part.lathe(body, 12, paper_lit)
        part.lathe(((0.1, 0.28), (0.1, 0.34), (0.0, 0.34)), 10, c["lanternWood"])
        part.lathe(((0.012, 0.34), (0.012, plan.height - y)), 4, c["lanternWood"])
        part.lathe(((0.01, -0.64), (0.07, -0.3)), 8, c["dancheongYellow"])


def lanterns(plan):
    part = Part("lanterns", frame=GAME)
    c = plan.c
    palette = (c["lanternCoral"], c["lanternAmber"], c["lanternRose"], c["lanternCream"])
    index = 0
    for x in LANTERN_X:
        for z in LANTERN_Z:
            lantern(part, plan, palette[index % len(palette)], x, 4.5 + ((index * 7) % 3) * 0.12, z)
            index += 1
    return part


def tree(part, plan, rand, index, x, z):
    c = plan.c
    size = 0.8 + rand() * 0.9
    tones = (c["maple"], c["ginkgo"], c["leafGreen"], c["leafDeep"], c["leafRed"])
    tone = tones[int(rand() * len(tones))]

    def leaves(low, high):
        return lambda co: scaled(tone, (0.76 + 0.36 * smoothstep(low, high, co.y)) * (0.94 + 0.12 * hash01(co.x, co.y, co.z, index)))

    with part.placed(spun(x, 0.0, z)):
        part.lathe(((0.18 * size, 0.0), (0.12 * size, 2.2 * size)), 6, c["trunk"])
    part.sphere((x, 2.9 * size, z), (1.15 * size, 1.32 * size, 1.15 * size), 14, 9, leaves(1.5 * size, 4.3 * size), lump=0.1, seed=index)
    part.sphere((x + 0.6 * size, 2.3 * size, z + 0.3 * size), (0.8 * size,) * 3, 10, 7, leaves(1.3 * size, 3.2 * size), lump=0.1, seed=index + 0.5)


def pine(part, plan, rand, x, z):
    c = plan.c
    size = 0.9 + rand() * 0.5
    with part.placed(spun(x, 0.0, z)):
        part.lathe(((0.1 * size, 0.0), (0.07 * size, 0.6 * size)), 6, c["trunk"])
        for radius, low, high, shade in ((0.78, 0.3, 1.3, 0.8), (0.6, 0.9, 1.85, 0.92), (0.4, 1.45, 2.4, 1.05)):
            part.lathe(((radius * size, low * size), (0.0, high * size)), 7, scaled(c["pine"], shade), cap_bottom=True)


def garden_wall(part, plan):
    c = plan.c
    length = 28.0
    part.box((GARDEN_WALL_X, 0.5, 0.0), (0.4, 1.0, length), speckled(c["plasterShade"], 0.05, 3.0), skip=hidden("-x", "+y", "+z", "-z"), cuts=cells((0.4, 1.0, length), 1.5))
    part.box((GARDEN_WALL_X, 1.07, 0.0), (0.7, 0.14, length + 0.2), c["tile"], skip=hidden("-x", "+y", "-y", "+z", "-z"), cuts=cells((0.7, 0.14, length), 1.5))


def outdoor(plan):
    part = Part("outdoor", frame=GAME)
    c = plan.c
    reach = 36.0
    panel(
        part,
        (plan.wall + WALL_DEPTH - 0.1, -0.06, -reach),
        (0.0, 0.0, 2 * reach),
        (SKY_DISTANCE + 2.0 - plan.wall, 0.0, 0.0),
        speckled(c["ground"], 0.1, 5.0),
        step=3.0,
    )
    garden_wall(part, plan)
    rand = random.Random(11).random
    for index in range(16):
        tree(part, plan, rand, index, 10.4 + rand() * 10.0, -9.0 + rand() * 18.0)
    for _ in range(6):
        pine(part, plan, rand, 10.2 + rand() * 2.0, -4.0 + rand() * 8.0)
    return part


def floor(plan):
    part = Part("floor", frame=GAME)
    half = plan.half
    meters = flat_textures.FLOOR_METERS
    part.grid(
        (-half, 0.0, plan.front),
        (2 * half, 0.0, 0.0),
        (0.0, 0.0, plan.back - plan.front),
        1,
        1,
        WHITE,
        uv=lambda co: ((co.x + half) / meters, (plan.front - co.z) / meters),
    )
    return part


def backdrop(plan):
    part = Part("backdrop", frame=GAME)
    width, height = 2 * plan.half, plan.height
    part.grid((-plan.half, 0.0, plan.back + 0.02), (width, 0.0, 0.0), (0.0, height, 0.0), 1, 1, WHITE, uv=lambda co: ((co.x + plan.half) / width, co.y / height))
    return part


def sky(plan):
    part = Part("sky", frame=GAME)
    width, height = flat_textures.SKY_METERS
    low = SKY_CENTER_Y - height / 2
    part.grid(
        (SKY_DISTANCE, low, -width / 2),
        (0.0, 0.0, width),
        (0.0, height, 0.0),
        1,
        1,
        WHITE,
        uv=lambda co: ((co.z + width / 2) / width, (co.y - low) / height),
    )
    return part


def sunbeams(plan):
    part = Part("sunbeams", frame=GAME)
    heading = (plan.target - plan.sun).normalized()
    length, breadth = 11.0, 0.9
    sideways = heading.cross(Vector((0.0, 1.0, 0.0))).normalized()
    other = heading.cross(sideways).normalized()
    for z in (-1.5, -0.1, 1.3):
        start = Vector((plan.wall - 0.2, 2.8, z))
        for across in (sideways, other):
            def uv(co, start=start, across=across):
                offset = co - start
                return (0.5 + offset.dot(across) / breadth, 1.0 - offset.dot(heading) / length)

            corners = [start - across * breadth / 2, start + across * breadth / 2, start + heading * length + across * breadth / 2, start + heading * length - across * breadth / 2]
            part.polygon(corners, WHITE, uv=uv)
    return part


def mat_body(plan):
    part = Part("matBody")
    base = plan.c["mat"]
    profile = ((0.46, 0.0), (0.465, 0.03), (0.46, 0.07), (0.435, 0.11), (0.42, 0.12), (0.0, 0.12))
    part.lathe(profile, 20, lambda co: scaled(base, 0.78 + 0.22 * co.z / 0.12))
    return part


def mat_top(plan):
    part = Part("matTop")
    rim, crown = 0.122, 0.15
    part.radial((0.0, 0.0, rim), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), MAT_RADIUS, 3, 20, WHITE, uv=lambda co: (co.x / (2 * MAT_RADIUS) + 0.5, co.y / (2 * MAT_RADIUS) + 0.5))
    for vert in part.bm.verts:
        vert.co.z = rim + (crown - rim) * (1.0 - (math.hypot(vert.co.x, vert.co.y) / MAT_RADIUS) ** 2)
    return part


def build(inputs, out_dir, pictures):
    plan = Plan(inputs)
    if (2 * plan.half, plan.height) != flat_textures.MURAL_METERS:
        raise RuntimeError(f"the mural is painted for {flat_textures.MURAL_METERS} m, the world wall is {2 * plan.half} x {plan.height} m")
    solid = common.vertex_color_material("world")

    def textured(name, part):
        return part.build(common.image_material(name, pictures[name], repeat=name == "floor"), crease=False)

    objects = {
        "structure": structure(plan).build(solid),
        "beams": beams(plan).build(solid),
        "outdoor": outdoor(plan).build(solid, crease=False),
        "floor": textured("floor", floor(plan)),
        "backdrop": textured("backdrop", backdrop(plan)),
    }
    common.bake_vertex_occlusion([objects["structure"], objects["beams"]], distance=0.8, samples=48, floor=0.55)
    common.bake_vertex_occlusion([objects["outdoor"]], distance=0.8, samples=32, floor=0.65)
    objects["paper"] = paper(plan).build(solid, crease=False)
    objects["lanterns"] = lanterns(plan).build(solid)
    objects["sky"] = textured("sky", sky(plan))
    objects["sunbeams"] = textured("sunbeams", sunbeams(plan))
    objects["matBody"] = mat_body(plan).build(solid)
    objects["matTop"] = textured("matTop", mat_top(plan))

    names = inputs["names"]["WORLD_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"world meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "world.glb"))
    print("world triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
