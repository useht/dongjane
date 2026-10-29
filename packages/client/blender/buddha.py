"""buddha.glb: the seated Buddha, his flaming halo, his lotus throne and the glow behind him.

All four meshes share one origin, the group the game places on the altar, so they are modelled in
game coordinates (Y up, the face toward +Z) through the GAME frame. The face is the one exception:
its features are laid on the skull with rays, so it is modelled in the final authoring space.
"""

import math
import os

from mathutils import Matrix, Vector

import common
from common import GAME, SPIN_Y, Part, at, mix, rgb, scaled, smooth_profile, smoothstep, spun, surface_point

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


def head_point(azimuth, latitude, grow=0.0):
    """A point on the head sphere; azimuth 0 faces the viewer (+Z)."""
    radius = HEAD_RADIUS + grow
    ring = radius * math.cos(latitude)
    return Vector((ring * math.sin(azimuth), HEAD.y + radius * math.sin(latitude), ring * math.cos(azimuth)))


def hairline(azimuth):
    """Latitude where the hair starts: high on the forehead, low at the nape."""
    return 0.62 - 0.74 * smoothstep(0.3, 2.5, abs(azimuth))


def curls(part, mat):
    hair = rgb(mat["buddhaHair"])
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
    gold = rgb(mat["buddhaGold"])
    deep = rgb(mat["buddhaGoldDeep"])
    pale = rgb(mat["buddhaGoldPale"])

    def drape(height, angle):
        band = smoothstep(0.35, 0.8, height) * (1.0 - smoothstep(1.5, 1.9, height))
        return 1.0 + 0.026 * band * math.cos(8.0 * angle)

    def tone(co):
        height = co.z
        ridge = 0.5 + 0.5 * math.cos(8.0 * math.atan2(co.y, co.x))
        base = mix(deep, gold, smoothstep(0.1, 0.6, height))
        base = mix(base, pale, 0.5 * smoothstep(1.5, 1.9, height))
        return scaled(base, 0.9 + 0.1 * ridge)

    profile = smooth_profile(BODY, 3)
    with part.placed(spun(0.0, 0.0, 0.0)):
        part.lathe(profile, 36, tone, fold=drape, squash=SQUASH)

    hem = [(0.97 * math.cos(math.tau * i / 40), 0.3, 0.97 * math.sin(math.tau * i / 40) * SQUASH) for i in range(40)]
    part.tube(hem, [0.085] * 40, 6, deep, up=(0.0, 1.0, 0.0), flat=0.9, closed=True)

    for side in (-1.0, 1.0):
        part.sphere((side * 0.74, 0.4, 0.58), (0.36, 0.2, 0.34), 10, 6, scaled(gold, 0.95))
        part.sphere((side * 0.36, 0.38, 0.9), (0.2, 0.05, 0.25), 8, 4, pale)

    part.sphere((0.0, 0.78, 0.62), (0.3, 0.11, 0.2), 10, 6, pale)
    for side in (-1.0, 1.0):
        part.sphere((side * 0.14, 0.82, 0.7), (0.17, 0.07, 0.12), 8, 5, scaled(pale, 0.97))


def arms(part, mat):
    gold = rgb(mat["buddhaGold"])
    for side in (-1.0, 1.0):
        upper = [(side * 0.66, 1.74, 0.04), (side * 0.74, 1.42, 0.08), (side * 0.77, 1.08, 0.14)]
        part.tube(upper, [0.17, 0.165, 0.15], 8, gold, up=(0.0, 0.0, 1.0), caps=False)
        fore = [(side * 0.77, 1.08, 0.14), (side * 0.6, 0.93, 0.46), (side * 0.3, 0.86, 0.7)]
        part.tube(fore, [0.15, 0.135, 0.11], 8, gold, up=(0.0, 1.0, 0.0), caps=False)
        part.sphere((side * 0.66, 1.74, 0.04), (0.17,) * 3, 10, 6, gold)
        part.sphere((side * 0.77, 1.08, 0.14), (0.152,) * 3, 10, 6, gold)
        part.sphere((side * 0.3, 0.86, 0.7), (0.112,) * 3, 8, 5, gold)


def robe_band(part, mat, body_tree):
    red = rgb(mat["buddhaRobe"])
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
            part.ribbon(first, second, red, toward=lambda c: c + Vector((0.0, -1.0, 0.0)), smooth=True)


def face(part, mat, skull_tree):
    pale = rgb(mat["buddhaGoldPale"])
    lift = 0.003
    middle = Vector((0.0, 0.0, HEAD.y + LIFT))

    def outward(c):
        return c + (c - middle)

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
            crescent(side * 0.135, 2.29, 0.065, 0.016, 0.006, 7, rgb(mat["eye"]))
            crescent(side * 0.14, 2.385, 0.085, -0.014, 0.007, 6, rgb(mat["brow"]))
            hub = point(side * 0.23, 2.17)
            ring = [point(side * 0.23 + 0.05 * math.cos(a), 2.17 + 0.035 * math.sin(a)) for a in (math.tau * i / 8 for i in range(8))]
            faces = part.fan(hub, ring, mix(pale, rgb(mat["blush"]), 0.8), pale)
            part.orient(faces, outward)
        crescent(0.0, 2.075, 0.05, 0.012, 0.004, 5, rgb(mat["mouth"]))
        part.sphere(point(0.0, 2.19, 0.008), (0.034, 0.04, 0.045), 7, 5, scaled(pale, 0.97))
        part.sphere(point(0.0, 2.455, 0.003), (0.03, 0.02, 0.03), 7, 4, rgb(mat["buddhaUrna"]))


def head(part, mat):
    pale = rgb(mat["buddhaGoldPale"])
    gold = rgb(mat["buddhaGold"])
    part.sphere(HEAD, (HEAD_RADIUS,) * 3, 24, 16, pale)
    part.sphere((0.0, 2.66, 0.0), (0.17, 0.17 * 0.9, 0.17), 12, 8, pale)
    curls(part, mat)
    for side in (-1.0, 1.0):
        ear = [(side * 0.4, 2.42, -0.02), (side * 0.43, 2.2, 0.0), (side * 0.42, 1.92, 0.03)]
        part.tube(ear, [0.05, 0.07, 0.035], 6, scaled(pale, 0.96), up=(1.0, 0.0, 0.0), flat=0.7)
    part.sphere((0.0, 1.98, 0.0), (0.2, 0.18, 0.2), 10, 6, gold)

    scratch = Part("skull", frame=GAME @ at(0.0, LIFT, 0.0))
    scratch.sphere(HEAD, (HEAD_RADIUS,) * 3, 24, 16, pale)
    tree = scratch.raycaster()
    face(part, mat, tree)
    scratch.bm.free()


def figure(mat):
    part = Part("figure", frame=GAME @ at(0.0, LIFT, 0.0))
    body(part, mat)
    arms(part, mat)
    head(part, mat)
    scratch = Part("torso", frame=GAME @ at(0.0, LIFT, 0.0))
    with scratch.placed(spun(0.0, 0.0, 0.0)):
        scratch.lathe(smooth_profile(BODY, 3), 36, (1.0, 1.0, 1.0), squash=SQUASH)
    robe_band(part, mat, scratch.raycaster())
    scratch.bm.free()
    return part


def halo(mat):
    gold = rgb(mat["buddhaGold"])
    pale = rgb(mat["buddhaGoldPale"])
    deep = rgb(mat["buddhaGoldDeep"])
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
    return part


def lotus(mat):
    pale, deep = rgb(mat["petal"]), rgb(mat["petalDeep"])
    base = rgb(mat["buddhaGoldDeep"])
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
            color = lambda co, root=root, tip=tip: mix(root, tip, smoothstep(r0, r1, math.hypot(co.x, co.z / SQUASH)))  # noqa: E731
            part.tube(path, [0.0, 0.17, 0.24, 0.16, 0.0], 5, color, up=normal, flat=0.28)
    profile = ((1.3, -0.45), (1.3, -0.4), (1.14, -0.33), (1.06, -0.3), (1.12, -0.22), (1.12, -0.15), (0.9, -0.12))
    with part.placed(spun(0.0, 0.0, 0.0) @ Matrix.Diagonal((1.0, SQUASH, 1.0, 1.0))):
        part.lathe(profile, 16, lambda co: scaled(base, 0.85 + 0.3 * smoothstep(-0.45, -0.12, co.z)), cap_bottom=True)
    return part


def glow(mat, scene):
    core = rgb(scene["flameCore"])
    middle = rgb(scene["flameMid"])
    edge = rgb(scene["flameEdge"])
    part = Part("glow", frame=GAME @ at(*GLOW_AT))

    def spot(co):
        d = min(co.length / GLOW_RADIUS, 1.0)
        tint = mix(core, middle, smoothstep(0.0, 0.3, d))
        tint = mix(tint, edge, smoothstep(0.3, 1.0, d))
        alpha = 1.0 - 0.3 * smoothstep(0.0, 0.3, d) - 0.7 * smoothstep(0.3, 1.0, d)
        return scaled(tint, alpha)

    part.radial((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), GLOW_RADIUS, 6, 24, spot)
    return part


def build(inputs, out_dir):
    mat, scene = inputs["material"], inputs["scene"]
    solid = {"figure": figure(mat), "lotus": lotus(mat), "halo": halo(mat)}
    material = common.vertex_color_material("buddha")
    objects = {name: part.build(material, crease=False) for name, part in solid.items()}
    common.bake_vertex_occlusion(list(objects.values()), distance=0.35, samples=64, floor=0.5)
    objects["glow"] = glow(mat, scene).build(material, crease=False)
    names = inputs["names"]["BUDDHA_MESHES"]
    if sorted(objects) != sorted(names):
        raise RuntimeError(f"buddha meshes {sorted(objects)} differ from the contract {sorted(names)}")
    common.export_glb([objects[name] for name in names], os.path.join(out_dir, "buddha.glb"))
    print("buddha triangles:", {name: sum(len(p.vertices) - 2 for p in obj.data.polygons) for name, obj in objects.items()})
