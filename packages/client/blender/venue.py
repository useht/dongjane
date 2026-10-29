"""venue.glb: the open-air concert stage, its LED screen, the poles of the lantern canopy and one lotus lantern.

Everything is drawn in the game's own coordinates through a Part whose frame is GAME. The stage is
built in its own frame (centre of the deck at the origin, the audience toward +Z) and turned and moved
into place from the layout in the inputs. The lantern is authored at the origin with its hook at the
top; the game hangs one hundred and eighty of them from the strings.
"""

import math
import os

from mathutils import Vector

import common
from common import GAME, Part, at, hash01, mix, rgb, scaled, smoothstep, spun, turned

SPEAKER = (0.9, 1.9, 0.8)
LAMP = (0.28, 0.34, 0.3)
RIGHT = Vector((1.0, 0.0, 0.0))
UP = Vector((0.0, 1.0, 0.0))


class Plan:
    def __init__(self, inputs):
        venue = inputs["venue"]
        self.stage = venue["STAGE"]
        self.screen = venue["SCREEN"]
        self.canopy = venue["CANOPY"]
        self.yaw = venue["STAGE_YAW"]
        self.c = {name: rgb(value) for name, value in inputs["material"].items()}
        self.placing = at(self.stage["x"], 0.0, self.stage["z"]) @ turned(self.yaw)
        self.top = self.screen["bottom"] + self.screen["height"]
        self.half = self.screen["width"] / 2
        self.back = -self.screen["setback"]
        self.tower_x = self.half + 0.45
        self.rig_y = self.top + 0.55
        self.front = self.stage["depth"] / 2 - 1.1


def string_point(plan, a, b, t):
    """The same parabola as stringPoint in venue-layout.ts."""
    canopy = plan.canopy
    (ax, az), (bx, bz) = canopy["poles"][a], canopy["poles"][b]
    return (ax + (bx - ax) * t, canopy["height"] - canopy["sag"] * 4.0 * t * (1.0 - t), az + (bz - az) * t)


def girder(part, start, end, half, up, color, chord=0.04, brace=0.022):
    """A square lattice girder: four chords and a zig-zag brace on the two faces that face along `up`'s cross product."""
    a, b = Vector(start), Vector(end)
    along = (b - a).normalized()
    e1 = up.normalized()
    e2 = along.cross(e1).normalized()
    corners = [(a + e1 * (s1 * half) + e2 * (s2 * half), b + e1 * (s1 * half) + e2 * (s2 * half)) for s1, s2 in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    for p, q in corners:
        part.tube([p, q], [chord, chord], 6, color)
    spans = max(2, round((b - a).length / (4.0 * half)))
    for first, second in ((0, 1), (3, 2)):
        path = []
        for i in range(spans + 1):
            side = corners[first] if i % 2 == 0 else corners[second]
            path.append(side[0].lerp(side[1], i / spans))
        part.tube(path, [brace] * len(path), 5, color)


def stage(plan):
    part = Part("stage", frame=GAME)
    c, s = plan.c, plan.stage
    w, d, h = s["width"], s["depth"], s["height"]
    with part.placed(plan.placing):
        part.box((0.0, h / 2, 0.0), (w, h, d), lambda co: scaled(c["woodDark"], 0.7 + 0.4 * smoothstep(0.0, h, co.y)), skip=("-y",))
        planks = 18
        width = w / planks
        for i in range(planks):
            tint = scaled(c["woodMid"], 0.95 + 0.3 * hash01(i, 0.0, 0.0, 3.0))
            part.grid((-w / 2 + i * width + 0.012, h + 0.004, d / 2), (width - 0.024, 0.0, 0.0), (0.0, 0.0, -d), 1, 1, tint)
        part.box((0.0, h - 0.1, d / 2 + 0.02), (w + 0.08, 0.2, 0.06), c["woodMid"], skip=("-y", "-z"))
        for k in range(3):
            run = 0.45 * (3 - k)
            part.box((0.0, 0.3 * (k + 1) / 2, d / 2 + run / 2), (2.6, 0.3 * (k + 1), run), scaled(c["woodMid"], 1.1 - 0.08 * k), skip=("-y", "-z"))
        for side in (-1.0, 1.0):
            x, z = side * (w / 2 - 0.75), d / 2 - 0.85
            part.box((x, h + SPEAKER[1] / 2, z), SPEAKER, c["steelDark"], skip=("-y",))
            face = z + SPEAKER[2] / 2 + 0.01
            part.grid((x - SPEAKER[0] / 2 + 0.06, h + 0.1, face), (SPEAKER[0] - 0.12, 0.0, 0.0), (0.0, SPEAKER[1] - 0.2, 0.0), 1, 1, scaled(c["steelLight"], 0.45))
            for y, radius in ((h + 0.55, 0.3), (h + 1.35, 0.2)):
                part.radial((x, y, face + 0.01), RIGHT, UP, radius, 1, 10, c["steelDark"], smooth=False)
    return part


def screen(plan):
    """The picture itself: one quad where the video shows. The game paints it."""
    part = Part("screen", frame=GAME)
    with part.placed(plan.placing):
        part.grid((-plan.half, plan.screen["bottom"], plan.back), (plan.screen["width"], 0.0, 0.0), (0.0, plan.screen["height"], 0.0), 1, 1, plan.c["screenBezel"])
    return part


def truss(plan):
    """The two towers the screen hangs between, the rig across the top, the lamps and the screen's black frame."""
    part = Part("truss", frame=GAME)
    c = plan.c
    steel = c["steelLight"]
    deck = plan.stage["height"]
    bottom, top = plan.screen["bottom"], plan.top
    width, height, z = plan.screen["width"], plan.screen["height"], plan.back
    rig, front = plan.rig_y, plan.front
    with part.placed(plan.placing):
        for side in (-1.0, 1.0):
            x = side * plan.tower_x
            girder(part, (x, deck, z), (x, rig + 0.25, z), 0.22, RIGHT, steel)
            girder(part, (x, rig, z), (x, rig, front), 0.22, RIGHT, steel)
            part.box((x, deck + 0.05, z), (0.8, 0.1, 0.8), c["steelDark"], skip=("-y",))
        girder(part, (-plan.tower_x, rig, z), (plan.tower_x, rig, z), 0.22, UP, steel)
        girder(part, (-plan.tower_x, rig, front), (plan.tower_x, rig, front), 0.22, UP, steel)
        frame = 0.14
        for x, y, size in (
            (0.0, top + frame / 2, (width + 2 * frame, frame, 0.12)),
            (0.0, bottom - frame / 2, (width + 2 * frame, frame, 0.12)),
            (-(width / 2 + frame / 2), (bottom + top) / 2, (frame, height, 0.12)),
            (width / 2 + frame / 2, (bottom + top) / 2, (frame, height, 0.12)),
        ):
            part.box((x, y, z - 0.04), size, c["screenBezel"], skip=("-z",))
        for i in range(8):
            x = -plan.tower_x + 0.7 + (2 * plan.tower_x - 1.4) * i / 7
            low = rig - 0.22 - LAMP[1]
            part.box((x, low + LAMP[1] / 2, front), LAMP, c["steelDark"], skip=("+y",))
            part.grid((x - LAMP[0] / 2 + 0.03, low + 0.03, front + LAMP[2] / 2 + 0.01), (LAMP[0] - 0.06, 0.0, 0.0), (0.0, LAMP[1] - 0.06, 0.0), 1, 1, scaled(c["paper"], 0.8))
    return part


def poles(plan):
    """Eleven wooden poles with the cord that carries the lanterns between them."""
    part = Part("poles", frame=GAME)
    c = plan.c
    height = plan.canopy["height"]
    for x, z in plan.canopy["poles"]:
        part.tube(
            [(x, -0.1, z), (x, height, z)],
            [0.1, 0.065],
            8,
            lambda co: mix(c["woodDark"], c["woodMid"], smoothstep(0.0, height, co.y)),
        )
        part.box((x, 0.07, z), (0.55, 0.14, 0.55), mix(c["graniteShade"], c["granite"], 0.4), skip=("-y",))
        part.ellipsoid((x, height + 0.05, z), (0.1, 0.1, 0.1), 8, 5, c["sash"])
    for a, b in plan.canopy["strings"]:
        path = [string_point(plan, a, b, i / 8.0) for i in range(9)]
        part.tube(path, [0.014] * len(path), 4, c["cord"], caps=False)
    return part


def lantern(plan):
    """A paper lotus, 80 triangles, hook at the origin. Near white so each lantern's own colour multiplies it."""
    part = Part("lantern", frame=GAME)
    paper = plan.c["paper"]
    profile = ((0.0, -0.40), (0.07, -0.385), (0.15, -0.31), (0.19, -0.2), (0.16, -0.1), (0.07, -0.05), (0.0, -0.04))

    def petals(height, angle):
        return 1.0 + 0.12 * math.cos(4.0 * angle) * smoothstep(-0.38, -0.2, height)

    with part.placed(spun(0.0, 0.0, 0.0)):
        part.lathe(profile, 8, lambda co: mix(scaled(paper, 0.5), paper, smoothstep(-0.38, -0.2, co.z)), fold=petals)
    return part


def build(inputs, out_dir):
    plan = Plan(inputs)
    material = common.vertex_color_material("venue")
    parts = {"stage": stage(plan), "screen": screen(plan), "truss": truss(plan), "poles": poles(plan), "lantern": lantern(plan)}
    triangles = {name: part.triangles() for name, part in parts.items()}
    objects = {name: part.build(material) for name, part in parts.items()}
    names = inputs["names"]["VENUE_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"venue meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "venue.glb"))
    print("venue triangles:", triangles)
