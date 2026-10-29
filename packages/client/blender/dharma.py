"""dharma.glb: the 법당's inside, its Buddha and one seat to instance. The front wall has an open doorway.

Everything is drawn in the game's own coordinates through Parts whose frame is GAME. A wall's fittings
are drawn in the wall's own frame (x along the wall, y up, z into the room) inside `part.placed(...)`.
Walls, beams and pillars are subdivided so the baked occlusion has vertices to land on, and faces
nobody can see are never built. The Buddha is drawn at the lotus' origin and moved onto the altar.
"""

import math
import os

import bmesh
from mathutils import Vector

import common
from common import GAME, Part, at, cells, from_game, hash01, hidden, mix, rgb, scaled, smooth_profile, smoothstep, spun, surface_point, turned

STEP = 0.75
BEAM_BAND = 0.8  # height of the painted beam under the frieze
BEAM_DEPTH = 0.36
WINDOW = (1.5, 4.5)  # bottom and top of the lattice windows
FLOOR_PLANK = 0.5
LIFT = 0.05  # the figure sits a little above the lotus
SQUASH = 0.78  # the body is shallower than it is wide
HEAD = Vector((0.0, 2.3, 0.0))
HEAD_RADIUS = 0.4
HALO_AT = (0.0, 2.45, -0.55)
GLOW_AT = (0.0, 2.45, -0.62)
GLOW_RADIUS = 2.3
BODY = (
    (1.0, 0.0), (1.12, 0.12), (1.0, 0.3), (0.78, 0.46), (0.6, 0.62), (0.56, 0.95),
    (0.62, 1.3), (0.7, 1.55), (0.52, 1.8), (0.2, 1.93), (0.0, 1.96),
)


class Plan:
    """What the room follows from the game, with the palette already in linear colour."""

    def __init__(self, inputs):
        d = inputs["dharma"]
        room = d["DHARMA"]
        self.half = room["halfWidth"]
        self.back = room["backZ"]
        self.front = room["frontZ"]
        self.wall = room["wallHeight"]
        self.ceiling = room["ceilingHeight"]
        self.inset = room["inset"]
        self.altar = d["ALTAR"]
        self.buddha_at = (d["BUDDHA_AT"]["x"], d["BUDDHA_AT"]["y"], d["BUDDHA_AT"]["z"])
        self.door = d["DHARMA_DOOR"]
        self.candles = d["CANDLE_SPOTS"]
        self.lanterns = d["lanterns"]
        self.seat = d["DHARMA_SEAT_SIZE"]
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        self.side_z = [self.back + self.inset, *d["SIDE_PILLARS_Z"], self.front - self.inset]
        self.front_x = [-(self.half - self.inset), *d["FRONT_PILLARS_X"], self.half - self.inset]
        self.pillar_x = self.half - self.inset

    def walls(self):
        """(placement, length, pillars along it, bays along it) of the four walls, in each wall's own x."""
        side_bays = [((a + b) / 2, b - a) for a, b in zip(self.side_z, self.side_z[1:])]
        front_bays = [((a + b) / 2, b - a) for a, b in zip(self.front_x, self.front_x[1:]) if abs(a + b) > 0.1]
        side_length = (self.front - self.back) - 2.0 * BEAM_DEPTH
        yield at(-self.half, 0.0, 0.0) @ turned(math.pi / 2), side_length, self.side_z, [(-x, w) for x, w in side_bays]
        yield at(self.half, 0.0, 0.0) @ turned(-math.pi / 2), side_length, self.side_z, side_bays
        yield at(0.0, 0.0, self.front) @ turned(math.pi), 2.0 * self.half, self.front_x[1:-1], [(-x, w) for x, w in front_bays]
        yield at(0.0, 0.0, self.back), 2.0 * self.half, [], []


def piece(part, center, size, color, *shown, step=STEP):
    part.box(center, size, color, skip=hidden(*shown), cuts=cells(size, step))


def quad(part, centre, width, height, color):
    """An upright quad in a wall's frame, looking into the room."""
    corner = Vector(centre) - Vector((width / 2, height / 2, 0.0))
    part.grid(corner, Vector((width, 0.0, 0.0)), Vector((0.0, height, 0.0)), 1, 1, color)


def wall_surfaces(part, plan):
    """The plaster of the four walls, darker toward the floor and above the beams, cut small for baked light."""
    plaster = plan.c["wallPlaster"]

    def tone(co):
        low = smoothstep(0.0, 0.9, co.y)
        high = 1.0 - 0.28 * smoothstep(plan.wall - 0.05, plan.wall + 0.05, co.y)
        grain = 0.96 + 0.08 * hash01(co.x, co.y, co.z, 1.0)
        return scaled(plaster, (0.62 + 0.38 * low) * high * grain)

    h = plan.ceiling
    length = plan.front - plan.back
    width = 2.0 * plan.half

    def panel(corner, across, along):
        columns = max(1, round(Vector(across).length / STEP))
        rows = max(1, round(Vector(along).length / STEP))
        part.grid(corner, across, along, columns, rows, tone)

    panel((-plan.half, 0.0, plan.back), (0.0, h, 0.0), (0.0, 0.0, length))
    panel((plan.half, 0.0, plan.back), (0.0, 0.0, length), (0.0, h, 0.0))
    # The front wall stands round the doorway, which has no door in it: visitors walk in from the court.
    opening, high = plan.door["halfWidth"], plan.door["height"]
    panel((-plan.half, 0.0, plan.front), (0.0, h, 0.0), (plan.half - opening, 0.0, 0.0))
    panel((opening, 0.0, plan.front), (0.0, h, 0.0), (plan.half - opening, 0.0, 0.0))
    panel((-opening, high, plan.front), (0.0, h - high, 0.0), (2.0 * opening, 0.0, 0.0))
    panel((-plan.half, 0.0, plan.back), (width, 0.0, 0.0), (0.0, h, 0.0))


def pillar(part, plan, x, z):
    c, height = plan.c, plan.wall
    base, crown = 0.26, height - 0.1
    shape = ((0.28, 0.0), (0.29, 0.13), (0.3, 0.4), (0.28, 0.7), (0.26, 0.92), (0.255, 1.0))
    entasis = smooth_profile([(radius, base + (crown - base) * t) for radius, t in shape], 2)

    def lacquer(co):
        return scaled(c["pillarRed"], 0.9 + 0.1 * math.sin(math.pi * co.z / height))

    with part.placed(spun(x, 0.0, z)):
        part.lathe(entasis, 10, lacquer)
        part.lathe(((0.4, 0.0), (0.4, 0.16), (0.35, base), (0.0, base)), 10, scaled(mix(c["graniteShade"], c["granite"], 0.5), 0.95))
        part.lathe(((0.292, height - 0.62), (0.31, height - 0.58), (0.292, height - 0.54)), 10, c["gilt"])
        part.lathe(((0.26, height - 0.5), (0.36, height - 0.3)), 10, scaled(c["dancheongGreen"], 0.8))


def pillars(part, plan):
    for z in plan.side_z:
        pillar(part, plan, -plan.pillar_x, z)
        pillar(part, plan, plan.pillar_x, z)
    for x in plan.front_x[1:-1]:
        pillar(part, plan, x, plan.front - plan.inset)


def beam_band(part, plan, length):
    """The painted beam under the frieze: green with a blue and a red panel to each unit."""
    c = plan.c
    top = plan.wall
    middle = top - BEAM_BAND / 2
    piece(part, (0.0, middle, BEAM_DEPTH / 2), (length, BEAM_BAND, BEAM_DEPTH), c["dancheongGreen"], "+z", "-y", step=1.0)
    for y in (top - 0.04, top - BEAM_BAND + 0.04):
        piece(part, (0.0, y, BEAM_DEPTH / 2 + 0.01), (length, 0.05, BEAM_DEPTH + 0.02), c["gilt"], "+z", step=2.0)
    units = max(1, round(length / 0.62))
    unit = length / units
    for i in range(units):
        x = -length / 2 + unit * (i + 0.5)
        quad(part, (x, middle, BEAM_DEPTH + 0.004), unit * 0.62, 0.5, c["dancheongBlue"])
        quad(part, (x, middle, BEAM_DEPTH + 0.008), unit * 0.2, 0.22, c["dancheongRed"])
    piece(part, (0.0, plan.ceiling - 0.15, 0.15), (length, 0.3, 0.3), c["dancheongGreen"], "+z", "-y", step=1.0)
    piece(part, (0.0, plan.wall + 0.02, 0.3), (length, 0.05, 0.6), c["woodDark"], "+z", "-y", "+y", step=1.0)


def brackets(part, plan, along):
    """Stacked bracket arms over each pillar: three tiers of blue, green, red and yellow."""
    c = plan.c
    top = plan.wall
    depth = plan.inset
    for x in along:
        part.box((x, top + 0.08, depth), (0.56, 0.16, 0.56), c["dancheongBlue"], skip=("-y",))
        part.box((x, top + 0.26, depth + 0.22), (0.3, 0.2, 0.9), c["dancheongGreen"], skip=("-y",))
        part.box((x, top + 0.26, depth), (1.2, 0.2, 0.3), c["dancheongRed"], skip=("-y",))
        part.box((x, top + 0.46, depth + 0.4), (0.3, 0.2, 1.3), c["dancheongRed"], skip=("-y",))
        part.box((x, top + 0.46, depth), (1.8, 0.2, 0.3), c["dancheongGreen"], skip=("-y",))
        part.box((x, top + 0.64, depth + 0.58), (0.24, 0.16, 1.1), c["dancheongYellow"], skip=("-y",))


def window(part, plan, x, width):
    """A lattice window in a wall bay: a frame, a few bars and a sill."""
    c = plan.c
    low, high = WINDOW
    height = high - low
    middle = (low + high) / 2
    bar = 0.08
    wood = c["woodDark"]
    for y in (low, high):
        part.box((x, y, 0.07), (width, bar, 0.1), wood, skip=hidden("+z", "-y", "+y"))
    for side in (-1.0, 1.0):
        part.box((x + side * (width / 2 - bar / 2), middle, 0.07), (bar, height, 0.1), wood, skip=hidden("+z"))
    part.box((x, low - 0.07, 0.14), (width + 0.16, 0.08, 0.3), c["woodMid"], skip=("-y",))
    columns, rows = max(3, round(width / 0.36)), 7
    for i in range(1, columns):
        quad(part, (x - width / 2 + width * i / columns, middle, 0.058), 0.028, height - bar, c["woodMid"])
    for k in range(1, rows):
        quad(part, (x, low + height * k / rows, 0.062), width - bar, 0.028, c["woodMid"])


def window_width(width):
    return min(2.4, width - 0.8)


def wall_fittings(part, plan, placement, length, along, bays):
    with part.placed(placement):
        beam_band(part, plan, length)
        brackets(part, plan, along)
        for x, width in bays:
            window(part, plan, x, window_width(width))


def altar(part, plan):
    c = plan.c
    a = plan.altar
    top = a["topY"]
    depth = a["maxZ"] - a["minZ"]
    z = (a["minZ"] + a["maxZ"]) / 2
    width = 2.0 * a["halfWidth"]

    def slab(w, y0, y1, d, shift, color, *shown):
        size = (w, y1 - y0, d)
        part.box((0.0, (y0 + y1) / 2, z + shift), size, color, skip=hidden("+x", "-x", "+z", *shown), cuts=cells(size, STEP))

    slab(width, 0.0, 0.3, depth, 0.0, c["lacquerDeep"], "+y")
    slab(width - 0.4, 0.3, 0.62, depth - 0.3, -0.15, scaled(c["pillarRed"], 0.9), "+y")
    slab(width - 0.1, 0.62, top, depth, 0.0, c["lacquerDeep"])
    part.grid((-width / 2 + 0.05, top, a["minZ"]), (width - 0.1, 0.0, 0.0), (0.0, 0.0, depth), 1, 1, scaled(c["woodDark"], 0.7))
    for y, w in ((0.3, width + 0.02), (0.62, width - 0.08), (top, width - 0.08)):
        part.box((0.0, y, a["maxZ"]), (w, 0.05, 0.05), c["gilt"], skip=hidden("+z", "+y"))
    front = a["maxZ"] - 0.3 + 0.012
    accents = (c["gilt"], c["dancheongGreen"], c["dancheongYellow"], c["dancheongBlue"])
    for i in range(9):
        x = -3.2 + 0.8 * i
        part.grid((x - 0.28, 0.35, front), (0.56, 0.0, 0.0), (0.0, 0.22, 0.0), 1, 1, accents[i % len(accents)])

    for x, candle_z in plan.candles:
        with part.placed(spun(x, top, candle_z)):
            part.lathe(((0.15, 0.0), (0.13, 0.06), (0.0, 0.06)), 10, c["brass"])
            part.lathe(((0.055, 0.06), (0.05, 0.4), (0.0, 0.4)), 8, c["wax"])
            part.lathe(((0.006, 0.4), (0.006, 0.46)), 4, c["wick"])

    stand_z = a["maxZ"] + 0.9
    piece(part, (0.0, 0.28, stand_z), (0.7, 0.56, 0.7), c["lacquerDeep"], "+x", "-x", "+z", "-z", "+y")
    with part.placed(spun(0.0, 0.56, stand_z)):
        part.lathe(((0.0, 0.0), (0.2, 0.02), (0.3, 0.12), (0.24, 0.24), (0.3, 0.3), (0.27, 0.34), (0.0, 0.32)), 14, c["brass"])


def structure(plan):
    part = Part("structure", frame=GAME)
    wall_surfaces(part, plan)
    pillars(part, plan)
    for placement, length, along, bays in plan.walls():
        wall_fittings(part, plan, placement, length, along, bays)
    altar(part, plan)
    return part


def paper(plan):
    """The cream paper behind each lattice: it takes the light of the room and glows a little."""
    part = Part("paper", frame=GAME)
    low, high = WINDOW

    def sheet(co):
        return scaled(plan.c["paper"], 0.86 + 0.14 * math.sin(math.pi * (co.y - low) / (high - low)))

    for placement, _length, _along, bays in plan.walls():
        with part.placed(placement):
            for x, width in bays:
                inner = window_width(width) - 0.1
                part.grid((x - inner / 2, low, 0.04), (inner, 0.0, 0.0), (0.0, high - low, 0.0), 1, 4, sheet)
    return part


def ceiling(plan):
    part = Part("ceiling", frame=GAME)
    c, half, top = plan.c, plan.half, plan.ceiling
    zs = plan.side_z
    beam_h, beam_w = 0.55, 0.4
    cols = 8
    xs = [-half + 2 * half * i / cols for i in range(cols + 1)]
    boards = (scaled(c["dancheongGreen"], 0.55), scaled(c["lacquerDeep"], 0.9), scaled(c["dancheongBlue"], 0.55))
    for i, (x0, x1) in enumerate(zip(xs, xs[1:])):
        for j, (z0, z1) in enumerate(zip(zs, zs[1:])):
            z0, z1 = z0 + beam_w / 2, z1 - beam_w / 2
            part.grid((x0, top, z0), (x1 - x0, 0.0, 0.0), (0.0, 0.0, z1 - z0), 1, 1, c["woodCeiling"])
            inner = 0.12
            part.grid((x0 + inner, top - 0.01, z0 + inner), (x1 - x0 - 2 * inner, 0.0, 0.0), (0.0, 0.0, z1 - z0 - 2 * inner), 1, 1, boards[(i + j) % len(boards)])
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            part.radial((mx, top - 0.02, mz), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), 0.42, 1, 10, c["gilt"], smooth=False)
            part.radial((mx, top - 0.03, mz), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), 0.22, 1, 8, c["dancheongRed"], smooth=False)
    for x in xs[1:-1]:
        part.box((x, top - 0.05, 0.0), (0.1, 0.1, zs[-1] - zs[0]), c["woodMid"], skip=hidden("-y"))
    bottom = top - beam_h
    units = 18
    unit = (2 * half - 0.6) / units
    for z in zs:
        piece(part, (0.0, (bottom + top) / 2, z), (2 * half - 0.1, beam_h, beam_w), c["dancheongGreen"], "-y", "+z", "-z", step=1.0)
        for side in (-1.0, 1.0):
            face_z = z + side * (beam_w / 2 + 0.004)
            for k in range(units):
                x = -half + 0.3 + unit * (k + 0.5)
                shade = c["dancheongBlue"] if k % 2 == 0 else c["dancheongRed"]
                part.grid((x - side * unit * 0.4, bottom + 0.08, face_z), (side * unit * 0.8, 0.0, 0.0), (0.0, beam_h - 0.16, 0.0), 1, 1, shade)
    for spot in plan.lanterns:
        part.tube([(spot["x"], spot["y"], spot["z"]), (spot["x"], top - 0.05, spot["z"])], [0.012, 0.012], 4, scaled(c["cord"], 0.8), caps=False)
    return part


def floor(plan):
    part = Part("floor", frame=GAME)
    c, half = plan.c, plan.half
    length = plan.front - plan.back
    part.grid((-half, -0.012, plan.front), (2 * half, 0.0, 0.0), (0.0, 0.0, -length), 1, 1, c["floorGroove"])
    planks = round(2 * half / FLOOR_PLANK)
    width = 2 * half / planks
    rows = max(1, round(length / 1.5))

    def wood(index):
        grain = 0.88 + 0.24 * hash01(index, 0.0, 0.0, 3.0)

        def tone(co):
            edge = min(half - abs(co.x), co.z - plan.back, plan.front - co.z)
            return scaled(c["floorWood"], grain * (0.55 + 0.45 * smoothstep(0.0, 1.4, edge)))

        return tone

    for i in range(planks):
        part.grid((-half + i * width + 0.012, 0.0, plan.front), (width - 0.024, 0.0, 0.0), (0.0, 0.0, -length), 1, rows, wood(i))
    runner = 1.5
    z0, z1 = plan.altar["maxZ"] + 0.35, plan.front
    part.grid((-runner / 2, 0.012, z1), (runner, 0.0, 0.0), (0.0, 0.0, z0 - z1), 1, 8, c["lacquerDeep"])
    for edge in (-runner / 2, runner / 2 - 0.09):
        part.grid((edge, 0.014, z1), (0.09, 0.0, 0.0), (0.0, 0.0, z0 - z1), 1, 1, c["gilt"])
    return part


def mural(plan):
    """The painting behind the Buddha: a red field, a pale disc behind the halo, rows of attendants and gold clouds."""
    c = plan.c
    part = Part("mural", frame=GAME)
    z = plan.back + 0.02
    left, right = -plan.half + 0.8, plan.half - 0.8
    low, high = 0.9, plan.wall - BEAM_BAND
    centre = (0.0, 3.9)

    def field(co):
        glow_amount = 1.0 - smoothstep(0.0, 8.5, math.hypot(co.x - centre[0], (co.y - centre[1]) * 1.3))
        base = mix(scaled(c["muralGround"], 0.62), c["muralGround"], smoothstep(low, 3.0, co.y))
        return mix(base, scaled(c["muralHalo"], 0.55), 0.22 * glow_amount)

    columns, rows = round((right - left) / STEP), round((high - low) / STEP)
    part.grid((left, low, z), (right - left, 0.0, 0.0), (0.0, high - low, 0.0), columns, rows, field)

    ring = []
    for i in range(56):
        angle = math.tau * i / 56
        x = centre[0] + 3.4 * math.cos(angle)
        y = min(high - 0.04, max(low + 0.04, centre[1] + 3.4 * math.sin(angle)))
        ring.append((x, y, z + 0.004))
    part.fan((centre[0], centre[1], z + 0.004), ring, scaled(c["muralHalo"], 0.5), scaled(c["muralGround"], 0.9))

    robes = (c["dancheongBlue"], c["dancheongGreen"], c["pillarRed"], c["dancheongYellow"], c["lacquerDeep"])
    for side in (-1.0, 1.0):
        for column, x in enumerate((4.7, 6.5, 8.3)):
            for row, y in enumerate((1.75, 3.0, 4.25)):
                index = column * 3 + row + (0 if side < 0 else 9)
                px = side * x + 0.15 * (hash01(index, 1.0, 0.0) - 0.5)
                body_color = robes[index % len(robes)]
                part.radial((px, y - 0.42, z + 0.006), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), 0.5, 1, 8, c["petal"], smooth=False)
                part.polygon([(px - 0.42, y - 0.4, z + 0.01), (px + 0.42, y - 0.4, z + 0.01), (px + 0.2, y + 0.18, z + 0.01), (px - 0.2, y + 0.18, z + 0.01)], body_color)
                part.radial((px, y + 0.34, z + 0.008), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), 0.3, 1, 10, c["muralHalo"], smooth=False)
                part.radial((px, y + 0.34, z + 0.012), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), 0.14, 1, 8, c["skin"], smooth=False)

    for index in range(14):
        side = 1.0 if index % 2 else -1.0
        cx = side * (3.2 + 5.2 * hash01(index, 2.0, 0.0))
        cy = low + 0.4 + (high - low - 0.8) * hash01(index, 3.0, 0.0)
        puff = 0.16 + 0.08 * hash01(index, 4.0, 0.0)
        for k, (dx, dy, scale) in enumerate(((-1.0, -0.2, 0.75), (0.0, 0.1, 1.0), (1.0, -0.2, 0.8))):
            part.radial((cx + dx * puff * 1.25, cy + dy * puff, z + 0.014 + 0.002 * k), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), puff * scale, 1, 9, scaled(c["muralLine"], 0.8), smooth=False)

    for x, y, w, h in (
        (0.0, high - 0.03, right - left, 0.06),
        (0.0, low + 0.03, right - left, 0.06),
        (left + 0.03, (low + high) / 2, 0.06, high - low),
        (right - 0.03, (low + high) / 2, 0.06, high - low),
    ):
        part.box((x, y, z + 0.02), (w, h, 0.03), c["muralLine"], skip=hidden("+z"))
    part.box((0.0, high - 0.1, z + 0.016), (right - left - 0.1, 0.03, 0.02), c["muralInk"], skip=hidden("+z"))
    part.box((0.0, low + 0.1, z + 0.016), (right - left - 0.1, 0.03, 0.02), c["muralInk"], skip=hidden("+z"))
    return part


def shift(part, plan):
    """Moves a finished Part from the figure's own origin onto the altar."""
    bmesh.ops.translate(part.bm, vec=from_game(Vector(plan.buddha_at)), verts=part.bm.verts)


def head_point(azimuth, latitude, grow=0.0):
    """A point on the head sphere; azimuth 0 faces the viewer (+Z)."""
    radius = HEAD_RADIUS + grow
    ring = radius * math.cos(latitude)
    return Vector((ring * math.sin(azimuth), HEAD.y + radius * math.sin(latitude), ring * math.cos(azimuth)))


def hairline(azimuth):
    """Latitude where the hair starts: high on the forehead, low at the nape."""
    return 0.62 - 0.74 * smoothstep(0.3, 2.5, abs(azimuth))


def curls(part, mat):
    hair = mat["buddhaHair"]
    rows = 11
    for row in range(rows):
        latitude = -0.12 + row * (1.12 - -0.12) / (rows - 1)
        circumference = math.tau * HEAD_RADIUS * math.cos(latitude)
        count = max(6, round(circumference / 0.125))
        for i in range(count):
            azimuth = math.tau * (i + 0.5 * (row % 2)) / count
            azimuth = (azimuth + math.pi) % math.tau - math.pi
            if latitude < hairline(azimuth):
                continue
            centre = head_point(azimuth, latitude, 0.012)
            tone = scaled(hair, 0.8 + 0.2 * smoothstep(-0.1, 1.1, latitude))
            part.sphere(centre, (0.058, 0.058, 0.052), 6, 3, tone)


def body(part, mat):
    gold, deep, pale = mat["buddhaGold"], mat["buddhaGoldDeep"], mat["buddhaGoldPale"]

    def drape(height, angle):
        band = smoothstep(0.35, 0.8, height) * (1.0 - smoothstep(1.5, 1.9, height))
        return 1.0 + 0.026 * band * math.cos(8.0 * angle)

    def tone(co):
        height = co.z
        ridge = 0.5 + 0.5 * math.cos(8.0 * math.atan2(co.y, co.x))
        base = mix(deep, gold, smoothstep(0.1, 0.6, height))
        base = mix(base, pale, 0.5 * smoothstep(1.5, 1.9, height))
        return scaled(base, 0.9 + 0.1 * ridge)

    with part.placed(spun(0.0, 0.0, 0.0)):
        part.lathe(smooth_profile(BODY, 3), 32, tone, fold=drape, squash=SQUASH)

    hem = [(0.97 * math.cos(math.tau * i / 36), 0.3, 0.97 * math.sin(math.tau * i / 36) * SQUASH) for i in range(36)]
    part.tube(hem, [0.085] * 36, 6, deep, up=(0.0, 1.0, 0.0), flat=0.9, closed=True)

    for side in (-1.0, 1.0):
        part.sphere((side * 0.74, 0.4, 0.58), (0.36, 0.2, 0.34), 10, 6, scaled(gold, 0.95))
        part.sphere((side * 0.36, 0.38, 0.9), (0.2, 0.05, 0.25), 8, 4, pale)

    part.sphere((0.0, 0.78, 0.62), (0.3, 0.11, 0.2), 10, 6, pale)
    for side in (-1.0, 1.0):
        part.sphere((side * 0.14, 0.82, 0.7), (0.17, 0.07, 0.12), 8, 5, scaled(pale, 0.97))


def arms(part, mat):
    gold = mat["buddhaGold"]
    for side in (-1.0, 1.0):
        upper = [(side * 0.66, 1.74, 0.04), (side * 0.74, 1.42, 0.08), (side * 0.77, 1.08, 0.14)]
        part.tube(upper, [0.17, 0.165, 0.15], 8, gold, up=(0.0, 0.0, 1.0), caps=False)
        fore = [(side * 0.77, 1.08, 0.14), (side * 0.6, 0.93, 0.46), (side * 0.3, 0.86, 0.7)]
        part.tube(fore, [0.15, 0.135, 0.11], 8, gold, up=(0.0, 1.0, 0.0), caps=False)
        part.sphere((side * 0.66, 1.74, 0.04), (0.17,) * 3, 10, 6, gold)
        part.sphere((side * 0.77, 1.08, 0.14), (0.152,) * 3, 10, 6, gold)
        part.sphere((side * 0.3, 0.86, 0.7), (0.112,) * 3, 8, 5, gold)


def robe_band(part, mat, body_tree):
    red = mat["buddhaRobe"]
    start, end = Vector((-0.4, 1.7)), Vector((0.45, 1.05))
    along = (end - start).normalized()
    lanes = ([], [], [])
    for i in range(20):
        t = i / 19.0
        centre = start + (end - start) * t
        half = 0.085 * (1.0 - 0.25 * t)
        for lane, sign in zip(lanes, (1.0, 0.0, -1.0)):
            x = centre.x + sign * half * -along.y
            y = centre.y + sign * half * along.x
            lane.append(surface_point(body_tree, x, y + LIFT, 0.016, side=-1.0))
    with part.world():
        for first, second in zip(lanes, lanes[1:]):
            part.ribbon(first, second, red, toward=lambda co: co + Vector((0.0, -1.0, 0.0)), smooth=True)


def face(part, mat, skull_tree):
    pale = mat["buddhaGoldPale"]
    lift = 0.003
    middle = Vector((0.0, 0.0, HEAD.y + LIFT))

    def outward(co):
        return co + (co - middle)

    def point(x, height, extra=lift):
        return surface_point(skull_tree, x, height + LIFT, extra, side=-1.0)

    def crescent(cx, cy, half_width, sag, thickness, points, color):
        upper, lower = [], []
        for i in range(points):
            u = -1.0 + 2.0 * i / (points - 1)
            y = cy - sag * (1.0 - u * u)
            t = thickness * math.sqrt(1.0 - u * u) + 0.0008
            upper.append(point(cx + u * half_width, y + t))
            lower.append(point(cx + u * half_width, y - t))
        part.ribbon(lower, upper, color, toward=outward)

    with part.world():
        for side in (-1.0, 1.0):
            crescent(side * 0.135, 2.29, 0.065, 0.016, 0.006, 7, mat["eye"])
            crescent(side * 0.14, 2.385, 0.085, -0.014, 0.007, 6, mat["brow"])
            hub = point(side * 0.23, 2.17)
            ring = [point(side * 0.23 + 0.05 * math.cos(a), 2.17 + 0.035 * math.sin(a)) for a in (math.tau * i / 8 for i in range(8))]
            faces = part.fan(hub, ring, mix(pale, mat["blush"], 0.8), pale)
            part.orient(faces, outward)
        crescent(0.0, 2.075, 0.05, 0.012, 0.004, 5, mat["mouth"])
        part.sphere(point(0.0, 2.19, 0.008), (0.034, 0.04, 0.045), 7, 5, scaled(pale, 0.97))
        part.sphere(point(0.0, 2.455, 0.003), (0.03, 0.02, 0.03), 7, 4, mat["buddhaUrna"])


def head(part, mat):
    pale, gold = mat["buddhaGoldPale"], mat["buddhaGold"]
    part.sphere(HEAD, (HEAD_RADIUS,) * 3, 20, 14, pale)
    part.sphere((0.0, 2.66, 0.0), (0.17, 0.17 * 0.9, 0.17), 12, 8, pale)
    curls(part, mat)
    for side in (-1.0, 1.0):
        ear = [(side * 0.4, 2.42, -0.02), (side * 0.43, 2.2, 0.0), (side * 0.42, 1.92, 0.03)]
        part.tube(ear, [0.05, 0.07, 0.035], 6, scaled(pale, 0.96), up=(1.0, 0.0, 0.0), flat=0.7)
    part.sphere((0.0, 1.98, 0.0), (0.2, 0.18, 0.2), 10, 6, gold)

    scratch = Part("skull", frame=GAME @ at(0.0, LIFT, 0.0))
    scratch.sphere(HEAD, (HEAD_RADIUS,) * 3, 20, 14, pale)
    tree = scratch.raycaster()
    face(part, mat, tree)
    scratch.bm.free()


def buddha(plan):
    mat = plan.c
    part = Part("buddha", frame=GAME @ at(0.0, LIFT, 0.0))
    body(part, mat)
    arms(part, mat)
    head(part, mat)
    scratch = Part("torso", frame=GAME @ at(0.0, LIFT, 0.0))
    with scratch.placed(spun(0.0, 0.0, 0.0)):
        scratch.lathe(smooth_profile(BODY, 3), 32, (1.0, 1.0, 1.0), squash=SQUASH)
    robe_band(part, mat, scratch.raycaster())
    scratch.bm.free()
    shift(part, plan)
    return part


def halo(plan):
    mat = plan.c
    gold, pale, deep = mat["buddhaGold"], mat["buddhaGoldPale"], mat["buddhaGoldDeep"]
    part = Part("halo", frame=GAME @ at(*HALO_AT))
    for radius, thickness, steps, color in ((1.62, 0.06, 48, gold), (1.2, 0.04, 40, pale), (0.86, 0.035, 32, deep)):
        ring = [(radius * math.cos(math.tau * i / steps), radius * math.sin(math.tau * i / steps), 0.0) for i in range(steps)]
        part.tube(ring, [thickness] * steps, 5, color, up=(0.0, 0.0, 1.0), closed=True)
    for i in range(18):
        angle = math.tau * (i + 0.5) / 18
        part.sphere((1.41 * math.cos(angle), 1.41 * math.sin(angle), 0.0), (0.045,) * 3, 6, 3, pale)
    rays = 36
    for i in range(rays):
        angle = math.tau * i / rays
        long = i % 2 == 0
        length = 0.5 if long else 0.3
        radial = Vector((math.sin(angle), math.cos(angle), 0.0))
        sway = Vector((math.cos(angle), -math.sin(angle), 0.0))
        path = [radial * (1.64 + length * s) + sway * (0.025 * math.sin(math.tau * s)) for s in (0.0, 0.33, 0.66, 1.0)]
        part.tube(path, [0.05, 0.056, 0.034, 0.0], 5, gold if long else pale, up=(0.0, 0.0, 1.0), flat=0.5)
    shift(part, plan)
    return part


def lotus(plan):
    mat = plan.c
    pale, deep = mat["petal"], mat["petalDeep"]
    base = mat["buddhaGoldDeep"]
    part = Part("lotus", frame=GAME)
    rows = (
        (20, 0.0, deep, pale, (1.1, -0.2), (1.62, -0.04)),
        (26, 0.12, pale, deep, (0.95, 0.0), (1.42, 0.22)),
    )
    for count, turn, root, tip, (r0, h0), (r1, h1) in rows:
        for i in range(count):
            angle = math.tau * i / count + turn
            radial = Vector((math.sin(angle), 0.0, math.cos(angle) * SQUASH))
            heading = Vector((r1 - r0, h1 - h0)).normalized()
            normal = radial * -heading.y + Vector((0.0, heading.x, 0.0))
            path = []
            for s in (0.0, 0.25, 0.5, 0.75, 1.0):
                r = r0 + (r1 - r0) * s
                h = h0 + (h1 - h0) * s + 0.05 * math.sin(math.pi * s)
                path.append(radial * r + Vector((0.0, h, 0.0)))
            color = lambda co, root=root, tip=tip, r0=r0, r1=r1: mix(root, tip, smoothstep(r0, r1, math.hypot(co.x, co.z / SQUASH)))  # noqa: E731
            part.tube(path, [0.0, 0.17, 0.24, 0.16, 0.0], 5, color, up=normal, flat=0.28)
    profile = ((1.3, -0.45), (1.3, -0.4), (1.14, -0.33), (1.06, -0.3), (1.12, -0.22), (1.12, -0.15), (0.9, -0.12))
    with part.placed(spun(0.0, 0.0, 0.0)):
        part.lathe(profile, 16, lambda co: scaled(base, 0.85 + 0.3 * smoothstep(-0.45, -0.12, co.z)), cap_bottom=True, squash=SQUASH)
    shift(part, plan)
    return part


def glow(plan):
    mat = plan.c
    core, middle, edge = mat["flameCore"], mat["flameMid"], mat["flameEdge"]
    part = Part("glow", frame=GAME @ at(*GLOW_AT))

    def spot(co):
        d = min(co.length / GLOW_RADIUS, 1.0)
        tint = mix(core, middle, smoothstep(0.0, 0.3, d))
        tint = mix(tint, edge, smoothstep(0.3, 1.0, d))
        alpha = 1.0 - 0.3 * smoothstep(0.0, 0.3, d) - 0.7 * smoothstep(0.3, 1.0, d)
        return scaled(tint, alpha)

    part.radial((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), GLOW_RADIUS, 5, 20, spot)
    shift(part, plan)
    return part


def seat(plan):
    """A round floor seat at the origin: a quilted top with a stitched ring and a flower at its middle."""
    c = plan.c
    radius = plan.seat["x"] / 2
    part = Part("seat", frame=GAME)
    side = ((radius, 0.0), (radius * 1.015, 0.03), (radius, 0.07), (radius * 0.94, 0.105), (radius * 0.75, 0.125), (radius * 0.4, 0.14), (0.0, 0.145))

    def cloth(co):
        shade = 0.78 + 0.22 * smoothstep(0.0, 0.1, co.z)
        return mix(scaled(c["seatCloth"], shade), scaled(c["seatTop"], 0.95), smoothstep(0.1, 0.13, co.z))

    with part.placed(spun(0.0, 0.0, 0.0)):
        part.lathe(side, 12, cloth)
    ring = [(0.62 * radius * math.cos(math.tau * i / 12), 0.136, 0.62 * radius * math.sin(math.tau * i / 12)) for i in range(12)]
    part.tube(ring, [0.012] * 12, 3, c["seatStitch"], up=(0.0, 1.0, 0.0), closed=True)
    for i in range(6):
        angle = math.tau * i / 6
        part.radial((0.12 * math.cos(angle), 0.148, 0.12 * math.sin(angle)), (1.0, 0.0, 0.0), (0.0, 0.0, -1.0), 0.055, 1, 6, c["seatPetal"], smooth=False)
    return part


def build(inputs, out_dir):
    plan = Plan(inputs)
    solid = common.vertex_color_material("dharma")
    objects = {
        "structure": structure(plan).build(solid),
        "ceiling": ceiling(plan).build(solid),
        "floor": floor(plan).build(solid, crease=False),
        "buddha": buddha(plan).build(solid, crease=False),
        "lotus": lotus(plan).build(solid, crease=False),
        "halo": halo(plan).build(solid, crease=False),
    }
    common.bake_vertex_occlusion([objects["structure"], objects["ceiling"], objects["floor"]], distance=0.9, samples=40, floor=0.55)
    common.bake_vertex_occlusion([objects["buddha"], objects["lotus"], objects["halo"]], distance=0.35, samples=64, floor=0.5)
    objects["glow"] = glow(plan).build(solid, crease=False)
    objects["paper"] = paper(plan).build(solid, crease=False)
    objects["mural"] = mural(plan).build(solid, crease=False)
    objects["seat"] = seat(plan).build(solid, crease=False)

    names = inputs["names"]["DHARMA_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"dharma meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "dharma.glb"))
    print("dharma triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
