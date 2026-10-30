"""dharma.glb: the 법당's inside, the lotus, halo and glow of its Buddha, and one seat to instance. The front wall has an open doorway.

Everything is drawn in the game's own coordinates through Parts whose frame is GAME. A wall's fittings
are drawn in the wall's own frame (x along the wall, y up, z into the room) inside `part.placed(...)`.
Walls, beams and pillars are subdivided so the baked occlusion has vertices to land on, and faces
nobody can see are never built. The Buddha is buddha.glb, which the game puts on the altar at BUDDHA_AT: the lotus
under him, the halo and glow behind him and the mural's disc are placed from where buddha.py found his head.
"""

import math
import os

from mathutils import Matrix, Vector

import common
from common import GAME, Part, at, cells, hash01, hidden, mix, rgb, scaled, smooth_profile, smoothstep, spun, turned, wall_openings, wall_pieces

STEP = 0.75
CLOUDS = (  # x, base height, width, height, lobes and colour of the banks drifting each side of the Buddha
    (3.8, 1.4, 3.0, 0.5, 5, "dancheongBlue"),
    (6.9, 1.4, 2.8, 0.5, 5, "dancheongGreen"),
    (6.2, 2.1, 2.2, 0.42, 4, "dancheongYellow"),
    (4.9, 3.05, 2.0, 0.4, 4, "dancheongRed"),
    (7.8, 2.9, 1.8, 0.4, 3, "dancheongBlue"),
)
MUSICIANS = (  # x, height, robe and sash colours, and what each of the two sides plays
    (4.6, 3.4, "dancheongBlue", "dancheongYellow", ("flute", "drum")),
    (6.3, 2.55, "dancheongGreen", "petal", ("lute", "flute")),
    (7.5, 3.35, "pillarRed", "buddhaGoldPale", ("cymbals", "lute")),
)
BEAM_BAND = 0.8  # height of the painted beam under the frieze
BEAM_DEPTH = 0.36
FLOOR_PLANK = 0.5
SQUASH = 0.78  # the lotus is shallower than it is wide
LOTUS_FOOT, LOTUS_TOP = -0.45, -0.12  # the lotus is drawn from its foot to its flat top between these heights
DRAWN_FOR = 2.75  # the halo and glow are drawn for a Buddha this tall; they are scaled to the one in the game
HALO_BEHIND = 0.5  # how far behind the statue's middle the halo's plane stands
GLOW_BEHIND = 0.57
GLOW_RADIUS = 2.3


class Plan:
    """What the room follows from the game, with the palette already in linear colour."""

    def __init__(self, inputs, head):
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
        height = d["BUDDHA_HEIGHT"]
        top = head["headTop"]
        # The middle of his head, in the game: the crown less a head's radius.
        self.head = (
            self.buddha_at[0] + top[0] * height,
            self.buddha_at[1] + (top[1] - head["headRadius"]) * height,
            self.buddha_at[2] + top[2] * height,
        )
        self.fit = height / DRAWN_FOR
        # The lotus is scaled so that its flat top stands LOTUS_EMBED above the statue's base, with its foot on the altar.
        self.lotus_scale = (self.buddha_at[1] - d["ALTAR"]["topY"] + d["LOTUS_EMBED"]) / (LOTUS_TOP - LOTUS_FOOT)
        self.door = d["DHARMA_DOOR"]
        self.openings, self.band = wall_openings(inputs)
        self.candles = d["CANDLE_SPOTS"]
        self.lanterns = d["lanterns"]
        self.seat = d["DHARMA_SEAT_SIZE"]
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        self.side_z = [self.back + self.inset, *d["SIDE_PILLARS_Z"], self.front - self.inset]
        self.front_x = [-(self.half - self.inset), *d["FRONT_PILLARS_X"], self.half - self.inset]
        self.pillar_x = self.half - self.inset

    def walls(self):
        """(placement, length, pillars along it, windows along it) of the four walls, in each wall's own x."""
        side_length = (self.front - self.back) - 2.0 * BEAM_DEPTH
        o = self.openings
        yield at(-self.half, 0.0, 0.0) @ turned(math.pi / 2), side_length, self.side_z, [(-x, w) for x, w in o["west"]]
        yield at(self.half, 0.0, 0.0) @ turned(-math.pi / 2), side_length, self.side_z, o["east"]
        yield at(0.0, 0.0, self.front) @ turned(math.pi), 2.0 * self.half, self.front_x[1:-1], [(-x, w) for x, w in o["front"]]
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
    width = 2.0 * plan.half

    def panel(corner, across, along):
        columns = max(1, round(Vector(across).length / STEP))
        rows = max(1, round(Vector(along).length / STEP))
        part.grid(corner, across, along, columns, rows, tone)

    # The windows are holes in the panels: the shell's plaster behind them has the same holes, so the view goes through.
    for a0, a1, y0, y1, _ in wall_pieces(plan.back, plan.front, 0.0, h, plan.openings["west"], plan.band):
        panel((-plan.half, y0, a0), (0.0, y1 - y0, 0.0), (0.0, 0.0, a1 - a0))
    for a0, a1, y0, y1, _ in wall_pieces(plan.back, plan.front, 0.0, h, plan.openings["east"], plan.band):
        panel((plan.half, y0, a0), (0.0, 0.0, a1 - a0), (0.0, y1 - y0, 0.0))
    # The front wall stands round the doorway, which has no door in it: visitors walk in from the court.
    opening, high = plan.door["halfWidth"], plan.door["height"]
    for x0, x1 in ((-plan.half, -opening), (opening, plan.half)):
        run = [(along, wide) for along, wide in plan.openings["front"] if x0 < along < x1]
        for a0, a1, y0, y1, _ in wall_pieces(x0, x1, 0.0, h, run, plan.band):
            panel((a0, y0, plan.front), (0.0, y1 - y0, 0.0), (a1 - a0, 0.0, 0.0))
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
    """A lattice window over an opening in the wall: a frame, a few bars and a sill, and nothing in the way of the view."""
    c = plan.c
    low, high = plan.band
    height = high - low
    middle = (low + high) / 2
    bar = 0.08
    wood = c["woodDark"]
    for y in (low, high):
        part.box((x, y, 0.07), (width, bar, 0.1), wood, skip=hidden("+z", "-y", "+y"))
    for side in (-1.0, 1.0):
        part.box((x + side * (width / 2 - bar / 2), middle, 0.07), (bar, height, 0.1), wood, skip=hidden("+z", "-x" if side > 0 else "+x"))
    part.box((x, low - 0.07, 0.14), (width + 0.16, 0.08, 0.3), c["woodMid"], skip=("-y",))
    columns, rows = max(3, round(width / 0.36)), 7
    for i in range(1, columns):
        quad(part, (x - width / 2 + width * i / columns, middle, 0.058), 0.028, height - bar, c["woodMid"])
    for k in range(1, rows):
        quad(part, (x, low + height * k / rows, 0.062), width - bar, 0.028, c["woodMid"])


def wall_fittings(part, plan, placement, length, along, windows):
    with part.placed(placement):
        beam_band(part, plan, length)
        brackets(part, plan, along)
        for x, width in windows:
            window(part, plan, x, width)


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
    for placement, length, along, windows in plan.walls():
        wall_fittings(part, plan, placement, length, along, windows)
    altar(part, plan)
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


LAYER = 0.0016  # how far a painted layer of the mural stands in front of the one under it


class Brush:
    """Flat colour laid on the mural's plane; a higher layer is painted over a lower one."""

    def __init__(self, part, z):
        self.part, self.z = part, z

    def fill(self, points, color, layer):
        """A flat polygon, wound to face the viewer whichever way round `points` runs."""
        turn = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, [*points[1:], points[0]]))
        ordered = points if turn > 0.0 else points[::-1]
        self.part.polygon([(x, y, self.z + LAYER * layer) for x, y in ordered], color)

    def glow(self, points, middle, edge, layer):
        """A polygon whose colour fades from `middle` (its centre) to `edge` (its rim)."""
        z = self.z + LAYER * layer
        x = sum(p[0] for p in points) / len(points)
        y = sum(p[1] for p in points) / len(points)
        self.part.fan((x, y, z), [(px, py, z) for px, py in points], middle, edge)

    def stroke(self, points, width, color, layer, closed=False):
        """A line along `points`; `width` is a number, or a function of the distance 0..1 along it."""
        line = [*points, points[0]] if closed else list(points)
        last = len(line) - 1
        z = self.z + LAYER * layer
        left, right = [], []
        for i, (x, y) in enumerate(line):
            before = line[i - 1 if i else (last - 1 if closed else 0)]
            after = line[i + 1 if i < last else (1 if closed else last)]
            dx, dy = after[0] - before[0], after[1] - before[1]
            half = (width(i / last) if callable(width) else width) / (2.0 * (math.hypot(dx, dy) or 1.0))
            left.append((x - dy * half, y + dx * half, z))
            right.append((x + dy * half, y - dx * half, z))
        self.part.ribbon(left, right, color)


def taper(width, floor=0.008):
    """A stroke width that narrows from `width` to `floor` along the line."""
    return lambda t: floor + (width - floor) * (1.0 - t) ** 0.8


def ellipse(x, y, rx, ry, steps=10, turn=0.0):
    """Points round an ellipse, counter-clockwise."""
    return [(x + rx * math.cos(turn + math.tau * i / steps), y + ry * math.sin(turn + math.tau * i / steps)) for i in range(steps)]


def arcs(x, y, radius, steps, ymin, ymax):
    """The parts of a circle that stay between ymin and ymax, as separate polylines."""
    runs, run = [], []
    for i in range(steps + 1):
        a = math.tau * i / steps
        point = (x + radius * math.cos(a), y + radius * math.sin(a))
        if ymin <= point[1] <= ymax:
            run.append(point)
        elif run:
            runs.append(run)
            run = []
    return [*runs, run] if run else runs


def aura(brush, c, centre, ymin, ymax):
    """The Buddha's aura: a pale disc ringed in gold, with rays alternately long gold and short pale."""
    x, y = centre
    clamp = lambda p: (p[0], min(ymax, max(ymin, p[1])))
    brush.glow([clamp(p) for p in ellipse(x, y, 2.2, 2.2, 40)], scaled(c["muralHalo"], 0.75), mix(scaled(c["muralHalo"], 0.55), c["buddhaGold"], 0.6), 1)
    for radius, width, color in ((1.9, 0.035, c["buddhaGoldDeep"]), (2.2, 0.05, c["muralLine"])):
        for run in arcs(x, y, radius, 48, ymin, ymax):
            brush.stroke(run, width, color, 2)
    rays = 32
    for i in range(rays):
        a = math.tau * (i + 0.5) / rays
        dx, dy = math.cos(a), math.sin(a)
        length = 0.75 if i % 2 == 0 else 0.45
        root = 2.25 * dy + y
        length = min(length, (ymax - root) / dy if dy > 0 else length, (ymin - root) / dy if dy < 0 else length)
        if length < 0.2:
            continue
        base = (x + 2.25 * dx, root)
        side = 0.06 if i % 2 == 0 else 0.045
        brush.fill(
            [(base[0] + dy * side, base[1] - dx * side), (base[0] + dx * length, base[1] + dy * length), (base[0] - dy * side, base[1] + dx * side)],
            c["muralLine"] if i % 2 == 0 else scaled(c["muralHalo"], 0.8),
            1,
        )


def scaled_about(points, x, y, sx, sy):
    return [(x + (px - x) * sx, y + (py - y) * sy) for px, py in points]


def cloud_outline(x, y, width, height, lobes, seed, arc=5):
    """A cloud with a flat base under a row of round lobes, running counter-clockwise from the base's left end."""
    pitch, notch = width / lobes, 0.3 * height
    points = [(x - width / 2.0, y), (x + width / 2.0, y)]
    for i in reversed(range(lobes)):
        centre = x - width / 2.0 + pitch * (i + 0.5)
        rise = height * (0.75 + 0.25 * math.sin(math.pi * (i + 0.5) / lobes)) * (0.85 + 0.3 * hash01(i, seed, 0.0))
        for k in range(0 if i == lobes - 1 else 1, arc):
            a = math.pi * k / (arc - 1)
            points.append((centre + pitch / 2.0 * math.cos(a), y + notch + (rise - notch) * math.sin(a)))
    return points


def curl(x, y, radius, side):
    """A spiral that leaves (x, y) and winds in on itself, to the right for side 1 and to the left for -1."""
    points = []
    for i in range(8):
        t = i / 7.0
        a = -math.pi / 2.0 + side * 1.6 * math.pi * t
        r = radius * (1.0 - 0.65 * t)
        points.append((x + r * math.cos(a), y + radius + r * math.sin(a)))
    return points


def cloud_bank(brush, c, x, y, width, height, lobes, seed, tone, layer):
    """A bank of cloud: gold rim, a coloured band, a pale body, and a curled ribbon at each end."""
    outline = cloud_outline(x, y, width, height, lobes, seed)
    pale = mix(scaled(c["muralHalo"], 0.85), tone, 0.25)
    brush.fill(scaled_about(outline, x, y + height * 0.4, 1.04, 1.07), c["muralLine"], layer)
    brush.fill(outline, tone, layer + 1)
    brush.fill(scaled_about(outline, x, y, 0.88, 0.7), pale, layer + 2)
    brush.stroke(curl(x + width / 2.0, y, height * 0.4, 1), taper(0.07), c["muralLine"], layer + 1)
    brush.stroke(curl(x - width / 2.0, y, height * 0.4, -1), taper(0.07), pale, layer + 1)


def skyline(x0, y0, x1, y1, steps, seed, jag):
    """A jagged ridge from (x0, y0) to (x1, y1) with a peak at every other step."""
    points = []
    for i in range(steps + 1):
        t = i / steps
        peak = jag * hash01(i, seed, 2.0) * (1.0 if i % 2 else 0.15) if 0 < i < steps else 0.0
        points.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t**0.75 + peak))
    return points


def crag(brush, c, base, ridge, tone, layer, lit=True):
    """A rock mass standing on y = base under a ridge line, with lit facets and a gold edge."""
    foot = [(ridge[-1][0], base)] + ([(ridge[0][0], base)] if ridge[0][1] > base else [])
    brush.fill([*ridge, *foot], tone, layer)
    if not lit:
        return
    for i in range(1, len(ridge) - 2, 2):
        (ax, ay), (bx, by) = ridge[i], ridge[i + 1]
        brush.fill([(ax, ay), (bx, by), ((ax + bx) / 2.0 + 0.15 * (ax - bx), max(base + 0.02, (ay + by) / 2.0 - 0.6))], scaled(tone, 1.7), layer + 1)
    brush.stroke(ridge, 0.04, c["muralLine"], layer + 2)


def peaks(brush, c, edge, base):
    """Vulture Peak: dark malachite crags at both ends of the mural and a low range along its foot."""
    green, blue = c["dancheongGreen"], c["dancheongBlue"]
    for side in (-1.0, 1.0):
        far = skyline(side * 5.4, base, side * edge, base + 1.5, 7, 3.0 + side, 0.25)
        crag(brush, c, base, far, scaled(mix(green, blue, 0.5), 0.4), 3, lit=False)
        near = skyline(side * 6.6, base, side * edge, base + 2.0, 8, 5.0 + side, 0.4)
        crag(brush, c, base, near, scaled(green, 0.5), 4)
    foot = skyline(-edge, base + 0.3, edge, base + 0.3, 26, 9.0, 0.35)
    crag(brush, c, base, foot, scaled(green, 0.42), 7)


def flow(x, y, dx, dy, length, wave, steps):
    """A wavy path leaving (x, y) along (dx, dy), swaying sideways by up to `wave`."""
    norm = math.hypot(dx, dy)
    ux, uy = dx / norm, dy / norm
    path = []
    for i in range(steps):
        t = i / (steps - 1)
        sway = wave * t * math.sin(math.tau * 1.1 * t)
        path.append((x + ux * length * t - uy * sway, y + uy * length * t + ux * sway))
    return path


class Figure:
    """Draws in a figure's own units: u forward (toward `face`, 1 or -1), v up, `scale` metres to the unit."""

    def __init__(self, brush, x, y, scale, face, tilt=0.0):
        self.brush, self.x, self.y, self.scale, self.face = brush, x, y, scale, face
        self.cos, self.sin = math.cos(tilt), math.sin(tilt)

    def at(self, points):
        return [
            (self.x + self.face * (u * self.cos - v * self.sin) * self.scale, self.y + (u * self.sin + v * self.cos) * self.scale)
            for u, v in points
        ]

    def fill(self, points, color, layer):
        self.brush.fill(self.at(points), color, layer)

    def stroke(self, points, width, color, layer, closed=False):
        size = (lambda t: width(t) * self.scale) if callable(width) else width * self.scale
        self.brush.stroke(self.at(points), size, color, layer, closed)

    def disc(self, u, v, radius, color, layer, steps=8):
        self.fill(ellipse(u, v, radius, radius, steps), color, layer)


def head(f, c, u, v, size, layer):
    """A face in three-quarter view with hair, an eye and lips."""
    f.fill(ellipse(u, v, size * 0.95, size, 8), c["skin"], layer)
    f.fill([(u + size * 1.02 * math.cos(a), v + size * 1.08 * math.sin(a)) for a in (0.35, 0.9, 1.57, 2.25, 2.8)], c["muralInk"], layer + 1)
    f.stroke([(u + size * 0.25, v - size * 0.05), (u + size * 0.7, v + size * 0.02)], size * 0.16, c["muralInk"], layer + 1)
    f.fill([(u + size * 0.3, v - size * 0.45), (u + size * 0.62, v - size * 0.4), (u + size * 0.42, v - size * 0.3)], c["petalDeep"], layer + 1)


def instrument(f, c, kind):
    """What a musician plays, held at the hands (0.33, 0.14)."""
    gold, ink = c["buddhaGold"], c["muralInk"]
    if kind == "flute":
        f.stroke([(0.3, 0.14), (0.8, 0.34)], 0.035, c["buddhaGoldDeep"], 17)
    elif kind == "lute":
        f.fill(ellipse(0.46, 0.04, 0.1, 0.14, 8, 0.4), gold, 17)
        f.stroke([(0.5, 0.15), (0.78, 0.45)], 0.03, ink, 18)
    elif kind == "cymbals":
        f.disc(0.3, 0.3, 0.075, gold, 16, 6)
        f.disc(0.43, 0.2, 0.075, c["buddhaGoldPale"], 16, 6)
    else:
        f.fill([(0.28, 0.24), (0.46, 0.24), (0.38, 0.14), (0.46, 0.04), (0.28, 0.04), (0.36, 0.14)], c["dancheongRed"], 17)
        f.stroke([(0.28, 0.24), (0.46, 0.24)], 0.03, gold, 18)


def musician(brush, c, x, y, scale, face, robe, sash, kind):
    """A heavenly musician (비천) in flight: robe, long trailing scarves, a headdress and an instrument."""
    f = Figure(brush, x, y, scale, face, 0.2)
    gold = c["muralLine"]
    light = scaled(c["muralHalo"], 0.8)
    f.stroke(flow(-0.15, 0.24, -1.0, 0.3, 1.2, 0.2, 9), taper(0.1), sash, 15)
    f.stroke(flow(-0.12, 0.08, -1.0, -0.4, 1.1, -0.18, 8), taper(0.09), light, 15)
    skirt = [(0.13, -0.02), (0.18, -0.28), (0.02, -0.5), (-0.25, -0.42), (-0.58, -0.3), (-0.35, -0.1), (-0.14, -0.02)]
    f.fill(skirt, sash, 13)
    f.stroke(skirt, 0.014, gold, 14, closed=True)
    f.fill([(-0.17, 0.27), (0.17, 0.27), (0.13, 0.0), (-0.13, 0.0)], robe, 14)
    f.fill([(-0.07, 0.27), (0.07, 0.27), (0.0, 0.12)], c["skin"], 15)
    f.stroke([(0.08, 0.22), (0.2, 0.16), (0.33, 0.14)], 0.08, c["skin"], 16)
    instrument(f, c, kind)
    head(f, c, 0.02, 0.42, 0.115, 17)
    f.fill([(-0.1, 0.52), (0.0, 0.7), (0.1, 0.52)], gold, 19)


def small_buddha(brush, c, x, y, size, tint):
    """A seated Buddha in a gold halo."""
    f = Figure(brush, x, y, size, 1)
    f.disc(0.0, 0.62, 0.27, c["buddhaGold"], 13, 8)
    f.disc(0.0, 0.62, 0.2, scaled(c["muralHalo"], 0.85), 14, 8)
    f.fill([(-0.36, 0.0), (0.36, 0.0), (0.16, 0.45), (-0.16, 0.45)], tint, 15)
    f.fill([(-0.4, 0.0), (0.4, 0.0), (0.32, 0.1), (-0.32, 0.1)], mix(tint, c["muralLine"], 0.4), 17)
    f.fill(ellipse(0.0, 0.58, 0.095, 0.1, 6), c["skin"], 17)
    f.fill(ellipse(0.0, 0.7, 0.04, 0.035, 4), c["muralInk"], 18)


def small_cloud(brush, c, x, y, width):
    """The small cloud a distant Buddha sits on."""
    outline = cloud_outline(x, y, width, width * 0.55, 3, x)
    brush.fill(scaled_about(outline, x, y + width * 0.1, 1.06, 1.1), c["muralLine"], 10)
    brush.fill(outline, mix(scaled(c["muralHalo"], 0.9), c["petal"], 0.35), 11)


def lion(f, c):
    """Munsu's lion in profile, green with a gold mane; returns the height of its back."""
    body, ink = scaled(c["dancheongGreen"], 1.5), c["muralInk"]
    for u, lean in ((0.4, 0.05), (0.2, 0.03), (-0.3, -0.02), (-0.5, -0.02)):
        f.stroke([(u, 0.5), (u + lean, 0.02)], 0.15, scaled(body, 0.75), 13)
    f.fill(ellipse(-0.05, 0.62, 0.62, 0.27, 10), body, 14)
    f.stroke(flow(-0.62, 0.66, -0.4, 1.0, 0.6, 0.14, 6), taper(0.1), c["buddhaGold"], 13)
    mane = [(0.52 + (0.46 if i % 2 else 0.33) * math.cos(math.tau * i / 12), 0.86 + (0.46 if i % 2 else 0.33) * math.sin(math.tau * i / 12)) for i in range(12)]
    f.fill(mane, c["buddhaGoldDeep"], 15)
    f.fill(ellipse(0.62, 0.8, 0.23, 0.21, 8), scaled(body, 1.15), 16)
    f.disc(0.7, 0.88, 0.04, scaled(c["muralHalo"], 0.9), 17, 5)
    f.disc(0.72, 0.88, 0.02, ink, 18, 4)
    f.fill([(0.82, 0.8), (0.86, 0.76), (0.79, 0.74)], ink, 17)
    f.fill([(0.72, 0.7), (0.84, 0.72), (0.82, 0.64), (0.72, 0.62)], c["dancheongRed"], 17)
    return 0.89


def elephant(f, c):
    """Bohyeon's white elephant in profile, in a red and gold howdah cloth; returns the height of its back."""
    ivory, gold = scaled(c["muralHalo"], 0.95), c["buddhaGold"]
    for u in (0.42, 0.18, -0.3, -0.52):
        f.stroke([(u, 0.5), (u, 0.02)], 0.2, scaled(ivory, 0.78), 13)
    f.stroke([(0.78, 0.7), (1.0, 0.5), (1.08, 0.28), (0.98, 0.1)], taper(0.2, 0.06), scaled(ivory, 0.85), 13)
    f.fill(ellipse(0.0, 0.66, 0.62, 0.38, 10), ivory, 14)
    f.fill([(-0.34, 0.98), (0.34, 0.98), (0.4, 0.62), (-0.4, 0.62)], c["dancheongRed"], 15)
    f.fill([(-0.4, 0.66), (0.4, 0.66), (0.4, 0.62), (-0.4, 0.62)], gold, 16)
    f.fill(ellipse(0.72, 0.8, 0.24, 0.27, 8), ivory, 15)
    f.fill(ellipse(0.52, 0.82, 0.14, 0.22, 6), c["petal"], 16)
    f.fill([(0.86, 0.62), (1.05, 0.46), (0.94, 0.7)], c["buddhaGoldPale"], 16)
    f.fill(ellipse(0.82, 0.88, 0.03, 0.03, 4), c["muralInk"], 17)
    return 1.0


def rider(f, c, seat, robe, scarf):
    """A bodhisattva seated on a lotus: gold halo, crown, robe, joined hands, a flower and a streaming scarf."""
    gold, pale = c["muralLine"], scaled(c["muralHalo"], 0.85)
    face = seat + 0.78
    f.disc(0.05, face, 0.3, c["buddhaGold"], 15, 10)
    f.disc(0.05, face, 0.23, pale, 16, 10)
    f.fill(ellipse(0.05, seat + 0.02, 0.33, 0.09, 8), c["petalDeep"], 16)
    f.fill([(-0.27, seat + 0.02), (0.27, seat + 0.02), (0.15, seat + 0.58), (-0.15, seat + 0.58)], robe, 17)
    f.stroke(flow(-0.12, seat + 0.5, -1.0, 0.5, 1.0, 0.15, 8), taper(0.09), scarf, 18)
    f.stroke([(0.1, seat + 0.5), (0.2, seat + 0.25), (0.02, seat + 0.2)], 0.08, c["skin"], 18)
    f.stroke([(0.02, seat + 0.22), (0.3, seat + 0.5)], 0.025, c["dancheongGreen"], 19)
    f.fill(ellipse(0.3, seat + 0.52, 0.08, 0.08, 6), c["petal"], 19)
    head(f, c, 0.05, face, 0.1, 18)
    h = face + 0.08
    f.fill([(-0.11, h), (-0.09, h + 0.1), (-0.03, h + 0.05), (0.05, h + 0.13), (0.13, h + 0.05), (0.19, h + 0.1), (0.21, h)], gold, 20)


def bodhisattva(brush, c, x, y, face, lion_or_elephant):
    """Munsu on his lion or Bohyeon on his white elephant, facing the Buddha."""
    f = Figure(brush, x, y, 0.8, face)
    robe, scarf = (c["dancheongBlue"], scaled(c["muralHalo"], 0.8)) if lion_or_elephant == "lion" else (c["dancheongYellow"], c["dancheongGreen"])
    seat = lion(f, c) if lion_or_elephant == "lion" else elephant(f, c)
    rider(Figure(brush, x + face * 0.04, y + seat * 0.8, 0.62, face), c, 0.0, robe, scarf)


def lozenges(brush, left, right, y, colors):
    """A row of diamonds across the mural, cycling through `colors`."""
    count = round((right - left) / 0.6)
    pitch = (right - left) / count
    for i in range(count):
        x = left + pitch * (i + 0.5)
        brush.fill([(x - 0.2, y), (x, y - 0.065), (x + 0.2, y), (x, y + 0.065)], colors[i % len(colors)], 1)


def mural(plan):
    """The painting behind the Buddha, after the 영산회상도: his aura, attendants and clouds on a red ground."""
    c = plan.c
    part = Part("mural", frame=GAME)
    z = plan.back + 0.02
    brush = Brush(part, z)
    left, right = -plan.half + 0.8, plan.half - 0.8
    low, high = 0.9, plan.wall - BEAM_BAND
    centre = (0.0, plan.head[1])

    def field(co):
        glow_amount = 1.0 - smoothstep(0.0, 8.5, math.hypot(co.x - centre[0], (co.y - centre[1]) * 1.3))
        base = mix(scaled(c["muralGround"], 0.62), c["muralGround"], smoothstep(low, 3.0, co.y))
        base = scaled(base, 1.0 - 0.3 * smoothstep(6.0, right, abs(co.x)))
        return mix(base, scaled(c["muralHalo"], 0.55), 0.3 * glow_amount)

    columns, rows = round((right - left) / STEP), round((high - low) / STEP)
    part.grid((left, low, z), (right - left, 0.0, 0.0), (0.0, high - low, 0.0), columns, rows, field)

    ymin, ymax = low + 0.29, high - 0.29
    aura(brush, c, centre, ymin, ymax)
    peaks(brush, c, right - 0.12, low + 0.29)
    for i, (x, y, width, height, lobes, tone) in enumerate(CLOUDS):
        for side in (-1.0, 1.0):
            cloud_bank(brush, c, side * x, y, width, height, lobes, i + side, c[tone], 10)
    for x, y, robe, sash, kinds in MUSICIANS:
        for side, kind in zip((-1.0, 1.0), kinds):
            colors = (c[robe], c[sash]) if side < 0 else (c[sash], c[robe])
            musician(brush, c, side * x, y, 0.95, -side, *colors, kind)
    for side, mount in ((-1.0, "lion"), (1.0, "elephant")):
        bodhisattva(brush, c, side * 4.2, 1.62, -side, mount)
    tints = (c["dancheongYellow"], c["dancheongBlue"], c["petal"], c["dancheongGreen"], c["buddhaGoldPale"])
    for side in (-1.0, 1.0):
        for i, x in enumerate((3.3, 4.8, 6.1, 7.4, 8.5)):
            y, size = 4.0 + 0.32 * (i % 2), 0.68 - 0.2 * (i % 2) - 0.015 * i
            small_cloud(brush, c, side * x, y - 0.09, size * 1.2)
            small_buddha(brush, c, side * x, y, size, tints[(i + (side > 0)) % len(tints)])

    for x, y, w, h in (
        (0.0, high - 0.03, right - left, 0.06),
        (0.0, low + 0.03, right - left, 0.06),
        (left + 0.03, (low + high) / 2, 0.06, high - low),
        (right - 0.03, (low + high) / 2, 0.06, high - low),
    ):
        part.box((x, y, z + 0.02), (w, h, 0.03), c["muralLine"], skip=hidden("+z"))
    part.box((0.0, high - 0.1, z + 0.016), (right - left - 0.1, 0.03, 0.02), c["muralInk"], skip=hidden("+z"))
    part.box((0.0, low + 0.1, z + 0.016), (right - left - 0.1, 0.03, 0.02), c["muralInk"], skip=hidden("+z"))
    band = (c["dancheongBlue"], c["dancheongRed"], c["dancheongGreen"])
    for y, edge in ((high - 0.2, high - 0.28), (low + 0.2, low + 0.28)):
        lozenges(brush, left + 0.15, right - 0.15, y, band)
        brush.stroke([(left + 0.15, edge), (right - 0.15, edge)], 0.02, c["muralLine"], 1)
    return part


def halo(plan):
    mat = plan.c
    gold, pale, deep = mat["buddhaGold"], mat["buddhaGoldPale"], mat["buddhaGoldDeep"]
    part = Part("halo", frame=GAME @ at(plan.head[0], plan.head[1], plan.buddha_at[2] - HALO_BEHIND) @ Matrix.Scale(plan.fit, 4))
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
    return part


def lotus(plan):
    mat = plan.c
    pale, deep = mat["petal"], mat["petalDeep"]
    base = mat["buddhaGoldDeep"]
    x, _, z = plan.buddha_at
    s = plan.lotus_scale
    part = Part("lotus", frame=GAME @ at(x, plan.altar["topY"] - LOTUS_FOOT * s, z) @ Matrix.Scale(s, 4))
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
    profile = ((1.3, LOTUS_FOOT), (1.3, -0.4), (1.14, -0.33), (1.06, -0.3), (1.12, -0.22), (1.12, -0.15), (0.9, LOTUS_TOP), (0.0, LOTUS_TOP))
    with part.placed(spun(0.0, 0.0, 0.0)):
        part.lathe(profile, 16, lambda co: scaled(base, 0.85 + 0.3 * smoothstep(LOTUS_FOOT, LOTUS_TOP, co.z)), cap_bottom=True, squash=SQUASH)
    return part


def glow(plan):
    mat = plan.c
    core, middle, edge = mat["flameCore"], mat["flameMid"], mat["flameEdge"]
    radius = GLOW_RADIUS * plan.fit
    part = Part("glow", frame=GAME @ at(plan.head[0], plan.head[1], plan.buddha_at[2] - GLOW_BEHIND))

    def spot(co):
        d = min(co.length / radius, 1.0)
        tint = mix(core, middle, smoothstep(0.0, 0.3, d))
        tint = mix(tint, edge, smoothstep(0.3, 1.0, d))
        alpha = 1.0 - 0.3 * smoothstep(0.0, 0.3, d) - 0.7 * smoothstep(0.3, 1.0, d)
        return scaled(tint, alpha)

    part.radial((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), radius, 5, 20, spot)
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


def build(inputs, out_dir, head):
    plan = Plan(inputs, head)
    solid = common.vertex_color_material("dharma")
    objects = {
        "structure": structure(plan).build(solid),
        "ceiling": ceiling(plan).build(solid),
        "floor": floor(plan).build(solid, crease=False),
        "lotus": lotus(plan).build(solid, crease=False),
        "halo": halo(plan).build(solid, crease=False),
    }
    common.bake_vertex_occlusion([objects["structure"], objects["ceiling"], objects["floor"]], distance=0.9, samples=40, floor=0.55)
    common.bake_vertex_occlusion([objects["lotus"], objects["halo"]], distance=0.35, samples=64, floor=0.5)
    objects["glow"] = glow(plan).build(solid, crease=False)
    objects["mural"] = mural(plan).build(solid, crease=False)
    objects["seat"] = seat(plan).build(solid, crease=False)

    names = inputs["names"]["DHARMA_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"dharma meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "dharma.glb"))
    print("dharma triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
