"""casino.glb: the casino at the end of the coast road, its yard and road, its inside and its three machines.

Everything is drawn in the game's own coordinates (Y up, +Z toward the viewer) through a Part whose frame is GAME. The building,
the road and the yard are placed from the layout in the inputs; nothing here spells a position the game also knows.
The front of the building faces -z, toward the plaza. The game hides `casinoFront`, `casinoRoof` and `casinoSign` while a visitor
is inside, so everything that belongs to the front wall or the roof is in those three. The three machines are authored at the
origin, centred on their footprint, with their fronts toward -z; the game instances them at the machine spots.
"""

import math
import os

import common
from common import GAME, Part, hash01, hidden, mix, rgb, scaled, smoothstep, spun

SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources", "casino")
GROUND_TILE = 1.6  # metres of paving per repeat of the paving picture (the same as world.py's ground)
CARPET_TILE = 1.2  # metres of carpet per repeat of the carpet picture
STEP = 1.2  # about how big a cell of a wall is, so baked occlusion has vertices to sit on
BOTTOM = -0.1  # the walls start a little under the ground


class Plan:
    """What the building follows from the game, with the palette already in linear colour."""

    def __init__(self, inputs):
        k = inputs["casino"]
        self.shell = k["CASINO_SHELL"]
        self.room = k["CASINO_ROOM"]
        self.sign = k["CASINO_SIGN"]
        self.top = k["CASINO_TOP"]
        self.paving = k["CASINO_PAVING"]
        self.columns = k["CASINO_COLUMNS"]
        self.door = k["CASINO_DOOR"]
        self.areas = k["CASINO_AREAS"]
        self.aisle_west = k["CASINO_AISLE_WEST"]
        self.aisle_east = k["CASINO_AISLE_EAST"]
        self.size = k["MACHINE_SIZE"]
        self.height = k["MACHINE_HEIGHT"]
        self.floor_y = k["FLOOR_Y"]
        self.paving_y = k["PAVING_Y"]
        self.kerb = k["KERB_WIDTH"]
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        s = self.shell
        # The door, the sign over it and the yard's runner are all on the game's centre line.
        self.cx = (self.door["minX"] + self.door["maxX"]) / 2
        self.mid_x = (self.room["minX"] + self.room["maxX"]) / 2
        self.front_z = s["minZ"]
        self.inner_front = s["minZ"] + s["wall"]
        self.inner_back = s["maxZ"] - s["wall"]
        self.posts = k["CASINO_POSTS"]
        # The lit windows in the front wall's west pier.
        windows = k["CASINO_WINDOWS"]
        self.windows = windows["xs"]
        self.window_half, self.window_low, self.window_high = windows["half"], windows["low"], windows["high"]


def cuts(span, step=STEP):
    return max(1, round(span / step))


def panel(part, face, plane, u0, u1, y0, y1, color, cu=1, cv=1):
    """An upright rectangle on `plane` facing `face`; u runs along z on an x face and along x on a z face."""
    du, dv = u1 - u0, y1 - y0
    if face == "+x":
        part.grid((plane, y0, u0), (0.0, dv, 0.0), (0.0, 0.0, du), cv, cu, color)
    elif face == "-x":
        part.grid((plane, y0, u0), (0.0, 0.0, du), (0.0, dv, 0.0), cu, cv, color)
    elif face == "+z":
        part.grid((u0, y0, plane), (du, 0.0, 0.0), (0.0, dv, 0.0), cu, cv, color)
    else:
        part.grid((u0, y0, plane), (0.0, dv, 0.0), (du, 0.0, 0.0), cv, cu, color)


def flat(part, face, y, x0, x1, z0, z1, color, cx=1, cz=1, uv=None):
    """A level rectangle at height `y` facing up ('+y') or down ('-y')."""
    dx, dz = x1 - x0, z1 - z0
    if face == "+y":
        part.grid((x0, y, z0), (0.0, 0.0, dz), (dx, 0.0, 0.0), cz, cx, color, uv=uv)
    else:
        part.grid((x0, y, z0), (dx, 0.0, 0.0), (0.0, 0.0, dz), cx, cz, color, uv=uv)


def block(part, lo, hi, color, *shown, step=STEP):
    """A cuboid from corner `lo` to corner `hi` showing only the named faces."""
    size = tuple(b - a for a, b in zip(lo, hi))
    centre = tuple((a + b) / 2 for a, b in zip(lo, hi))
    part.box(centre, size, color, skip=hidden(*shown), cuts=tuple(cuts(side, step) for side in size))


def red_outside(plan):
    c = plan.c

    def tone(co):
        grain = 0.94 + 0.12 * hash01(math.floor(co.x / 0.9), math.floor(co.y / 0.9), math.floor(co.z / 0.9), 2.0)
        return scaled(c["casinoRed"], (0.7 + 0.3 * smoothstep(0.0, 2.6, co.y)) * grain)

    return tone


def red_paper(plan, shade):
    c = plan.c
    return scaled(mix(c["casinoRedDeep"], c["casinoRed"], shade), 0.9)


def stripes(part, plan, face, plane, u0, u1, y0, y1, wide=0.5):
    """Wallpaper: upright stripes of two reds from `u0` to `u1`."""
    count = max(1, round((u1 - u0) / wide))
    width = (u1 - u0) / count
    for i in range(count):
        tint = red_paper(plan, 0.15 if i % 2 == 0 else 0.55)
        panel(part, face, plane, u0 + i * width, u0 + (i + 1) * width, y0, y1, tint, 1, cuts(y1 - y0))


def moulding(part, face, plane, u0, u1, y0, y1, out, color):
    """A band standing `out` metres off the wall at `plane`, on the side `face` looks to."""
    sign = 1.0 if face[0] == "+" else -1.0
    near, far = sorted((plane, plane + sign * out))
    if face[1] == "x":
        block(part, (near, y0, u0), (far, y1, u1), color, face, "+y", "-y")
    else:
        block(part, (u0, y0, near), (u1, y1, far), color, face, "+y", "-y")


def inner_dressing(part, plan, face, plane, u0, u1):
    """The inside of a wall: a dark wainscot, a gold rail, striped paper and a gold crown under the ceiling."""
    c, s = plan.c, plan.shell
    rail = 1.0
    panel(part, face, plane, u0, u1, BOTTOM, rail, scaled(c["casinoBlack"], 1.4), cuts(u1 - u0), 2)
    stripes(part, plan, face, plane, u0, u1, rail, s["topY"])
    moulding(part, face, plane, u0, u1, rail, rail + 0.07, 0.03, c["gilt"])
    moulding(part, face, plane, u0, u1, 0.0, 0.12, 0.04, scaled(c["casinoBlack"], 0.8))
    moulding(part, face, plane, u0, u1, s["ceilingY"] - 0.2, s["ceilingY"], 0.06, c["gilt"])


def outer_dressing(part, plan, face, plane, u0, u1):
    """The outside of a wall: a dark plinth, a gold band under the cornice and the cornice."""
    c, s = plan.c, plan.shell
    moulding(part, face, plane, u0, u1, BOTTOM, 0.55, 0.05, c["casinoBlack"])
    moulding(part, face, plane, u0, u1, s["topY"] - 0.5, s["topY"] - 0.42, 0.03, c["gilt"])
    moulding(part, face, plane, u0, u1, s["topY"] - 0.22, s["topY"], 0.1, c["casinoRedDeep"])
    moulding(part, face, plane, u0, u1, s["topY"] - 0.26, s["topY"] - 0.22, 0.11, c["gilt"])


def lamp_post(part, plan, x, z):
    """A street lamp's iron post and its crown; the glass globe is in casinoNeon."""
    c = plan.c
    iron = scaled(c["steelDark"], 1.2)
    part.tube([(x, BOTTOM, z), (x, 0.4, z), (x, 2.7, z)], [0.1, 0.07, 0.05], 8, iron)
    with part.placed(spun(x, 2.55, z)):
        part.lathe(((0.17, 0.0), (0.2, 0.05), (0.1, 0.1), (0.0, 0.1)), 10, c["gilt"])
    with part.placed(spun(x, 3.2, z)):
        part.lathe(((0.0, 0.0), (0.24, 0.05), (0.04, 0.2), (0.0, 0.2)), 10, c["gilt"])


# ---- the shell ---------------------------------------------------------------------------------------------------------------------
def walls(plan):
    """The two side walls and the back wall, in and out; the lamp posts of the road and the yard stand with them."""
    part = Part("casinoWalls", frame=GAME)
    c, s = plan.c, plan.shell
    top, bottom, t = s["topY"], BOTTOM, s["wall"]
    outside = red_outside(plan)
    front, back = s["minZ"], s["maxZ"]
    inner_front, inner_back = plan.inner_front, plan.inner_back
    # West and east: the outside runs the whole depth, the inside from the front wall to the back wall.
    for plane_out, plane_in, out_face, in_face in ((s["minX"], s["minX"] + t, "-x", "+x"), (s["maxX"], s["maxX"] - t, "+x", "-x")):
        panel(part, out_face, plane_out, front, back, bottom, top, outside, cuts(back - front), cuts(top - bottom))
        outer_dressing(part, plan, out_face, plane_out, front, back)
        panel(part, "-z", inner_front, min(plane_out, plane_in), max(plane_out, plane_in), bottom, top, red_paper(plan, 0.3), 1, 3)
        inner_dressing(part, plan, in_face, plane_in, inner_front, inner_back)
        lo, hi = sorted((plane_out, plane_in))
        flat(part, "+y", top, lo, hi, inner_front, inner_back, scaled(c["casinoRedDeep"], 1.1), 1, cuts(inner_back - inner_front))
    # The back wall.
    panel(part, "+z", back, s["minX"], s["maxX"], bottom, top, outside, cuts(s["maxX"] - s["minX"]), cuts(top - bottom))
    outer_dressing(part, plan, "+z", back, s["minX"], s["maxX"])
    inner_dressing(part, plan, "-z", inner_back, plan.room["minX"], plan.room["maxX"])
    flat(part, "+y", top, s["minX"], s["maxX"], inner_back, back, scaled(c["casinoRedDeep"], 1.1), cuts(s["maxX"] - s["minX"]), 1)
    for x, z in plan.posts:
        lamp_post(part, plan, x, z)
    return part


def tiled_roof(part, plan, x0, x1, base_y, ridge_y, z_front, z_ridge, z_back):
    """A little tiled hip roof: two slopes, two gables and a soffit, with a ridge cap."""
    c = plan.c
    dx = x1 - x0
    rise = ridge_y - base_y
    columns = max(2, round(dx / 0.35))

    def tiles(co):
        row = 0.88 + 0.16 * hash01(math.floor((co.x - x0) / 0.35), 0.0, 0.0, 6.0)
        return scaled(mix(c["tileGray"], c["tileEdge"], smoothstep(base_y, ridge_y, co.y) * 0.5), row)

    part.grid((x0, base_y, z_front), (0.0, rise, z_ridge - z_front), (dx, 0.0, 0.0), 2, columns, tiles)
    part.grid((x0, ridge_y, z_ridge), (0.0, -rise, z_back - z_ridge), (dx, 0.0, 0.0), 2, columns, tiles)
    for x, side in ((x0, -1.0), (x1, 1.0)):
        faces = part.polygon([(x, base_y, z_front), (x, ridge_y, z_ridge), (x, base_y, z_back)], scaled(c["casinoRedDeep"], 0.9))
        part.orient(faces, (x + side * 4.0, base_y, z_ridge))
    flat(part, "-y", base_y, x0, x1, z_front, z_back, scaled(c["casinoRedDeep"], 0.7))
    part.tube([(x0 - 0.05, ridge_y + 0.04, z_ridge), (x1 + 0.05, ridge_y + 0.04, z_ridge)], [0.1, 0.1], 6, c["tileEdge"])
    for x in (x0 - 0.05, x1 + 0.05):
        part.sphere((x, ridge_y + 0.06, z_ridge), (0.12, 0.12, 0.12), 6, 4, c["gilt"])


def front(plan):
    """The wall that faces the plaza: the doorway, the sign tower over it, window frames and the awning."""
    part = Part("casinoFront", frame=GAME)
    c, s, sg = plan.c, plan.shell, plan.sign
    z0, z1 = plan.front_z, plan.inner_front
    cap = s["topY"] + s["parapet"]
    tower_top = s["topY"] + sg["tower"]
    door, h = plan.door, s["doorHeight"]
    outside = red_outside(plan)
    # The outside face: two piers and the lintel over the doorway, with the doorway's reveals.
    for x0, x1 in ((s["minX"], door["minX"]), (door["maxX"], s["maxX"])):
        panel(part, "-z", z0, x0, x1, BOTTOM, cap, outside, cuts(x1 - x0), cuts(cap - BOTTOM))
    panel(part, "-z", z0, door["minX"], door["maxX"], h, cap, outside, cuts(door["maxX"] - door["minX"]), 2)
    paper = red_paper(plan, 0.3)
    panel(part, "+x", door["minX"], z0, z1, BOTTOM, h, paper)
    panel(part, "-x", door["maxX"], z0, z1, BOTTOM, h, paper)
    flat(part, "-y", h, door["minX"], door["maxX"], z0, z1, scaled(c["casinoRedDeep"], 0.8))
    outer_dressing(part, plan, "-z", z0, s["minX"], door["minX"])
    outer_dressing(part, plan, "-z", z0, door["maxX"], s["maxX"])
    # The inside face, between the side walls.
    room = plan.room
    for x0, x1 in ((room["minX"], door["minX"]), (door["maxX"], room["maxX"])):
        inner_dressing(part, plan, "+z", z1, x0, x1)
        panel(part, "+z", z1, x0, x1, s["topY"], cap, paper)
    panel(part, "+z", z1, door["minX"], door["maxX"], h, cap, paper, 2, 2)
    moulding(part, "+z", z1, door["minX"], door["maxX"], s["ceilingY"] - 0.2, s["ceilingY"], 0.06, c["gilt"])
    # The parapet's top and ends, and the doorway's gold frame.
    for x0, x1 in ((s["minX"], plan.cx - sg["halfWidth"] - sg["side"]), (plan.cx + sg["halfWidth"] + sg["side"], s["maxX"])):
        flat(part, "+y", cap, x0, x1, z0, z1, scaled(c["casinoRedDeep"], 1.1))
    panel(part, "-x", s["minX"], z0, z1, s["topY"], cap, scaled(c["casinoRed"], 0.9))
    panel(part, "+x", s["maxX"], z0, z1, s["topY"], cap, scaled(c["casinoRed"], 0.9))
    for x in (door["minX"] - 0.2, door["maxX"]):
        block(part, (x, BOTTOM, z0 - 0.1), (x + 0.2, h + 0.2, z0), c["gilt"], "-z", "-x", "+x")
    block(part, (door["minX"] - 0.2, h, z0 - 0.1), (door["maxX"] + 0.2, h + 0.2, z0), c["gilt"], "-z", "+y", "-y")
    # The sign tower: a dark red tower with a gold frame, a tiled eave on its head.
    half = sg["halfWidth"] + sg["side"]
    tx0, tx1 = plan.cx - half, plan.cx + half
    tower = scaled(c["casinoRedDeep"], 0.9)
    panel(part, "-z", z0, tx0, tx1, cap, tower_top, tower, cuts(tx1 - tx0), 3)
    panel(part, "+z", z1, tx0, tx1, cap, tower_top, tower, cuts(tx1 - tx0), 3)
    panel(part, "-x", tx0, z0, z1, cap, tower_top, tower)
    panel(part, "+x", tx1, z0, z1, cap, tower_top, tower)
    for x in (tx0 - 0.08, tx1 - 0.12):
        block(part, (x, cap, z0 - 0.1), (x + 0.2, tower_top, z0), c["gilt"], "-z", "-x", "+x", "+y")
    block(part, (tx0 - 0.08, tower_top - 0.16, z0 - 0.14), (tx1 + 0.08, tower_top, z0), c["gilt"], "-z", "-y", "+y", "-x", "+x")
    block(part, (tx0 - 0.08, cap - 0.01, z0 - 0.14), (tx1 + 0.08, cap + 0.16, z0), c["gilt"], "-z", "-y", "+y", "-x", "+x")
    tiled_roof(part, plan, tx0 - sg["overhang"], tx1 + sg["overhang"], tower_top, plan.top, z0 - 0.7, (z0 + z1) / 2, z1 + 0.4)
    # Window frames in the west pier; the lit glass is in casinoSign.
    for wx in plan.windows:
        x0, x1 = wx - plan.window_half, wx + plan.window_half
        y0, y1 = plan.window_low, plan.window_high
        for lo, hi in (((x0 - 0.12, y0 - 0.12, z0 - 0.08), (x1 + 0.12, y0, z0)), ((x0 - 0.12, y1, z0 - 0.08), (x1 + 0.12, y1 + 0.12, z0)),
                       ((x0 - 0.12, y0, z0 - 0.08), (x0, y1, z0)), ((x1, y0, z0 - 0.08), (x1 + 0.12, y1, z0))):
            block(part, lo, hi, c["gilt"], "-z", "+y", "-y", "-x", "+x")
        block(part, (x0 - 0.2, y0 - 0.2, z0 - 0.2), (x1 + 0.2, y0 - 0.12, z0), scaled(c["casinoBlack"], 1.3), "-z", "+y", "-y", "-x", "+x")
    # The awning over the door: a red slab with a gold edge and two braces.
    ax0, ax1 = door["minX"] - 0.6, door["maxX"] + 0.6
    reach = 1.7
    block(part, (ax0, 3.65, z0 - reach), (ax1, 3.8, z0), c["casinoRed"], "+y", "-y", "-z", "-x", "+x")
    block(part, (ax0 - 0.04, 3.4, z0 - reach - 0.04), (ax1 + 0.04, 3.65, z0 - reach), c["gilt"], "-z", "-x", "+x", "-y")
    for x in (ax0 + 0.15, ax1 - 0.15):
        part.tube([(x, 2.85, z0), (x, 3.0, z0), (x, 3.62, z0 - reach + 0.1)], [0.05, 0.05, 0.05], 6, c["gilt"])
    return part


def roof(plan):
    """The flat roof with its parapet, a gilded dome and two vents. Hidden while a visitor is inside."""
    part = Part("casinoRoof", frame=GAME)
    c, s = plan.c, plan.shell
    top, cap, edge = s["topY"], s["topY"] + s["parapet"], 0.3
    x0, x1 = s["minX"] + edge, s["maxX"] - edge
    z0, z1 = plan.inner_front, s["maxZ"] - edge

    def tar(co):
        speck = 0.86 + 0.2 * hash01(math.floor(co.x / 0.5), 0.0, math.floor(co.z / 0.5), 8.0)
        return scaled(c["casinoTile"], 0.75 * speck)

    flat(part, "+y", top, x0, x1, z0, z1, tar, cuts(x1 - x0, 1.5), cuts(z1 - z0, 1.5))
    # The parapet runs down both sides and along the back; the front wall carries its own.
    deep = scaled(c["casinoRed"], 0.85)
    block(part, (s["minX"], top, plan.inner_front), (x0, cap, s["maxZ"]), deep, "-x", "+x", "+z")
    block(part, (x1, top, plan.inner_front), (s["maxX"], cap, s["maxZ"]), deep, "-x", "+x", "+z")
    block(part, (x0, top, z1), (x1, cap, s["maxZ"]), deep, "+z", "-z")
    for lo, hi in (((s["minX"] - 0.03, cap, plan.inner_front), (x0 + 0.03, cap + 0.06, s["maxZ"] + 0.03)),
                   ((x1 - 0.03, cap, plan.inner_front), (s["maxX"] + 0.03, cap + 0.06, s["maxZ"] + 0.03)),
                   ((x0, cap, z1 - 0.03), (x1, cap + 0.06, s["maxZ"] + 0.03))):
        block(part, lo, hi, c["gilt"], "+y", "-x", "+x", "+z", "-z")
    # A gilded dome on a red drum, over the middle of the room.
    dome_z = (z0 + z1) / 2
    with part.placed(spun(plan.mid_x, top, dome_z)):
        part.lathe(((1.8, 0.0), (1.8, 0.45), (1.7, 0.5), (1.7, 0.52)), 16, lambda co: scaled(c["casinoRed"], 0.8 + 0.3 * smoothstep(0.0, 0.5, co.z)), cap_bottom=False)
        part.lathe(((1.86, 0.4), (1.86, 0.5), (1.7, 0.5)), 16, c["gilt"])
        dome = ((1.7, 0.52), (1.62, 0.8), (1.42, 1.18), (1.05, 1.52), (0.58, 1.78), (0.2, 1.93), (0.0, 1.97))
        part.lathe(common.smooth_profile(dome, 2), 16, lambda co: scaled(mix(c["brass"], c["gilt"], smoothstep(0.5, 1.9, co.z)), 0.85 + 0.25 * smoothstep(0.5, 1.9, co.z)))
        part.lathe(((0.05, 1.95), (0.09, 2.1), (0.05, 2.4), (0.0, 2.55)), 8, c["gilt"])
    # Four vents, in a staggered row down either side of the dome.
    for share_x, share_z in ((0.14, 0.1), (0.86, 0.3), (0.14, 0.7), (0.86, 0.9)):
        vx, vz = x0 + (x1 - x0) * share_x, z0 + (z1 - z0) * share_z
        block(part, (vx - 0.5, top, vz - 0.35), (vx + 0.5, top + 0.55, vz + 0.35), scaled(c["steelDark"], 1.5), "+y", "+x", "-x", "+z", "-z")
        block(part, (vx - 0.56, top + 0.55, vz - 0.41), (vx + 0.56, top + 0.62, vz + 0.41), c["steelLight"], "+y", "+x", "-x", "+z", "-z")
    return part


# ---- the inside --------------------------------------------------------------------------------------------------------------------
BEAM_DROP, BEAM_WIDTH = 0.3, 0.32
COFFER = 3.5  # about how big a panel of the ceiling is, between its beams


def coffers(plan):
    """The beam lines of the ceiling (xs, zs) and the panel between each pair, as (i, j, x0, x1, z0, z1)."""
    room = plan.room
    nx, nz = cuts(room["maxX"] - room["minX"], COFFER), cuts(plan.inner_back - plan.inner_front, COFFER)
    xs = [room["minX"] + (room["maxX"] - room["minX"]) * i / nx for i in range(nx + 1)]
    zs = [plan.inner_front + (plan.inner_back - plan.inner_front) * j / nz for j in range(nz + 1)]
    half = BEAM_WIDTH / 2
    cells = []
    for i, (xa, xb) in enumerate(zip(xs, xs[1:])):
        for j, (za, zb) in enumerate(zip(zs, zs[1:])):
            cells.append((i, j, xa + (half if i else 0.0), xb - (half if i < nx - 1 else 0.0), za + (half if j else 0.0), zb - (half if j < nz - 1 else 0.0)))
    return xs, zs, cells


def ceiling(plan):
    """The coffered ceiling: red-and-gold panels between beams. The lamp discs are in casinoNeon."""
    part = Part("casinoCeiling", frame=GAME)
    c, s, room = plan.c, plan.shell, plan.room
    y = s["ceilingY"]
    drop, beam = BEAM_DROP, BEAM_WIDTH
    xs, zs, cells = coffers(plan)
    for i, j, ax, bx, az, bz in cells:
        tint = scaled(c["casinoRedDeep"], 0.9 if (i + j) % 2 else 1.1)
        flat(part, "-y", y, ax, bx, az, bz, tint, cuts(bx - ax, 1.7), cuts(bz - az, 1.7))
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        part.radial((mx, y - 0.02, mz), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), 0.95, 1, 16, c["gilt"], smooth=False)
        part.radial((mx, y - 0.03, mz), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), 0.78, 1, 16, scaled(c["casinoRed"], 0.7), smooth=False)
    gold = c["gilt"]
    # The beams: along x the whole way, along z only between those.
    for z in zs[1:-1]:
        block(part, (room["minX"], y - drop, z - beam / 2), (room["maxX"], y, z + beam / 2), scaled(c["casinoRedDeep"], 1.3), "+z", "-z", step=1.7)
        block(part, (room["minX"], y - drop - 0.04, z - beam / 2 - 0.02), (room["maxX"], y - drop, z + beam / 2 + 0.02), gold, "-y", "+z", "-z", step=3.4)
    for x in xs[1:-1]:
        for za, zb in zip(zs, zs[1:]):
            lo, hi = za + (beam / 2 if za > zs[0] else 0.0), zb - (beam / 2 if zb < zs[-1] else 0.0)
            block(part, (x - beam / 2, y - drop, lo), (x + beam / 2, y, hi), scaled(c["casinoRedDeep"], 1.3), "+x", "-x", step=1.7)
            block(part, (x - beam / 2 - 0.02, y - drop - 0.04, lo), (x + beam / 2 + 0.02, y - drop, hi), gold, "-y", "+x", "-x", step=3.4)
    return part


def columns(plan):
    """The gold columns at the corners of the floor's ring, floor to ceiling."""
    part = Part("casinoColumns", frame=GAME)
    c, s = plan.c, plan.shell
    y0, y1 = plan.floor_y, s["ceilingY"]
    height = y1 - y0
    for column in plan.columns:
        r = column["radius"]
        shaft = [(r * 1.05, 0.3), (r, 0.5), (r * 0.96, height * 0.5), (r * 0.9, height - 0.7), (r * 0.98, height - 0.45)]
        with part.placed(spun(column["x"], y0, column["z"])):
            part.lathe(((r * 1.9, 0.0), (r * 1.9, 0.12), (r * 1.55, 0.18), (r * 1.2, 0.3)), 16, scaled(c["casinoBlack"], 1.6))
            part.lathe(common.smooth_profile(shaft, 2), 16, lambda co: scaled(mix(c["brass"], c["gilt"], 0.4 + 0.5 * smoothstep(0.0, height, co.z)), 0.9 + 0.2 * math.sin(math.pi * co.z / height)))
            part.lathe(((r * 1.0, height - 0.45), (r * 1.5, height - 0.35), (r * 1.7, height - 0.2), (r * 1.95, height - 0.12), (r * 1.95, height)), 16, scaled(c["gilt"], 1.05))
    return part


# A 5x7 pixel face for the sign's letters and the lucky seven on the back wall.
FONT = {
    "C": (".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."),
    "A": (".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    "S": (".####", "#....", "#....", ".###.", "....#", "....#", "####."),
    "I": ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"),
    "N": ("#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"),
    "O": (".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
    "7": ("#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."),
}


def spell(text):
    """The lit cells of `text` as (column, row), row 0 at the top, one empty column between letters; and the width in columns."""
    lit, column = [], 0
    for letter in text:
        for row, line in enumerate(FONT[letter]):
            lit += [(column + k, row) for k, mark in enumerate(line) if mark == "#"]
        column += 6
    return lit, column - 1


def lettering(part, text, cell, x, y, z, color, shade=None):
    """Pixel letters on a wall that faces -z, centred on (x, y). A viewer facing +z has -x on their right, so columns run toward -x."""
    lit, width = spell(text)
    for column, row in lit:
        px = x + (width / 2.0 - column - 0.5) * cell
        py = y + (3.0 - row) * cell
        if shade is not None:
            panel(part, "-z", z + 0.012, px - cell * 0.46 - 0.025, px + cell * 0.46 - 0.025, py - cell * 0.46 - 0.025, py + cell * 0.46 - 0.025, shade)
        panel(part, "-z", z, px - cell * 0.46, px + cell * 0.46, py - cell * 0.46, py + cell * 0.46, color)


def sign(plan):
    """What glows on the front: the lettered board with its bulbs, the windows' lit glass, the door's neon and the awning's bulbs."""
    part = Part("casinoSign", frame=GAME)
    c, s, sg = plan.c, plan.shell, plan.sign
    z0 = plan.front_z
    half, bottom, top = sg["halfWidth"], sg["bottom"], sg["bottom"] + sg["height"]
    x0, x1 = plan.cx - half, plan.cx + half
    panel(part, "-z", z0 - 0.04, x0, x1, bottom, top, lambda co: scaled(mix(c["casinoRedDeep"], c["casinoBlack"], 0.5 + 0.5 * smoothstep(bottom, top, co.y)), 0.9), 4, 2)
    lettering(part, "CASINO", sg["cell"], plan.cx, (bottom + top) / 2, z0 - 0.045, scaled(c["casinoCream"], 1.0), c["casinoNeonPink"])
    # A frame of gold and a ring of bulbs on its inside edge.
    for lo, hi in (((x0 - 0.12, bottom - 0.12, z0 - 0.12), (x1 + 0.12, bottom, z0 - 0.04)), ((x0 - 0.12, top, z0 - 0.12), (x1 + 0.12, top + 0.12, z0 - 0.04)),
                   ((x0 - 0.12, bottom, z0 - 0.12), (x0, top, z0 - 0.04)), ((x1, bottom, z0 - 0.12), (x1 + 0.12, top, z0 - 0.04))):
        block(part, lo, hi, scaled(c["gilt"], 1.1), "-z", "+y", "-y", "-x", "+x")
    bulbs = [(x0 + 0.2 + k * 0.36, y) for k in range(int((x1 - x0 - 0.4) / 0.36) + 1) for y in (bottom + 0.16, top - 0.16)]
    bulbs += [(x, bottom + 0.55 + k * 0.4) for k in range(4) for x in (x0 + 0.2, x1 - 0.2)]
    for k, (bx, by) in enumerate(bulbs):
        tint = c["casinoCream"] if k % 2 == 0 else c["casinoNeonPink"]
        block(part, (bx - 0.06, by - 0.06, z0 - 0.1), (bx + 0.06, by + 0.06, z0 - 0.04), scaled(tint, 1.1), "-z")
    # The windows: warm light with a pink and a cyan band, where the room's glow shows through.
    for wx in plan.windows:
        wa, wb = wx - plan.window_half, wx + plan.window_half
        ya, yb = plan.window_low, plan.window_high
        panel(part, "-z", z0 - 0.02, wa, wb, ya, yb, lambda co: mix(scaled(c["casinoCream"], 0.9), scaled(c["gilt"], 0.9), smoothstep(ya, yb, co.y)), 1, 4)
        panel(part, "-z", z0 - 0.025, wa, wb, ya + 0.75, ya + 0.9, c["casinoNeonCyan"])
        panel(part, "-z", z0 - 0.025, wa, wb, ya + 1.2, ya + 1.35, c["casinoNeonPink"])
    # Neon round the doorway, and bulbs along the awning's edge.
    door, h = plan.door, s["doorHeight"]
    outline = [(door["minX"] - 0.3, 0.1, z0 - 0.13), (door["minX"] - 0.3, h + 0.3, z0 - 0.13), (door["maxX"] + 0.3, h + 0.3, z0 - 0.13), (door["maxX"] + 0.3, 0.1, z0 - 0.13)]
    part.tube(outline, [0.035] * 4, 6, c["casinoNeonPink"], caps=True, smooth=False)
    awning_x0, awning_x1 = door["minX"] - 0.6, door["maxX"] + 0.6
    count = int((awning_x1 - awning_x0) / 0.32)
    for k in range(count + 1):
        bx = awning_x0 + (awning_x1 - awning_x0) * k / count
        part.sphere((bx, 3.5, z0 - 1.74), (0.055, 0.055, 0.055), 6, 4, scaled(c["casinoCream"] if k % 2 == 0 else c["casinoNeonCyan"], 1.1))
    return part


def neon(plan):
    """What glows all the time: the ceiling's lamp discs, the cove and floor tubes, the lucky seven and the yard's lamp globes."""
    part = Part("casinoNeon", frame=GAME)
    c, s, room = plan.c, plan.shell, plan.room
    y = s["ceilingY"]
    pink, cyan = c["casinoNeonPink"], c["casinoNeonCyan"]
    _, _, cells = coffers(plan)
    for _i, _j, ax, bx, az, bz in cells:
        part.radial(((ax + bx) / 2, y - 0.05, (az + bz) / 2), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), 0.5, 1, 14, c["casinoCream"], smooth=False)
    # Cove tubes under the beams along both side walls, and along the back wall.
    cove = y - 0.5
    front, back = plan.inner_front + 0.1, plan.inner_back - 0.09
    part.tube([(room["minX"] + 0.09, cove, front), (room["minX"] + 0.09, cove, back)], [0.035, 0.035], 6, pink, smooth=False)
    part.tube([(room["maxX"] - 0.09, cove, front), (room["maxX"] - 0.09, cove, back)], [0.035, 0.035], 6, cyan, smooth=False)
    part.tube([(room["minX"] + 0.1, cove, back), (plan.mid_x, cove, back)], [0.035, 0.035], 6, pink, smooth=False)
    part.tube([(plan.mid_x, cove, back), (room["maxX"] - 0.1, cove, back)], [0.035, 0.035], 6, cyan, smooth=False)
    # Low strips along the two edges of each aisle, flat on the carpet: pink along the west aisle, cyan along the east one.
    for aisle, tint in ((plan.aisle_west, pink), (plan.aisle_east, cyan)):
        for x in (aisle["minX"] - 0.05, aisle["maxX"] + 0.05):
            part.tube([(x, plan.floor_y + 0.03, aisle["minZ"]), (x, plan.floor_y + 0.03, aisle["maxZ"])], [0.05, 0.05], 6, tint, up=(0.0, 1.0, 0.0), flat=0.5, smooth=False)
    # The lucky seven on the back wall, in pink with a cyan shadow, and a cyan frame round it.
    zb = plan.inner_back - 0.03
    lettering(part, "7", 0.22, plan.mid_x, 2.7, zb, pink, cyan)
    fx0, fx1, fy0, fy1 = plan.mid_x - 1.0, plan.mid_x + 1.0, 1.7, 3.7
    part.tube([(fx0, fy0, zb), (fx0, fy1, zb), (fx1, fy1, zb), (fx1, fy0, zb)], [0.03] * 4, 6, cyan, closed=True, smooth=False)
    # The glass globes of the street lamps.
    for x, z in plan.posts:
        part.sphere((x, 2.88, z), (0.23, 0.23, 0.23), 10, 6, c["casinoCream"])
    return part


# ---- the yard and the road ---------------------------------------------------------------------------------------------------------
def paving_tone(plan):
    c = plan.c
    stone = mix(c["paving"], c["casinoTile"], 0.4)

    def tone(co):
        return scaled(stone, 0.85 + 0.2 * hash01(math.floor(co.x / 0.65), 0.0, math.floor(co.z / 0.65), 4.0))

    return tone


def kerb(part, plan, x0, x1, z0, z1):
    lift = plan.paving_y
    block(part, (x0, lift - 0.02, z0), (x1, lift + 0.1, z1), scaled(plan.c["steelLight"], 0.85), "+y", "+x", "-x", "+z", "-z")


def yard(plan):
    """The forecourt: dark stone paving with a red runner to the door, a doorsill and kerbs."""
    part = Part("casinoYard", frame=GAME)
    c, y = plan.c, plan.paving_y
    box, sill = plan.paving["yard"], plan.paving["sill"]
    flat(part, "+y", y, box["minX"], box["maxX"], box["minZ"], box["maxZ"], paving_tone(plan), cuts(box["maxX"] - box["minX"], 0.65), cuts(box["maxZ"] - box["minZ"], 0.65))
    # The runner, from the road to the door, with a gold line down each edge.
    half, start = 0.9, box["minZ"] + 1.2
    deep = scaled(c["casinoRed"], 0.85)
    flat(part, "+y", y + 0.012, plan.cx - half, plan.cx + half, start, sill["minZ"], lambda co: scaled(deep, 0.92 + 0.12 * hash01(math.floor(co.z / 0.6), 0.0, 0.0, 5.0)), 3, cuts(sill["minZ"] - start, 0.65))
    for x in (plan.cx - half, plan.cx + half - 0.07):
        flat(part, "+y", y + 0.02, x, x + 0.07, start, sill["minZ"], c["gilt"], 1, cuts(sill["minZ"] - start, 1.5))
    # The doorsill, stone through the thickness of the front wall, a little proud of the paving.
    block(part, (sill["minX"], y - 0.01, sill["minZ"]), (sill["maxX"], y + 0.03, sill["maxZ"]), scaled(c["steelLight"], 0.9), "+y", "-z", "+z")
    k = plan.kerb
    kerb(part, plan, box["minX"], box["minX"] + k, box["minZ"], box["maxZ"])
    kerb(part, plan, box["maxX"] - k, box["maxX"], box["minZ"], box["maxZ"])
    # The yard is wider than the road: a kerb along its south edge on either side of where the road comes in.
    road = plan.paving["road"]
    kerb(part, plan, box["minX"] + k, road["minX"], box["minZ"], box["minZ"] + k)
    kerb(part, plan, road["maxX"], box["maxX"] - k, box["minZ"], box["minZ"] + k)
    part.project_uv(GROUND_TILE)
    return part


def road(plan):
    """The coast road: the same paving, a dashed centre line and kerbs on both sides."""
    part = Part("coastRoad", frame=GAME)
    c, y = plan.c, plan.paving_y
    box = plan.paving["road"]
    flat(part, "+y", y, box["minX"], box["maxX"], box["minZ"], box["maxZ"], paving_tone(plan), cuts(box["maxX"] - box["minX"], 0.65), cuts(box["maxZ"] - box["minZ"], 0.65))
    middle = (box["minX"] + box["maxX"]) / 2
    z = box["minZ"] + 0.9
    while z + 0.9 <= box["maxZ"] - 0.5:
        flat(part, "+y", y + 0.012, middle - 0.06, middle + 0.06, z, z + 0.9, scaled(c["casinoCream"], 0.85), 1, 2)
        z += 1.8
    kerb(part, plan, box["minX"], box["minX"] + plan.kerb, box["minZ"], box["maxZ"])
    kerb(part, plan, box["maxX"] - plan.kerb, box["maxX"], box["minZ"], box["maxZ"])
    part.project_uv(GROUND_TILE)
    return part


def floor(plan):
    """The carpet: one picture, tinted rose where a visitor walks (the doorway, the lobby, the aisles and the cross room) and darker
    in the bays under the machines. The room is cut along every edge of those, so each piece is one tint."""
    part = Part("casinoFloor", frame=GAME)
    c, room = plan.c, plan.room
    walked = [*plan.areas, plan.door]
    wear = plan.c["carpetTint"]
    bay = mix(wear, c["casinoBlack"], 0.4)

    def worn(base):
        return lambda co: scaled(base, 0.82 + 0.3 * common.fbm(co.x * 0.8, 0.0, co.z * 0.8, 3.0))

    def tiling(co):
        return (co.x / CARPET_TILE, co.z / CARPET_TILE)

    def lines(low, high, edges):
        return sorted({low, high, *(v for v in edges if low < v < high)})

    xs = lines(room["minX"], room["maxX"], [v for area in walked for v in (area["minX"], area["maxX"])])
    zs = lines(plan.inner_front, plan.inner_back, [v for area in walked for v in (area["minZ"], area["maxZ"])])
    for x0, x1 in zip(xs, xs[1:]):
        for z0, z1 in zip(zs, zs[1:]):
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            trodden = any(a["minX"] < mx < a["maxX"] and a["minZ"] < mz < a["maxZ"] for a in walked)
            flat(part, "+y", plan.floor_y, x0, x1, z0, z1, worn(wear if trodden else bay), cuts(x1 - x0, 0.75), cuts(z1 - z0, 0.75), uv=tiling)
    return part


# ---- the three machines ------------------------------------------------------------------------------------------------------------
def prism(part, profile, x0, x1, color):
    """A side outline of (z, y) points, drawn z to the right and y up, extruded from x0 to x1 with both ends closed."""
    pairs = list(zip(profile, profile[1:] + profile[:1]))
    points = list(profile) if sum(a[0] * b[1] - b[0] * a[1] for a, b in pairs) > 0 else list(reversed(profile))
    for (za, ya), (zb, yb) in zip(points, points[1:] + points[:1]):
        part.grid((x0, ya, za), (x1 - x0, 0.0, 0.0), (0.0, yb - ya, zb - za), 1, 1, color)
    part.polygon([(x0, y, z) for z, y in points], color)
    part.polygon([(x1, y, z) for z, y in reversed(points)], color)


def slot_cabinet(plan):
    """A one-armed bandit at the classic's width (the runtime stretches it for the five-reel): near-white body so the instance colour
    tints it, a marquee with three sevens, a dark reel window, a sloped deck of buttons, a payout tray and a lever on its right."""
    part = Part("slotCabinet", frame=GAME)
    c, h = plan.c, plan.height["slot"]
    hw, hd = plan.size["classic"]["width"] / 2, plan.size["classic"]["depth"] / 2
    black, gilt = scaled(c["casinoBlack"], 1.3), c["gilt"]
    shaded = lambda co: scaled(c["slotBody"], 0.62 + 0.38 * smoothstep(0.1, 1.6, co.y))
    window_z, header_z = -hd + 0.21, -hd + 0.13
    block(part, (-hw, 0.0, -hd), (hw, 0.18, hd), black, "-z", "+x", "-x", "+z", "+y", step=3.0)
    deck_slope = (1.02 - 1.16) / (-hd - window_z)
    profile = [(-hd + 0.05, 0.18), (hd, 0.18), (hd, h), (header_z, h), (header_z, h - 0.35), (window_z, h - 0.35), (window_z, 1.16), (-hd, 1.02), (-hd, 0.9), (-hd + 0.05, 0.9)]
    prism(part, profile, -hw + 0.04, hw - 0.04, shaded)
    # The marquee: a lit face with 777 and a gold frame.
    top = h - 0.06
    panel(part, "-z", header_z - 0.01, -hw + 0.1, hw - 0.1, h - 0.3, top, scaled(c["casinoCream"], 1.0))
    lettering(part, "777", 0.026, 0.0, h - 0.18, header_z - 0.02, scaled(c["casinoRed"], 1.0))
    for lo, hi in (((-hw + 0.06, h - 0.34, header_z - 0.03), (hw - 0.06, h - 0.3, header_z)), ((-hw + 0.06, top, header_z - 0.03), (hw - 0.06, h - 0.02, header_z)),
                   ((-hw + 0.06, h - 0.3, header_z - 0.03), (-hw + 0.1, top, header_z)), ((hw - 0.1, h - 0.3, header_z - 0.03), (hw - 0.06, top, header_z))):
        block(part, lo, hi, gilt, "-z", "+y", "-y", "-x", "+x", step=3.0)
    # The reel window: a dark recess with three cream reels and two symbols on each.
    panel(part, "-z", window_z - 0.01, -hw + 0.1, hw - 0.1, 1.2, 1.58, black)
    symbols = (c["casinoRed"], gilt, c["casinoNeonCyan"])
    for k, x in enumerate((-0.24, 0.0, 0.24)):
        panel(part, "-z", window_z - 0.02, x - 0.1, x + 0.1, 1.24, 1.54, scaled(c["casinoCream"], 0.95))
        for j, y in enumerate((1.33, 1.46)):
            part.radial((x, y, window_z - 0.03), (0.0, 1.0, 0.0), (1.0, 0.0, 0.0), 0.045, 1, 6, symbols[(k + j) % 3], smooth=False)
    for lo, hi in (((-hw + 0.08, 1.16, window_z - 0.03), (hw - 0.08, 1.2, window_z)), ((-hw + 0.08, 1.58, window_z - 0.03), (hw - 0.08, 1.62, window_z)),
                   ((-hw + 0.08, 1.2, window_z - 0.03), (-hw + 0.1, 1.58, window_z)), ((hw - 0.1, 1.2, window_z - 0.03), (hw - 0.08, 1.58, window_z))):
        block(part, lo, hi, gilt, "-z", "+y", "-y", "-x", "+x", step=3.0)
    # Five buttons on the deck, and the payout tray below it.
    for k, tint in enumerate((c["casinoRed"], gilt, c["casinoCream"], c["casinoFelt"], c["casinoRed"])):
        z = -hd + 0.07
        with part.placed(spun(-0.28 + 0.14 * k, 1.02 + deck_slope * (z + hd) - 0.01, z)):
            part.lathe(((0.04, 0.0), (0.04, 0.03), (0.0, 0.04)), 6, scaled(tint, 1.1))
    panel(part, "-z", -hd + 0.04, -0.2, 0.2, 0.34, 0.5, black)
    for lo, hi in (((-0.23, 0.31, -hd + 0.03), (0.23, 0.34, -hd + 0.05)), ((-0.23, 0.5, -hd + 0.03), (0.23, 0.53, -hd + 0.05))):
        block(part, lo, hi, gilt, "-z", "+y", "-y", step=3.0)
    block(part, (-hw + 0.04, 0.6, -hd + 0.04), (hw - 0.04, 0.64, -hd + 0.06), gilt, "-z", "+y", "-y", step=3.0)
    # The lever on the player's right, which is -x for a machine that faces -z.
    part.tube([(-hw + 0.04, 0.8, 0.05), (-hw - 0.04, 0.95, 0.05), (-hw - 0.09, 1.2, 0.05), (-hw - 0.09, 1.5, 0.05)], [0.022] * 4, 6, scaled(c["steelLight"], 1.1))
    part.sphere((-hw - 0.09, 1.56, 0.05), (0.06, 0.06, 0.06), 6, 4, scaled(c["casinoRed"], 1.2))
    return part


def roulette_table(plan):
    """A table with a padded rail, the betting layout on the player's side and the wheel at the far end."""
    part = Part("rouletteTable", frame=GAME)
    c, h = plan.c, plan.height["roulette"]
    hw, hd = plan.size["roulette"]["width"] / 2, plan.size["roulette"]["depth"] / 2
    black, gilt, red = scaled(c["casinoBlack"], 1.5), c["gilt"], c["casinoRed"]
    top, rail = h - 0.07, 0.1
    block(part, (-hw + rail, 0.0, -hd + rail), (hw - rail, top, hd - rail), black, "-z", "+z", "+x", "-x", step=3.0)
    for y in (0.1, top - 0.08):
        block(part, (-hw + rail - 0.02, y, -hd + rail - 0.02), (hw - rail + 0.02, y + 0.04, hd - rail + 0.02), gilt, "-z", "+z", "+x", "-x", "+y", "-y", step=3.0)
    felt = lambda co: scaled(c["casinoFelt"], 0.9 + 0.2 * smoothstep(-hd, hd, co.z))
    flat(part, "+y", top, -hw + rail, hw - rail, -hd + rail, hd - rail, felt, 4, 3)
    for lo, hi in (((-hw, top - 0.06, -hd), (hw, h, -hd + rail)), ((-hw, top - 0.06, hd - rail), (hw, h, hd)),
                   ((-hw, top - 0.06, -hd + rail), (-hw + rail, h, hd - rail)), ((hw - rail, top - 0.06, -hd + rail), (hw, h, hd - rail))):
        block(part, lo, hi, scaled(red, 0.8), "-z", "+z", "+x", "-x", "+y", "-y", step=3.0)
    # The layout: twelve columns of three numbers, alternately red and black, with the zero at the end and a row of outside bets.
    left, right, front, row = -1.0, 0.2, -0.6, 0.16
    pitch = (right - left) / 12
    y = top + 0.004
    flat(part, "+y", y, left - 0.04, right + 0.04, front - 0.04, front + 3 * row + 0.04, gilt)
    for i in range(12):
        for j in range(3):
            tint = scaled(red, 1.25) if (i + j) % 2 == 0 else black
            flat(part, "+y", y + 0.002, left + i * pitch + 0.008, left + (i + 1) * pitch - 0.008, front + j * row + 0.008, front + (j + 1) * row - 0.008, tint)
    flat(part, "+y", y + 0.002, left - 0.1, left - 0.01, front + 0.008, front + 3 * row - 0.008, scaled(c["casinoFelt"], 1.7))
    for k in range(3):
        flat(part, "+y", y + 0.002, left + 4 * k * pitch + 0.008, left + 4 * (k + 1) * pitch - 0.008, front + 3 * row + 0.06, front + 3 * row + 0.2, scaled(c["casinoCream"], 0.85))
    # The wheel: a wooden bowl, the red and black pockets, a steel cone and a gold hub.
    wheel_x, wheel_z, r = 0.68, 0.12, 0.42

    def pockets(co):
        return scaled(red, 1.3) if math.floor(math.atan2(co.y, co.x) / (math.tau / 12)) % 2 == 0 else scaled(c["casinoBlack"], 1.8)

    with part.placed(spun(wheel_x, top, wheel_z)):
        part.lathe(((r, 0.0), (r, 0.09), (r * 0.9, 0.12), (r * 0.82, 0.1)), 16, c["woodDark"])
        part.lathe(((r * 0.82, 0.075), (r * 0.58, 0.055)), 24, pockets, smooth=False)
        part.lathe(((r * 0.58, 0.055), (r * 0.24, 0.1), (r * 0.12, 0.13)), 16, scaled(c["steelLight"], 0.9))
        part.lathe(((r * 0.12, 0.13), (r * 0.09, 0.19), (0.0, 0.22)), 8, gilt)
    part.sphere((wheel_x + r * 0.7, top + 0.075, wheel_z), (0.015, 0.015, 0.015), 5, 3, c["casinoCream"])
    # Stacks of chips on the felt.
    for k, (x, z, tint) in enumerate(((-0.9, 0.3, red), (-0.8, 0.36, c["casinoCream"]), (-0.55, 0.32, gilt), (-0.35, 0.38, c["casinoBlack"]))):
        with part.placed(spun(x, top, z)):
            part.lathe(((0.04, 0.0), (0.04, 0.03 + 0.012 * k), (0.0, 0.03 + 0.012 * k)), 8, scaled(tint, 1.2))
    return part


def scratch_kiosk(plan):
    """A booth: a red cabinet under a black counter, a sloped rack of nine scratch cards and a gold-edged canopy."""
    part = Part("scratchKiosk", frame=GAME)
    c, h = plan.c, plan.height["scratch"]
    hw, hd = plan.size["scratch"]["width"] / 2, plan.size["scratch"]["depth"] / 2
    black, gilt, red = scaled(c["casinoBlack"], 1.4), c["gilt"], c["casinoRed"]
    shaded = lambda co: scaled(red, 0.6 + 0.4 * smoothstep(0.0, 0.9, co.y))
    block(part, (-hw, 0.0, -hd), (hw, 0.9, hd), shaded, "-z", "+z", "+x", "-x", step=3.0)
    block(part, (-hw - 0.01, 0.84, -hd - 0.01), (hw + 0.01, 0.9, hd + 0.01), gilt, "-z", "+z", "+x", "-x", step=3.0)
    block(part, (-hw - 0.02, 0.9, -hd - 0.02), (hw + 0.02, 0.95, hd + 0.02), black, "-z", "+z", "+x", "-x", "+y", "-y", step=3.0)
    # The rack is a wedge: its slope rises from the front of the counter to the back panel.
    foot, rise, run = -0.28, 0.37, 0.28
    prism(part, [(foot, 0.95), (hd - 0.05, 0.95), (hd - 0.05, 0.95 + rise), (foot + run, 0.95 + rise)], -hw + 0.06, hw - 0.06, scaled(c["casinoCream"], 0.8))
    length = math.hypot(run, rise)
    lift_y, lift_z = 0.004 * run / length, -0.004 * rise / length
    cards = (red, gilt, c["casinoNeonCyan"], c["casinoNeonPink"], c["casinoCream"], c["casinoFelt"])
    for column in range(3):
        for row in range(3):
            t0 = 0.08 + 0.3 * row
            x0 = -hw + 0.1 + column * 0.2
            corner = (x0, 0.95 + rise * t0 + lift_y, foot + run * t0 + lift_z)
            part.grid(corner, (0.0, rise * 0.25, run * 0.25), (0.16, 0.0, 0.0), 1, 1, scaled(cards[(column * 2 + row) % len(cards)], 1.1))
    # The back panel and the canopy.
    block(part, (-hw + 0.02, 0.95, hd - 0.05), (hw - 0.02, h - 0.12, hd), black, "-z", "+x", "-x", "+z", step=3.0)
    block(part, (-hw - 0.02, h - 0.12, -hd - 0.02), (hw + 0.02, h, hd + 0.02), gilt, "-z", "+z", "+x", "-x", "+y", "-y", step=3.0)
    panel(part, "-z", -hd - 0.025, -hw + 0.04, hw - 0.04, h - 0.1, h - 0.02, red)
    panel(part, "-z", -hd - 0.03, -hw + 0.08, hw - 0.08, h - 0.07, h - 0.05, c["casinoNeonPink"])
    for x in (-hw + 0.03, hw - 0.03):
        part.tube([(x, 0.95, -hd + 0.06), (x, h - 0.12, -hd + 0.06)], [0.02, 0.02], 6, gilt)
    return part


def build(inputs, out_dir):
    plan = Plan(inputs)
    plain = common.vertex_color_material("casino")
    paving = common.vertex_color_material("casinoPaving")
    carpet = common.textured_material("carpet", os.path.join(SOURCES, "carpet_013_diff.jpg"), os.path.join(SOURCES, "carpet_013_nor_gl.jpg"))
    objects = {
        "casinoWalls": walls(plan).build(plain),
        "casinoFront": front(plan).build(plain),
        "casinoRoof": roof(plan).build(plain),
        "casinoCeiling": ceiling(plan).build(plain),
        "casinoColumns": columns(plan).build(plain),
        "casinoYard": yard(plan).build(paving, crease=False),
        "coastRoad": road(plan).build(paving, crease=False),
        "casinoFloor": floor(plan).build(carpet, crease=False),
    }
    common.bake_vertex_occlusion(list(objects.values()), distance=1.2, samples=40, floor=0.5)
    objects["casinoSign"] = sign(plan).build(plain, crease=False)
    objects["casinoNeon"] = neon(plan).build(plain, crease=False)
    objects["slotCabinet"] = slot_cabinet(plan).build(plain, crease=False)
    objects["rouletteTable"] = roulette_table(plan).build(plain, crease=False)
    objects["scratchKiosk"] = scratch_kiosk(plan).build(plain, crease=False)

    names = inputs["names"]["CASINO_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"casino meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "casino.glb"))
    print("casino triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})


