"""The 법당's outside, standing in the world: a granite plinth, red columns, plaster walls with lattice windows,
painted beams with stacked brackets under a tiled gable roof whose slope is concave and whose eaves turn up.

It is drawn in the room's own frame (the middle of the floor at the origin, the open doorway in the +z wall, the
ridge along x) and moved to where the game puts the room. Four Parts, so the game can hide the ones that stand
between the camera and the people inside: the plinth, the walls on three sides, the front wall and the roof.
Every dimension comes from the inputs; the plaster stands just outside the room's own surfaces, so the
shell closes round the room without touching it.
"""

import math

from mathutils import Vector

from common import GAME, Part, at, cells, hash01, hidden, mix, scaled, smoothstep, spun, turned

UP = Vector((0.0, 1.0, 0.0))
GAP = 0.02  # the plaster stands this far outside the room's own surfaces
PLINTH = 0.2  # stone drum under each column
COLUMN = 0.26
BEAM_DEPTH = 0.5
BEAM_HEIGHT = 0.62
EAVE_LIFT = 0.5  # the eaves' edge stands this far above the beams
ROOF_THICK = 0.3  # tile to underside
FASCIA = 0.3
JAMB = 0.14
WINDOW = (1.5, 4.5)  # bottom and top of the lattice windows
RIB = 0.4  # tile ribs along the roof's length
SLOPE_STEPS = 12
PLAQUE_Y = 4.9


class Shape:
    """Where everything stands, from the layout in the inputs."""

    def __init__(self, plan):
        room, shell, door = plan.room, plan.shell, plan.door
        self.c = plan.c
        self.half = room["halfWidth"]
        self.back = room["backZ"]
        self.front = room["frontZ"]
        self.wall = shell["wall"]
        self.reach = shell["plinth"]
        self.porch = shell["porchZ"]
        self.floor = shell["baseHeight"]
        self.beam_top = shell["beamTop"]
        self.eave = shell["eave"]
        self.rise = shell["rise"]
        self.eave_y = self.beam_top + EAVE_LIFT
        self.wall_top = self.beam_top - BEAM_HEIGHT + 0.05
        self.hx = self.half + GAP + self.wall  # the columns' line, which is the plaster's outer face
        self.z0 = self.back - GAP - self.wall
        self.z1 = self.front + GAP + self.wall
        self.cz = (self.z0 + self.z1) / 2
        self.hz = (self.z1 - self.z0) / 2
        self.span = self.hz + self.eave  # from the ridge to the eaves' edge
        self.length = self.hx + self.eave  # from the middle to the gable eaves
        self.door_half = door["halfWidth"]
        self.door_high = door["height"]
        self.jambs = self.door_half + JAMB
        bay = self.door_half + 0.5
        middle = (bay + self.hx) / 2
        self.xs = [-self.hx, -middle, -bay, bay, middle, self.hx]
        self.zs = [self.z0 + (self.z1 - self.z0) * i / 4 for i in range(5)]

    def roof(self, s, x):
        """Height of the tile surface `s` metres from the ridge, at `x`: concave, with the eaves and the gable ends curling up."""
        r = max(0.0, 1.0 - s / self.span)
        curl = 0.2 * smoothstep(0.72, 1.0, s / self.span)
        end = 0.18 * smoothstep(0.55, 1.0, abs(x) / self.length)
        return self.eave_y + self.rise * r**1.45 + curl + end

    def sides(self):
        """(name, outward direction, stations of its columns along x or z, the part it belongs to) of the four walls."""
        return (
            ("front", (0.0, 1.0), self.xs, "front"),
            ("back", (0.0, -1.0), self.xs, "walls"),
            ("east", (1.0, 0.0), self.zs, "walls"),
            ("west", (-1.0, 0.0), self.zs, "walls"),
        )

    def columns(self):
        """(x, z, outward directions, part) of every column."""
        spots = []
        for x in self.xs:
            corner = abs(x) == self.hx
            for z, out in ((self.z1, (0.0, 1.0)), (self.z0, (0.0, -1.0))):
                outs = [out]
                if corner:
                    outs.append((1.0 if x > 0 else -1.0, 0.0))
                spots.append((x, z, outs, "walls" if corner or out[1] < 0 else "front"))
        for x, out in ((self.hx, (1.0, 0.0)), (-self.hx, (-1.0, 0.0))):
            for z in self.zs[1:-1]:
                spots.append((x, z, [out], "walls"))
        return spots


def face(part, centre, out, width, height, color):
    """A quad standing upright at `centre`, looking along the horizontal direction `out`."""
    toward = Vector((out[0], 0.0, out[1]))
    across = UP.cross(toward)
    corner = Vector(centre) - across * (width / 2) - UP * (height / 2)
    part.grid(corner, across * width, UP * height, 1, 1, color)


def quad(part, centre, width, height, color):
    """An upright quad in a wall's own frame (x along the wall, z out of it)."""
    corner = Vector(centre) - Vector((width / 2, height / 2, 0.0))
    part.grid(corner, Vector((width, 0.0, 0.0)), Vector((0.0, height, 0.0)), 1, 1, color)


def stone_tone(s):
    c = s.c

    def stone(co):
        grain = hash01(math.floor(co.x * 2.0), 0.0, math.floor(co.z * 2.0), 6.0)
        return scaled(mix(c["graniteShade"], c["granite"], 0.55 + 0.3 * grain), 0.95)

    return stone


def plinth(part, s):
    """The granite ring the walls stand on, and the flush stone through the doorway."""
    stone = stone_tone(s)
    top = s.floor
    x_out = s.half + s.reach
    back_out = s.back - s.reach

    def slab(x0, x1, z0, z1, high, *skip):
        size = (x1 - x0, high + 0.1, z1 - z0)
        part.box(((x0 + x1) / 2, (high - 0.1) / 2, (z0 + z1) / 2), size, stone, skip=("-y", *skip), cuts=cells(size, 1.0))

    slab(-x_out, x_out, back_out, s.back, top, "+z")
    for sign in (1.0, -1.0):
        low, high = sorted((sign * s.half, sign * x_out))
        slab(low, high, s.back, s.front, top, "-x" if sign > 0 else "+x", "-z", "+z")
        low, high = sorted((sign * s.jambs, sign * x_out))
        slab(low, high, s.front, s.porch, top, "-z")
    slab(-s.jambs, s.jambs, s.front, s.porch, 0.02, "-z", "-x", "+x")


def column_bases(part, s):
    c = s.c
    for x, z, _, _ in s.columns():
        with part.placed(spun(x, s.floor, z)):
            part.lathe(
                ((COLUMN + 0.12, 0.0), (COLUMN + 0.12, PLINTH), (COLUMN + 0.01, PLINTH + 0.03), (0.0, PLINTH + 0.03)),
                8,
                scaled(mix(c["graniteShade"], c["granite"], 0.6), 0.95),
                smooth=False,
            )


def columns(parts, s):
    c = s.c
    base = s.floor + PLINTH + 0.03
    height = s.beam_top - 0.05 - base
    for x, z, _, name in s.columns():
        with parts[name].placed(spun(x, base, z)):
            parts[name].lathe(
                ((COLUMN - 0.03, 0.0), (COLUMN, 1.2), (COLUMN - 0.01, height * 0.55), (COLUMN - 0.04, height)),
                8,
                lambda co: scaled(c["pillarRed"], 0.88 + 0.14 * smoothstep(0.0, height * 0.6, co.z)),
            )


def walls(parts, s):
    """The plaster: back and side walls in one part, the front wall in the other, with the doorway left open."""
    c = s.c
    height = s.wall_top - s.floor
    middle = (s.wall_top + s.floor) / 2

    def plaster(co):
        return scaled(c["wallPlaster"], 0.82 + 0.18 * smoothstep(s.floor, s.floor + 1.8, co.y))

    def block(part, centre, size, *shown):
        part.box(centre, size, plaster, skip=hidden(*shown), cuts=cells(size, 1.2))

    thick = s.wall
    block(parts["walls"], (0.0, middle, s.z0 + thick / 2), (2 * s.hx, height, thick), "-z")
    for sign in (1.0, -1.0):
        block(parts["walls"], (sign * (s.hx - thick / 2), middle, s.cz), (thick, height, s.z1 - s.z0), "+x" if sign > 0 else "-x")
        run = s.hx - s.jambs
        block(parts["front"], (sign * (s.hx + s.jambs) / 2, middle, s.z1 - thick / 2), (run, height, thick), "+z")

    # Above the doorway: a dark lintel on the jambs, the plaster over it and the board that names the 법당.
    front = parts["front"]
    lintel = s.door_high + 0.2
    block(front, (0.0, (s.wall_top + lintel) / 2, s.z1 - thick / 2), (2 * s.jambs, s.wall_top - lintel, thick), "+z")
    front.box((0.0, s.door_high + 0.1, s.z1 - thick / 2), (2 * s.jambs, 0.2, thick), c["woodDark"], skip=hidden("+z", "-y"))
    for sign in (1.0, -1.0):
        front.box(
            (sign * (s.door_half + JAMB / 2), (0.02 + s.door_high) / 2, s.z1 - thick / 2),
            (JAMB, s.door_high - 0.02, thick),
            c["woodDark"],
            skip=hidden("+z", "-x" if sign > 0 else "+x"),
        )
    front.box((0.0, PLAQUE_Y, s.z1 + 0.04), (2.7, 0.95, 0.08), c["gilt"], skip=hidden("+z", "+y", "-y", "+x", "-x"))
    front.box((0.0, PLAQUE_Y, s.z1 + 0.09), (2.5, 0.75, 0.02), c["lacquerDeep"], skip=hidden("+z"))


def window(part, s, x, width):
    """A lattice window in a wall bay, in the wall's own frame: a frame, a paper pane, a few bars and a sill."""
    c = s.c
    low, high = WINDOW
    height = high - low
    middle = (low + high) / 2
    bar = 0.1
    wood = c["woodDark"]
    for y in (low, high):
        part.box((x, y, 0.06), (width, bar, 0.12), wood, skip=hidden("+z", "-y", "+y"))
    for side in (-1.0, 1.0):
        part.box((x + side * (width / 2 - bar / 2), middle, 0.06), (bar, height - bar, 0.12), wood, skip=hidden("+z"))
    part.box((x, low - 0.09, 0.16), (width + 0.24, 0.1, 0.34), c["woodMid"], skip=("-y",))
    quad(part, (x, middle, 0.012), width - bar, height - bar, c["paper"])
    columns_across, rows = max(3, round(width / 0.5)), 7
    for i in range(1, columns_across):
        quad(part, (x - (width - bar) / 2 + (width - bar) * i / columns_across, middle, 0.035), 0.035, height - bar, c["woodMid"])
    for k in range(1, rows):
        quad(part, (x, low + bar / 2 + (height - bar) * k / rows, 0.04), width - bar, 0.035, c["woodMid"])


def windows(parts, s):
    # Where each wall's own frame stands (its outer face, looking out), and how a position along the world's x or z lands on its x.
    placements = {
        "front": (0.0, s.z1, 0.0, lambda mid: mid),
        "back": (0.0, s.z0, math.pi, lambda mid: -mid),
        "east": (s.hx, s.cz, math.pi / 2, lambda mid: s.cz - mid),
        "west": (-s.hx, s.cz, -math.pi / 2, lambda mid: mid - s.cz),
    }
    for name, _, stations, owner in s.sides():
        x, z, yaw, along = placements[name]
        with parts[owner].placed(at(x, 0.0, z) @ turned(yaw)):
            for a, b in zip(stations, stations[1:]):
                if name in ("front", "back") and a < 0.0 < b:
                    continue
                window(parts[owner], s, along((a + b) / 2), min(2.4, b - a - 0.8))


def beams(parts, s):
    c = s.c
    y = s.beam_top - BEAM_HEIGHT / 2
    runs = (
        ("front", (-s.hx, s.z1), (s.hx, s.z1), (0.0, 1.0)),
        ("walls", (-s.hx, s.z0), (s.hx, s.z0), (0.0, -1.0)),
        ("walls", (s.hx, s.z0), (s.hx, s.z1), (1.0, 0.0)),
        ("walls", (-s.hx, s.z0), (-s.hx, s.z1), (-1.0, 0.0)),
    )
    for name, a, b, out in runs:
        part = parts[name]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        size = (BEAM_DEPTH, BEAM_HEIGHT, length + BEAM_DEPTH) if out[0] else (length + BEAM_DEPTH, BEAM_HEIGHT, BEAM_DEPTH)
        part.box(((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2), size, c["dancheongGreen"], skip=("-y", "+y"), cuts=cells(size, 2.0))
        units = max(1, round(length / 0.7))
        unit = length / units
        for i in range(units):
            t = (i + 0.5) / units
            spot = (a[0] + (b[0] - a[0]) * t + out[0] * (BEAM_DEPTH / 2 + 0.004), y, a[1] + (b[1] - a[1]) * t + out[1] * (BEAM_DEPTH / 2 + 0.004))
            face(part, spot, out, unit * 0.62, 0.38, c["dancheongBlue"])
            face(part, (spot[0] + out[0] * 0.004, spot[1], spot[2] + out[1] * 0.004), out, unit * 0.2, 0.18, c["pillarRed"])


def brackets(parts, s):
    c = s.c

    def block(part, x, z):
        part.box((x, s.beam_top + 0.1, z), (0.48, 0.2, 0.48), c["dancheongBlue"], skip=("-y",))

    def arms(part, x, z, out):
        for lift, length, thick, shift, tone in ((0.3, 0.84, 0.28, 0.39, c["dancheongGreen"]), (0.49, 1.26, 0.36, 0.6, c["pillarRed"])):
            sx, sz = (length, thick) if out[0] else (thick, length)
            part.box((x + out[0] * shift, s.beam_top + lift, z + out[1] * shift), (sx, 0.2, sz), tone, skip=("-y",))

    for x, z, outs, name in s.columns():
        block(parts[name], x, z)
        for out in outs:
            arms(parts[name], x, z, out)
    for _, out, stations, owner in s.sides():
        for a, b in zip(stations, stations[1:]):
            mid = (a + b) / 2
            if out[1]:
                x, z = mid, (s.z1 if out[1] > 0 else s.z0)
            else:
                x, z = out[0] * s.hx, mid
            block(parts[owner], x, z)
            arms(parts[owner], x, z, out)


def above(point):
    return Vector((point.x, point.y + 10.0, point.z))


def below(point):
    return Vector((point.x, point.y - 10.0, point.z))


def roof(part, s):
    c = s.c
    x_low, x_high = -s.length, s.length
    steps = [s.span * i / SLOPE_STEPS for i in range(SLOPE_STEPS + 1)]
    crest = 0.05
    ribs = round((x_high - x_low) / RIB)

    def top(sign, x, rib):
        return [Vector((x, s.roof(d, x) + (crest if rib else 0.0), s.cz + sign * d)) for d in steps]

    for sign in (1.0, -1.0):
        for k in range(ribs):
            x0 = x_low + (x_high - x_low) * k / ribs
            x1 = x_low + (x_high - x_low) * (k + 1) / ribs
            tone = 0.9 + 0.2 * hash01(k, sign, 0.0, 11.0)

            def tile(co, tone=tone):
                end = smoothstep(0.86, 0.96, abs(co.z - s.cz) / s.span)
                return scaled(mix(c["tileGray"], c["tileEdge"], 0.8 * end), tone)

            part.ribbon(top(sign, x0, k % 2 == 0), top(sign, x1, (k + 1) % 2 == 0), tile, toward=above)

    underside = [s.hz + s.eave * i / 2 for i in range(3)]
    rafters = 21
    for sign in (1.0, -1.0):
        for k in range(rafters):
            x0 = -s.hx + 2.0 * s.hx * k / rafters
            x1 = -s.hx + 2.0 * s.hx * (k + 1) / rafters
            tone = c["dancheongGreen"] if k % 2 == 0 else c["pillarRed"]
            left = [Vector((x0, s.roof(d, x0) - ROOF_THICK, s.cz + sign * d)) for d in underside]
            right = [Vector((x1, s.roof(d, x1) - ROOF_THICK, s.cz + sign * d)) for d in underside]
            part.ribbon(left, right, scaled(tone, 0.85), toward=below)

    zs = [-s.span + 2.0 * s.span * i / 20 for i in range(21)]
    for x_end, x_wall, out in ((x_low, -s.hx, -1.0), (x_high, s.hx, 1.0)):
        outer = [Vector((x_end, s.roof(abs(z), x_end) - ROOF_THICK, s.cz + z)) for z in zs]
        inner_line = [Vector((x_wall, s.roof(abs(z), x_wall) - ROOF_THICK, s.cz + z)) for z in zs]
        part.ribbon(outer, inner_line, scaled(c["woodDark"], 1.1), toward=below)

        edge = [Vector((x_end, s.roof(abs(z), x_end) + 0.03, s.cz + z)) for z in zs]
        lower = [Vector((p.x, p.y - FASCIA, p.z)) for p in edge]
        part.ribbon(edge, lower, c["pillarRed"], toward=lambda p, out=out: Vector((p.x + out * 10.0, p.y, p.z)))

        gable_x = x_wall - out * 0.1
        zg = [-s.hz + 2.0 * s.hz * i / 16 for i in range(17)]
        bottom = [Vector((gable_x, s.beam_top, s.cz + z)) for z in zg]
        ceiling = [Vector((gable_x, s.roof(abs(z), gable_x) - ROOF_THICK + 0.04, s.cz + z)) for z in zg]
        part.ribbon(
            bottom,
            ceiling,
            lambda co: scaled(c["wallPlaster"], 0.7 + 0.2 * hash01(math.floor(co.z * 2.0), 0.0, 0.0, 5.0)),
            toward=lambda p, out=out: Vector((p.x + out * 10.0, p.y, p.z)),
        )

        for offset in (-7.5, -5.0, -2.5, 0.0, 2.5, 5.0, 7.5):
            y = s.roof(abs(offset), x_end) - ROOF_THICK - 0.14
            part.tube([(x_wall, y, s.cz + offset), (x_end, y, s.cz + offset)], [0.13, 0.13], 6, c["dancheongGreen"])

    xs = [x_low + (x_high - x_low) * i / 32 for i in range(33)]
    for sign in (1.0, -1.0):
        edge = [Vector((x, s.roof(s.span, x) + 0.03, s.cz + sign * s.span)) for x in xs]
        lower = [Vector((p.x, p.y - FASCIA, p.z)) for p in edge]
        part.ribbon(edge, lower, c["pillarRed"], toward=lambda p, sign=sign: Vector((p.x, p.y, p.z + sign * 10.0)))

    ridge = [x_low + 0.1 + (x_high - x_low - 0.2) * i / 20 for i in range(21)]
    part.tube([(x, s.roof(0.0, x) + 0.14, s.cz) for x in ridge], [0.26] * len(ridge), 6, scaled(c["tileGray"], 0.8), flat=0.9)
    for x, out in ((x_low + 0.3, -1.0), (x_high - 0.3, 1.0)):
        top_y = s.roof(0.0, x) + 0.14
        part.box((x, top_y + 0.5, s.cz), (0.36, 1.0, 0.36), c["tileEdge"])
        part.box((x + out * 0.14, top_y + 1.05, s.cz), (0.64, 0.24, 0.36), c["tileEdge"])


def build(plan):
    """The four Parts, named for the meshes they become."""
    s = Shape(plan)
    frame = GAME @ at(plan.origin["x"], 0.0, plan.origin["z"])
    parts = {
        "base": Part("dharmaBase", frame=frame),
        "walls": Part("dharmaWalls", frame=frame),
        "front": Part("dharmaFront", frame=frame),
        "roof": Part("dharmaRoof", frame=frame),
    }
    plinth(parts["base"], s)
    column_bases(parts["base"], s)
    columns(parts, s)
    walls(parts, s)
    windows(parts, s)
    beams(parts, s)
    brackets(parts, s)
    roof(parts["roof"], s)
    return parts
