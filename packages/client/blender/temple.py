"""The temple's outside, west of the plaza, and its door.

A small Korean temple building seen from the plaza: a granite base, red columns, plaster walls, painted
beams with stacked brackets under a tiled gable roof whose slope is concave and whose eaves turn up.
The long front faces the plaza (+X) and holds a four-leaf lattice door, which is its own mesh so the
game can find it and let a tap on it open the inside. Drawn in the game's coordinates through
Parts whose frame is GAME; the footprint, the door and the heights all come from the inputs.
"""

import math

from mathutils import Vector

from common import GAME, Part, hash01, hidden, mix, scaled, smoothstep, spun

UP = Vector((0.0, 1.0, 0.0))
PLINTH = 0.16  # stone drum under each column
BEAM_DEPTH = 0.36
BEAM_HEIGHT = 0.45
EAVE_LIFT = 0.45  # the eaves' edge stands this far above the beams
ROOF_THICK = 0.28  # tile to underside
FASCIA = 0.26
WALL = 0.16
RIBS = 40  # tile ribs across the roof's length
SLOPE_STEPS = 10
FRIEZE_TOP = 4.5
TREAD = 0.3


class Shape:
    """Where everything stands, from the layout in the inputs."""

    def __init__(self, plan):
        t = plan.temple
        self.t = t
        self.c = plan.c
        self.wx0, self.wx1 = t["minX"] + t["eave"], t["maxX"] - t["eave"]
        self.wz0, self.wz1 = t["minZ"] + t["eave"], t["maxZ"] - t["eave"]
        self.cx = (t["minX"] + t["maxX"]) / 2
        self.cz = (t["minZ"] + t["maxZ"]) / 2
        self.span = (t["maxX"] - t["minX"]) / 2
        self.length = (t["maxZ"] - t["minZ"]) / 2
        self.floor = t["baseHeight"]
        self.beam_top = self.floor + t["columnHeight"]
        self.eave = self.beam_top + EAVE_LIFT
        self.door_lo = t["doorZ"] - t["doorWidth"] / 2
        self.door_hi = t["doorZ"] + t["doorWidth"] / 2
        self.wall_top = self.beam_top - BEAM_HEIGHT + 0.05

    def roof(self, s, z):
        """Height of the tile surface `s` metres from the ridge, at `z`: concave, with the eaves and the gable ends curling up."""
        r = max(0.0, 1.0 - s / self.span)
        curl = 0.16 * smoothstep(0.72, 1.0, s / self.span)
        end = 0.14 * smoothstep(0.55, 1.0, abs(z - self.cz) / self.length)
        return self.eave + self.t["rise"] * r**1.45 + curl + end

    def columns(self):
        """(x, z, outward directions) of the ten columns."""
        spots = []
        for x, out in ((self.wx1, (1.0, 0.0)), (self.wx0, (-1.0, 0.0))):
            for z in (self.wz0, self.door_lo, self.door_hi, self.wz1):
                outs = [out]
                if z == self.wz0:
                    outs.append((0.0, -1.0))
                if z == self.wz1:
                    outs.append((0.0, 1.0))
                spots.append((x, z, outs))
        spots.append((self.cx, self.wz0, [(0.0, -1.0)]))
        spots.append((self.cx, self.wz1, [(0.0, 1.0)]))
        return spots


def face(part, centre, out, width, height, color):
    """A quad standing upright at `centre`, looking along the horizontal direction `out`."""
    toward = Vector((out[0], 0.0, out[1]))
    across = UP.cross(toward)
    corner = Vector(centre) - across * (width / 2) - UP * (height / 2)
    part.grid(corner, across * width, UP * height, 1, 1, color)


def stylobate(part, s):
    c = s.c
    x0, x1, z0, z1 = s.wx0 - 0.75, s.wx1 + 0.75, s.wz0 - 0.75, s.wz1 + 0.75

    def stone(co):
        grain = hash01(math.floor(co.x * 2.0), 0.0, math.floor(co.z * 2.0), 6.0)
        return scaled(mix(c["graniteShade"], c["granite"], 0.55 + 0.3 * grain), 0.95)

    part.box(((x0 + x1) / 2, (s.floor - 0.1) / 2, (z0 + z1) / 2), (x1 - x0, s.floor + 0.1, z1 - z0), stone, skip=("-y",), cuts=(8, 1, 10))
    width = s.t["doorWidth"] + 0.8
    for k, top in enumerate((0.3, 0.15)):
        near = x1 + TREAD * k
        part.box((near + TREAD / 2, (top - 0.1) / 2, s.t["doorZ"]), (TREAD, top + 0.1, width), stone, skip=("-y", "-x"))


def columns(part, s):
    c = s.c
    for x, z, _ in s.columns():
        with part.placed(spun(x, s.floor, z)):
            part.lathe(((0.27, 0.0), (0.27, PLINTH), (0.19, PLINTH + 0.01)), 8, scaled(mix(c["graniteShade"], c["granite"], 0.6), 0.95), smooth=False)
        with part.placed(spun(x, s.floor + PLINTH + 0.01, z)):
            part.lathe(
                ((0.165, 0.0), (0.19, 0.8), (0.18, 1.7), (0.16, s.beam_top - 0.05 - s.floor - PLINTH - 0.01)),
                8,
                lambda co: scaled(c["pillarRed"], 0.88 + 0.14 * smoothstep(0.0, 2.8, co.z)),
            )


def walls(part, s):
    c = s.c
    height = s.wall_top - s.floor
    middle = (s.wall_top + s.floor) / 2

    def plaster(co):
        return scaled(c["wallPlaster"], 0.86 + 0.14 * smoothstep(s.floor, s.floor + 1.6, co.y))

    side = s.wz1 - s.wz0
    part.box((s.wx0 + WALL * 0.75, middle, s.cz), (WALL, height, side), plaster, skip=hidden("-x"), cuts=(1, 3, 3))
    for z, shown in ((s.wz0 + WALL * 0.75, "-z"), (s.wz1 - WALL * 0.75, "+z")):
        part.box((s.cx, middle, z), (s.wx1 - s.wx0, height, WALL), plaster, skip=hidden(shown), cuts=(3, 3, 1))
    x_face = s.wx1 - WALL * 0.75 + WALL / 2
    for lo, hi in ((s.wz0, s.door_lo), (s.door_hi, s.wz1)):
        centre = (lo + hi) / 2
        part.box((s.wx1 - WALL * 0.75, middle, centre), (WALL, height, hi - lo), plaster, skip=hidden("+x"), cuts=(1, 3, 2))
        window(part, s, x_face, centre)
    for x, out, shown in ((s.wx1 - 0.1, 1.0, "+x"), (s.wx0 + 0.1, -1.0, "-x")):
        part.box(
            (x, (s.beam_top + FRIEZE_TOP) / 2, s.cz),
            (0.12, FRIEZE_TOP - s.beam_top, side),
            scaled(c["wallPlaster"], 0.8),
            skip=hidden(shown),
        )


def window(part, s, x_face, centre):
    """A lattice window in a plaster bay: a frame, a paper pane and a few bars."""
    c = s.c
    width, low, high = 1.0, 1.35, 2.75
    middle = (low + high) / 2
    bar = 0.07
    out = (1.0, 0.0)
    for y, z, size in (
        (low, centre, (0.06, bar, width)),
        (high, centre, (0.06, bar, width)),
        (middle, centre - width / 2 + bar / 2, (0.06, high - low, bar)),
        (middle, centre + width / 2 - bar / 2, (0.06, high - low, bar)),
    ):
        part.box((x_face, y, z), size, c["woodDark"], skip=("-x",))
    face(part, (x_face + 0.006, middle, centre), out, width - bar, high - low - bar, c["paper"])
    for k in (-1, 0, 1):
        face(part, (x_face + 0.016, middle, centre + k * (width - bar) / 4), out, 0.025, high - low - bar, c["woodMid"])
    for k in (-0.34, 0.34):
        face(part, (x_face + 0.016, middle + k * (high - low), centre), out, width - bar, 0.025, c["woodMid"])


def beams(part, s):
    c = s.c
    y = s.beam_top - BEAM_HEIGHT / 2
    runs = (
        ((s.wx1, s.wz0), (s.wx1, s.wz1), (1.0, 0.0)),
        ((s.wx0, s.wz0), (s.wx0, s.wz1), (-1.0, 0.0)),
        ((s.wx0, s.wz0), (s.wx1, s.wz0), (0.0, -1.0)),
        ((s.wx0, s.wz1), (s.wx1, s.wz1), (0.0, 1.0)),
    )
    for a, b, out in runs:
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        size = (BEAM_DEPTH, BEAM_HEIGHT, length + BEAM_DEPTH) if out[0] else (length + BEAM_DEPTH, BEAM_HEIGHT, BEAM_DEPTH)
        part.box(((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2), size, c["dancheongGreen"], skip=("-y", "+y"))
        units = max(1, round(length / 0.62))
        unit = length / units
        for i in range(units):
            t = (i + 0.5) / units
            spot = (a[0] + (b[0] - a[0]) * t + out[0] * (BEAM_DEPTH / 2 + 0.004), y, a[1] + (b[1] - a[1]) * t + out[1] * (BEAM_DEPTH / 2 + 0.004))
            face(part, spot, out, unit * 0.62, 0.3, c["dancheongBlue"])
            face(part, (spot[0] + out[0] * 0.004, spot[1], spot[2] + out[1] * 0.004), out, unit * 0.2, 0.14, c["pillarRed"])


def brackets(part, s):
    c = s.c

    def block(x, z):
        part.box((x, s.beam_top + 0.07, z), (0.34, 0.14, 0.34), c["dancheongBlue"], skip=("-y",))

    def arms(x, z, out):
        for lift, length, thick, shift, tone in ((0.21, 0.6, 0.2, 0.28, c["dancheongGreen"]), (0.35, 0.9, 0.26, 0.43, c["pillarRed"])):
            sx, sz = (length, thick) if out[0] else (thick, length)
            part.box((x + out[0] * shift, s.beam_top + lift, z + out[1] * shift), (sx, 0.14, sz), tone, skip=("-y",))

    for x, z, outs in s.columns():
        block(x, z)
        for out in outs:
            arms(x, z, out)
    for lo, hi in ((s.wz0, s.door_lo), (s.door_lo, s.door_hi), (s.door_hi, s.wz1)):
        block(s.wx1, (lo + hi) / 2)
        arms(s.wx1, (lo + hi) / 2, (1.0, 0.0))


def above(point):
    return Vector((point.x, point.y + 10.0, point.z))


def below(point):
    return Vector((point.x, point.y - 10.0, point.z))


def roof(part, s):
    c = s.c
    z_low, z_high = s.cz - s.length, s.cz + s.length
    steps = [s.span * i / SLOPE_STEPS for i in range(SLOPE_STEPS + 1)]
    crest = 0.05

    def top(sign, z, rib):
        return [Vector((s.cx + sign * d, s.roof(d, z) + (crest if rib else 0.0), z)) for d in steps]

    for sign in (1.0, -1.0):
        for k in range(RIBS):
            z0 = z_low + (z_high - z_low) * k / RIBS
            z1 = z_low + (z_high - z_low) * (k + 1) / RIBS
            tone = 0.9 + 0.2 * hash01(k, sign, 0.0, 11.0)

            def tile(co, tone=tone):
                end = smoothstep(0.86, 0.96, abs(co.x - s.cx) / s.span)
                return scaled(mix(c["tileGray"], c["tileEdge"], 0.8 * end), tone)

            part.ribbon(top(sign, z0, k % 2 == 0), top(sign, z1, (k + 1) % 2 == 0), tile, toward=above)

    inner = s.span - s.t["eave"]
    underside = [inner + (s.span - inner) * i / 2 for i in range(3)]
    rafters = 15
    for sign in (1.0, -1.0):
        for k in range(rafters):
            z0 = s.wz0 + (s.wz1 - s.wz0) * k / rafters
            z1 = s.wz0 + (s.wz1 - s.wz0) * (k + 1) / rafters
            tone = c["dancheongGreen"] if k % 2 == 0 else c["pillarRed"]
            left = [Vector((s.cx + sign * d, s.roof(d, z0) - ROOF_THICK, z0)) for d in underside]
            right = [Vector((s.cx + sign * d, s.roof(d, z1) - ROOF_THICK, z1)) for d in underside]
            part.ribbon(left, right, scaled(tone, 0.85), toward=below)

    xs = [s.cx - s.span + 2.0 * s.span * i / 20 for i in range(21)]
    for z_end, z_wall, out in ((z_low, s.wz0, -1.0), (z_high, s.wz1, 1.0)):
        outer = [Vector((x, s.roof(abs(x - s.cx), z_end) - ROOF_THICK, z_end)) for x in xs]
        inner_line = [Vector((x, s.roof(abs(x - s.cx), z_wall) - ROOF_THICK, z_wall)) for x in xs]
        part.ribbon(outer, inner_line, scaled(c["woodDark"], 1.1), toward=below)

        edge = [Vector((x, s.roof(abs(x - s.cx), z_end) + 0.03, z_end)) for x in xs]
        lower = [Vector((p.x, p.y - FASCIA, p.z)) for p in edge]
        part.ribbon(edge, lower, c["pillarRed"], toward=lambda p, out=out: Vector((p.x, p.y, p.z + out * 10.0)))

        gable_z = z_wall - out * WALL * 0.25
        gx = [s.wx0 + (s.wx1 - s.wx0) * i / 12 for i in range(13)]
        bottom = [Vector((x, s.beam_top, gable_z)) for x in gx]
        ceiling = [Vector((x, s.roof(abs(x - s.cx), gable_z) - ROOF_THICK + 0.04, gable_z)) for x in gx]
        part.ribbon(bottom, ceiling, lambda co: scaled(c["woodMid"], 0.85 + 0.25 * hash01(math.floor(co.x * 6.0), 0.0, 0.0, 5.0)), toward=lambda p, out=out: Vector((p.x, p.y, p.z + out * 10.0)))

        for offset in (-2.4, -1.2, 0.0, 1.2, 2.4):
            x = s.cx + offset
            y = s.roof(abs(offset), z_end) - ROOF_THICK - 0.1
            part.tube([(x, y, z_wall), (x, y, z_end)], [0.1, 0.1], 6, c["dancheongGreen"])

    for sign in (1.0, -1.0):
        zs = [z_low + (z_high - z_low) * i / 14 for i in range(15)]
        edge = [Vector((s.cx + sign * s.span, s.roof(s.span, z) + 0.03, z)) for z in zs]
        lower = [Vector((p.x, p.y - FASCIA, p.z)) for p in edge]
        part.ribbon(edge, lower, c["pillarRed"], toward=lambda p, sign=sign: Vector((p.x + sign * 10.0, p.y, p.z)))

    zs = [z_low + 0.1 + (z_high - z_low - 0.2) * i / 12 for i in range(13)]
    part.tube([(s.cx, s.roof(0.0, z) + 0.12, z) for z in zs], [0.2] * len(zs), 6, scaled(c["tileGray"], 0.8), flat=0.9)
    for z, out in ((z_low + 0.25, -1.0), (z_high - 0.25, 1.0)):
        top_y = s.roof(0.0, z) + 0.12
        part.box((s.cx, top_y + 0.4, z), (0.3, 0.8, 0.3), c["tileEdge"])
        part.box((s.cx, top_y + 0.82, z + out * 0.12), (0.3, 0.2, 0.55), c["tileEdge"])


def building(plan):
    s = Shape(plan)
    part = Part("temple", frame=GAME)
    stylobate(part, s)
    columns(part, s)
    walls(part, s)
    beams(part, s)
    brackets(part, s)
    roof(part, s)
    return part


def door(plan):
    """Four lattice leaves, red frames, cream paper, and the dark jambs round them."""
    s = Shape(plan)
    c = s.c
    part = Part("templeDoor", frame=GAME)
    x = s.wx1 - 0.1
    low = s.floor
    high = low + s.t["doorHeight"]
    leaf = s.t["doorWidth"] / 4
    out = (1.0, 0.0)
    thick = 0.06
    stile, rail = 0.07, 0.1
    panel_top = low + 0.85
    lattice_low, lattice_high = panel_top, high - rail
    face(part, (x - 0.07, (low + high) / 2, s.t["doorZ"]), out, s.t["doorWidth"], high - low, scaled(c["woodDark"], 0.5))
    jamb = 0.12
    for z in (s.door_lo - jamb / 2, s.door_hi + jamb / 2):
        part.box((x, (low + high) / 2, z), (0.14, high - low, jamb), c["woodDark"], skip=("-x", "-y", "+y"))
    part.box((x, high + 0.025, s.t["doorZ"]), (0.14, 0.05 + 0.002, s.t["doorWidth"] + 2 * jamb), c["woodDark"], skip=("-x", "-y", "+y"))
    for i in range(4):
        z0 = s.door_lo + leaf * i
        zc = z0 + leaf / 2
        width = leaf - 0.01
        for z in (z0 + stile / 2 + 0.005, z0 + leaf - stile / 2 - 0.005):
            part.box((x, (low + high) / 2, z), (thick, high - low, stile), c["pillarRed"], skip=("-x", "-y", "+y"))
        for y0, y1 in ((low, low + rail), (panel_top - rail, panel_top), (lattice_high, high)):
            part.box((x, (y0 + y1) / 2, zc), (thick, y1 - y0, width - 2 * stile), c["pillarRed"], skip=("-x", "-z", "+z"))
        face(part, (x + 0.01, (low + rail + panel_top - rail) / 2, zc), out, width - 2 * stile, panel_top - low - 2 * rail, scaled(c["woodMid"], 0.9))
        face(part, (x - 0.02, (lattice_low + lattice_high) / 2, zc), out, width - 2 * stile, lattice_high - lattice_low, c["paper"])
        bars = 7
        for k in range(bars):
            bz = z0 + stile + (leaf - 2 * stile) * (k + 0.5) / bars
            face(part, (x + 0.03, (lattice_low + lattice_high) / 2, bz), out, 0.022, lattice_high - lattice_low, c["woodMid"])
        for k in range(1, 5):
            by = lattice_low + (lattice_high - lattice_low) * k / 5
            face(part, (x + 0.032, by, zc), out, width - 2 * stile, 0.022, c["woodMid"])
    for z in (s.t["doorZ"] - 0.07, s.t["doorZ"] + 0.07):
        part.box((x + 0.05, (low + high) / 2 - 0.1, z), (0.04, 0.16, 0.04), c["sash"])
    return part
