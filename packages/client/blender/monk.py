"""monk.glb: nine parts of the little monk, each with its origin on the joint it hangs from.

The game animates the parts as a hierarchy (hips > torso > head/shoulders > elbows > hands, feet on
the root), so each part is modelled around its own pivot: the head at the neck, the torso and skirt
at the hips, the sleeves at the shoulder and elbow, the hand at the wrist, the foot at the ankle.
Robe parts are near-white with the folds baked into their vertex colour; the game tints them per
monk with an instance colour.
"""

import math
import os

from mathutils import Vector

import common
from common import Part, interpolate, mix, rgb, scaled, smoothstep, surface_point

HEAD_CENTER = Vector((0.0, 0.0, 0.23))
HEAD_RADII = (0.205, 0.2, 0.21)
TORSO_PROFILE = (  # (radius, height as a fraction of the torso)
    (0.19, 0.0),
    (0.186, 0.13),
    (0.172, 0.37),
    (0.158, 0.605),
    (0.152, 0.79),
    (0.148, 0.91),
    (0.125, 1.005),
    (0.085, 1.073),
    (0.0, 1.116),
)


def outward_from_axis(centre):
    return centre + Vector((centre.x, centre.y, 0.0))


def outward_from(origin):
    return lambda centre: centre + (centre - origin)


def robe_shade(angle, rise, folds):
    """Fold shading in [0.78, 1.0]: lighter on the ridges and toward the top."""
    ridge = 0.5 + 0.5 * math.cos(folds * angle)
    return 0.78 + 0.10 * rise + 0.12 * ridge


def head_and_face(mat):
    skin = rgb(mat["skin"])

    def skin_tone(height):
        return scaled(skin, 0.86 + 0.14 * smoothstep(0.02, 0.2, height))

    def skull(part):
        part.sphere(HEAD_CENTER, HEAD_RADII, 20, 14, lambda co: skin_tone(co.z))

    scratch = Part("skull")
    skull(scratch)
    tree = scratch.raycaster()

    head = Part("head")
    skull(head)
    for side in (-1.0, 1.0):
        head.sphere((side * 0.2, -0.01, 0.235), (0.03, 0.04, 0.056), 7, 5, scaled(skin, 0.95))
    head.lathe(((0.068, -0.03), (0.06, 0.07)), 10, scaled(skin, 0.8))

    face = Part("face")
    lift = 0.003
    outward = outward_from(HEAD_CENTER)

    def crescent(cx, cz, half_width, sag, thickness, points, color):
        upper, lower = [], []
        for i in range(points):
            u = -1.0 + 2.0 * i / (points - 1)
            z = cz - sag * (1.0 - u * u)
            t = thickness * math.sqrt(1.0 - u * u) + 0.0008
            upper.append(surface_point(tree, cx + u * half_width, z + t, lift))
            lower.append(surface_point(tree, cx + u * half_width, z - t, lift))
        face.ribbon(lower, upper, color, toward=outward)

    for side in (-1.0, 1.0):
        crescent(side * 0.07, 0.218, 0.032, 0.012, 0.0055, 7, rgb(mat["eye"]))
    crescent(0.0, 0.142, 0.026, 0.007, 0.0022, 5, rgb(mat["mouth"]))

    for side in (-1.0, 1.0):
        cx, cz = side * 0.115, 0.168
        hub = surface_point(tree, cx, cz, lift)
        ring = [
            surface_point(tree, cx + 0.036 * math.cos(a), cz + 0.025 * math.sin(a), lift)
            for a in (math.tau * i / 8 for i in range(8))
        ]
        faces = face.fan(hub, ring, mix(skin_tone(cz), rgb(mat["blush"]), 0.85), skin_tone(cz))
        face.orient(faces, outward)

    for x, y in ((-0.032, 0.03), (0.032, 0.03), (0.0, 0.082)):
        hit = tree.ray_cast(Vector((x, y, 2.0)), Vector((0.0, 0.0, -1.0)))
        face.sphere(hit[0], (0.0105, 0.0105, 0.0105), 5, 3, rgb(mat["brow"]))

    scratch.bm.free()
    return head, face


def skirt(rig, mat):
    drop = rig["SKIRT_DROP"]
    robe = rgb(mat["robe"])
    part = Part("skirt")

    def rise(height):
        return (height + drop) / drop

    def pleat(height, angle):
        return 1.0 + 0.045 * (1.0 - rise(height)) * math.cos(6.0 * angle)

    def tone(co):
        return scaled(robe, robe_shade(math.atan2(co.y, co.x), rise(co.z), 6.0))

    profile = ((0.272, -1.0), (0.25, -0.667), (0.215, -0.333), (0.183, -0.111), (0.17, 0.0))
    part.lathe(tuple((radius, drop * f) for radius, f in profile), 24, tone, fold=pleat)
    return part


def torso(rig, mat):
    height = rig["TORSO_HEIGHT"]
    robe = rgb(mat["robe"])
    part = Part("torso")

    def tone(co):
        return scaled(robe, robe_shade(math.atan2(co.y, co.x), co.z / height, 5.0))

    part.lathe(tuple((radius, height * f) for radius, f in TORSO_PROFILE), 20, tone)
    return part


def torso_radius(rig, z):
    return interpolate(tuple((radius, rig["TORSO_HEIGHT"] * f) for radius, f in TORSO_PROFILE), z)


def trim(rig, mat):
    height = rig["TORSO_HEIGHT"]
    sash = rgb(mat["sash"])
    collar = rgb(mat["collar"])
    part = Part("trim")

    band = ((0.005, 0.004), (0.02, 0.012), (0.05, 0.013), (0.077, 0.004))
    part.lathe(
        tuple((torso_radius(rig, z) + grow, z) for z, grow in band),
        20,
        lambda co: scaled(sash, 0.82 + 0.18 * (1.0 - abs(co.z - 0.041) / 0.036)),
    )

    knot_y = torso_radius(rig, 0.045) + 0.018
    part.sphere((0.0, knot_y, 0.045), (0.028, 0.02, 0.026), 7, 5, scaled(sash, 0.92), smooth=True)
    for side in (-1.0, 1.0):
        top = Vector((side * 0.008, knot_y + 0.006, 0.032))
        end = Vector((side * 0.03, knot_y + 0.026, -0.075))
        across = Vector((0.011, 0.0, 0.0))
        part.ribbon(
            [top - across, (top + end) / 2 - across * 1.2, end - across * 1.4],
            [top + across, (top + end) / 2 + across * 1.2, end + across * 1.4],
            scaled(sash, 0.8),
            toward=lambda centre: centre + Vector((0.0, 1.0, 0.0)),
        )

    ring_low, ring_high = height + 0.008, height + 0.03
    part.lathe(
        tuple((torso_radius(rig, z) + 0.004, z) for z in (ring_low, ring_high)),
        20,
        scaled(collar, 0.97),
    )

    top, bottom, half = ring_low + 0.008, 0.2, 0.012
    for side, lift in ((-1.0, 0.0055), (1.0, 0.0085)):
        left, right = [], []
        for i in range(5):
            t = i / 4.0
            x = side * (0.05 - 0.1 * t)
            z = top - (top - bottom) * t
            for edge, dz in ((left, half), (right, -half)):
                y = math.sqrt(max(torso_radius(rig, z + dz) ** 2 - x * x, 1e-6)) + lift
                edge.append(Vector((x, y, z + dz)))
        part.ribbon(left, right, collar, toward=outward_from_axis)
    return part


def sleeve_upper(rig, mat):
    reach = rig["UPPER_ARM"]
    robe = rgb(mat["robe"])
    part = Part("sleeveUpper")

    def tone(co):
        return scaled(robe, robe_shade(math.atan2(co.y, co.x), (co.z + reach) / (reach + 0.07), 3.0))

    profile = ((0.086, -reach), (0.079, -reach * 0.64), (0.073, -reach * 0.28), (0.07, 0.0), (0.058, 0.038), (0.03, 0.062), (0.0, 0.07))
    part.lathe(profile, 10, tone)
    return part


def sleeve_lower(rig, mat):
    reach = rig["FORE_ARM"] + 0.01
    robe = rgb(mat["robe"])
    part = Part("sleeveLower")

    def tone(co):
        hem = smoothstep(-reach, -reach + 0.03, co.z)
        return scaled(robe, (0.9 + 0.1 * hem) * robe_shade(math.atan2(co.y, co.x), (co.z + reach) / reach, 3.0))

    profile = ((0.112, -reach), (0.102, -reach * 0.7), (0.092, -reach * 0.3), (0.085, 0.005))
    part.lathe(profile, 10, tone)
    return part


def hand(rig, mat):
    skin = rgb(mat["skin"])
    part = Part("hand")
    part.sphere((0.0, 0.0, -0.012), (0.046, 0.046, 0.046), 8, 6, lambda co: scaled(skin, 0.9 + 0.1 * smoothstep(-0.05, 0.03, co.z)))
    return part


def foot(rig, mat):
    sandal = rgb(mat["sandal"])
    cord = rgb(mat["sandalCord"])
    sock = rgb(mat["collar"])
    floor = -rig["FOOT_Y"]
    part = Part("foot")
    part.sphere((0.0, 0.035, floor + 0.014), (0.05, 0.095, 0.014), 8, 4, lambda co: mix(cord, sandal, smoothstep(floor + 0.008, floor + 0.026, co.z)))
    part.sphere((0.0, 0.02, floor + 0.04), (0.04, 0.075, 0.034), 8, 5, lambda co: scaled(sock, 0.88 + 0.12 * smoothstep(floor + 0.02, floor + 0.07, co.z)))
    return part


def build(inputs, out_dir):
    rig, mat = inputs["monk"], inputs["material"]
    head, face = head_and_face(mat)
    parts = {
        "head": head,
        "face": face,
        "skirt": skirt(rig, mat),
        "torso": torso(rig, mat),
        "trim": trim(rig, mat),
        "sleeveUpper": sleeve_upper(rig, mat),
        "sleeveLower": sleeve_lower(rig, mat),
        "hand": hand(rig, mat),
        "foot": foot(rig, mat),
    }
    names = inputs["names"]["MONK_PARTS"]
    if sorted(parts) != sorted(names):
        raise RuntimeError(f"monk parts {sorted(parts)} differ from the contract {sorted(names)}")

    material = common.vertex_color_material("monk")
    triangles = {name: parts[name].triangles() for name in names}
    objects = [parts[name].build(material) for name in names]
    common.export_glb(objects, os.path.join(out_dir, "monk.glb"))
    print("monk triangles per part:", triangles)
