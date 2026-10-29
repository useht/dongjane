"""Builds the child-monk (동자승) model from scratch. Every monk in the game shares this one model.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python packages/client/assets/monk/build_monk.py
    (add "-- --no-render" after the script to skip the preview PNGs)

Writes next to this script:
    monk.blend      editable source. Parts sit at their pivots in the hidden "monk_parts" collection; the visible
                    "monk_pose_standing" collection holds linked copies in rest pose, so editing either edits both.
                    To re-export by hand: unhide monk_parts, make it the active collection, glTF export with
                    "Active Collection" ticked, Vertex Color = Material.
    monk.glb        what the game loads (Y-up; the face ends up on three.js -Z)
    monk-rig.json   pivot and length numbers the TypeScript rig reads (generated from the same config below)
and previews to <temp>/monk-preview/ (or $MONK_PREVIEW_DIR; never into the repo).

Parts (one mesh object each, named exactly like the slot in monk-model.ts), each built in the local frame of its pivot:
    head, face, hair, torso, skirt, trim, sleeveUpper, sleeveLower, hand, foot
sleeveUpper, sleeveLower, hand and foot are mirror-symmetric about x = 0 because one geometry serves both sides.
Robe parts (torso, skirt, sleeveUpper, sleeveLower) stay white; the game tints them per monk.
Colours are written to the "Col" vertex-colour layer from PALETTE, and the materials read that layer.

Blender axes: X right, Y forward (the face looks toward +Y), Z up. glTF export maps (x, y, z) -> (x, z, -y).

Reference: docs/reference/49DtAu-RvqVtsi3b5ODbtr6LQbpRq8uM3b9jFR4l1rBky5vgfMbhJmDlxTzJwF5o9UbmmEeVHSI4bOg9L1MlCg.webp
(seated stone Buddha, low camera angle). H = crown to chin = 125 px in the 1000x750 photo. Measured, in H:
    head width incl. ears      0.76     (face at the cheeks 0.67)
    shoulder breadth, outer    1.60
    neck (chin to shoulder line)  0.10
    chin to front of lap       1.14     (foreshortened by the low camera; 1.40 used, see chin_to_hip)
    crown to seat base         2.97
    eye line below crown       0.49, nose base 0.68, mouth 0.77
"""

import bmesh
import bpy
import colorsys
import json
import math
import os
import sys
import tempfile
import warnings
from math import atan2, cos, pi, radians, sin, sqrt
from mathutils import Euler, Matrix, Vector

# ----------------------------------------------------------------------------------------------------------------------
# CONFIG - change numbers here and rebuild. Lengths are scene units (1 unit = the game's world unit).
# ----------------------------------------------------------------------------------------------------------------------

HEAD_H = 0.32  # crown to chin; the unit of every ratio below. Kneeling crown height = 3.0 H, like the reference.

RATIO = {  # in units of HEAD_H, measured from the reference
    "head_width": 0.78,  # skull plus ears
    "head_depth": 0.80,
    "shoulder_breadth": 1.55,  # outer edge to outer edge, sleeves included
    "neck": 0.12,  # chin down to the base of the neck
    "chin_to_hip": 1.40,  # chin down to the hip pivot (waist belt sits just above it)
}

RIG = {  # pivots and lengths the animation code uses
    "hipStand": 0.40,
    "hipKneel": 0.20,
    "skirtDrop": 0.36,
    "shoulderX": 0.18,
    "shoulderDrop": 0.06,  # shoulder joint below the neck base
    "upperArm": 0.18,
    "foreArm": 0.17,
    "footX": 0.09,
    "footY": 0.045,
}

FACE = {  # heights are fractions of HEAD_H above the chin, x is a distance from the centre line
    "eye_f": 0.47,
    "eye_x": 0.058,
    "eye_radii": (0.0175, 0.011, 0.0225),
    "cheek_f": 0.29,
    "cheek_x": 0.078,
    "cheek_radii": (0.030, 0.010, 0.022),
    "nose_f": 0.33,
    "nose_radii": (0.016, 0.016, 0.013),
    "mouth_f": 0.185,
    "mouth_halfwidth": 0.03,
    "mouth_radius": 0.0042,
    "jaw_taper": 0.14,  # how much the skull narrows toward the chin
    "ear_f": 0.42,
    "ear_radii": (0.0085, 0.020, 0.030),
    "ear_out": 0.012,  # how far an ear sticks out of the skull
}

HAIR = {  # shaved head: a barely visible stubble cap on the skin-coloured scalp
    "enabled": True,
    "thickness": 0.0045,
    "hairline_front_f": 0.72,
    "hairline_side_f": 0.62,
    "hairline_back_f": 0.42,
    "crown_marks": True,  # three tiny ordination dots
}

OUTFIT = {
    "belt_knot": True,
    "collar_ring": True,
    "sash": True,  # the cream V of the crossed collar
    "sash_width": 0.026,
}

PALETTE = {  # sRGB hex
    "skin": 0xF3CBA2,
    "robe": 0xFFFFFF,  # white on purpose: tinted at runtime
    "gold": 0xC99A3A,
    "cream": 0xF6ECD2,
    "sock": 0xF4EEE0,
    "eye": 0x2B1A12,
    "cheek": 0xF0948A,
    "mouth": 0x9A4A3C,
    "nose": 0xE8AE8C,
    "stubble": 0xE8C19B,
    "mark": 0xA67F60,
}

SEGMENTS = {"head": 20, "torso": 20, "skirt": 24, "belt": 24, "sleeve": 12, "hand": 10, "foot": 10}

PREVIEW_HUE = 150  # degrees, only used for the preview renders
PREVIEW_SIZE = (480, 640)

# ----------------------------------------------------------------------------------------------------------------------
# Derived numbers
# ----------------------------------------------------------------------------------------------------------------------

H = HEAD_H
NECK_LEN = RATIO["neck"] * H
TORSO_H = RATIO["chin_to_hip"] * H - NECK_LEN
NECK_Y = TORSO_H
SHOULDER_Y = TORSO_H - RIG["shoulderDrop"]
SHOULDER_R = RATIO["shoulder_breadth"] * H / 2 - RIG["shoulderX"]  # sleeve radius at the shoulder joint

CHIN_Z = NECK_LEN  # head frame: origin at the base of the neck
CROWN_Z = NECK_LEN + H
SKULL_A = H / 2
SKULL_ZC = CHIN_Z + SKULL_A
SKULL_RX = (RATIO["head_width"] * H - 2 * FACE["ear_out"]) / 2
SKULL_RY = RATIO["head_depth"] * H / 2
SKULL_CY = 0.02  # the skull sits a little forward of the neck, which also keeps the face and hair on the front side

COLOR_LAYER = "Col"
HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW_DIR = os.environ.get("MONK_PREVIEW_DIR") or os.path.join(tempfile.gettempdir(), "monk-preview")
PART_ORDER = ["head", "face", "hair", "torso", "skirt", "trim", "sleeveUpper", "sleeveLower", "hand", "foot"]
SYMMETRIC_PARTS = ["sleeveUpper", "sleeveLower", "hand", "foot"]
COPIES = {"sleeveUpper": 2, "sleeveLower": 2, "hand": 2, "foot": 2}

# ----------------------------------------------------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------------------------------------------------


def srgb_to_linear(hex_value):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = ((hex_value >> 16) & 255) / 255, ((hex_value >> 8) & 255) / 255, (hex_value & 255) / 255
    return (lin(r), lin(g), lin(b), 1.0)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth_pow(c, p):
    return math.copysign(abs(c) ** (2.0 / p), c)


def ring_xy(cx, cy, z, rx, ry, n, power=2.0, phase=0.0):
    pts = []
    for k in range(n):
        a = phase + 2 * pi * k / n
        pts.append(Vector((cx + rx * smooth_pow(cos(a), power), cy + ry * smooth_pow(sin(a), power), z)))
    return pts


def euler_matrix(rot):
    return Euler(rot, "XYZ").to_matrix().to_4x4()


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.keys = []

    def slot(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, verts, key):
        f = self.bm.faces.new(verts)
        f.material_index = self.slot(key)
        f.smooth = True
        return f

    def loft(self, rings, key, cap_first=None, cap_last=None):
        """Rings run bottom to top, counter-clockwise seen from above (stacked along +Z), so normals face outward.
        cap_first / cap_last: True for a fan to the ring average, or a Vector for an explicit pole."""
        bm = self.bm
        vr = [[bm.verts.new(p) for p in ring] for ring in rings]
        n = len(vr[0])
        for i in range(len(vr) - 1):
            for j in range(n):
                k = (j + 1) % n
                self.face([vr[i][j], vr[i][k], vr[i + 1][k], vr[i + 1][j]], key)
        for ring, cap, up in ((vr[0], cap_first, False), (vr[-1], cap_last, True)):
            if cap is None or cap is False:
                continue
            centre = cap if isinstance(cap, Vector) else sum((v.co for v in ring), Vector()) / n
            c = bm.verts.new(centre)
            for j in range(n):
                k = (j + 1) % n
                self.face([c, ring[j], ring[k]] if up else [c, ring[k], ring[j]], key)
        return vr

    def ellipsoid(self, centre, radii, key, rot=(0.0, 0.0, 0.0), u=10, v=6):
        m = Matrix.Translation(centre) @ euler_matrix(rot) @ Matrix.Diagonal(Vector((*radii, 1.0)))
        made = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=1.0, matrix=m)
        faces = {f for vert in made["verts"] for f in vert.link_faces}
        for f in faces:
            f.material_index = self.slot(key)
            f.smooth = True

    def to_object(self, crease_deg=55.0):
        bm = self.bm
        sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > radians(crease_deg)]
        if sharp:
            bmesh.ops.split_edges(bm, edges=sharp)
        mesh = bpy.data.meshes.new(self.name + "_mesh")
        bm.to_mesh(mesh)
        bm.free()
        for key in self.keys:
            mesh.materials.append(material(key))
        bake_colors(mesh, self.keys)
        obj = bpy.data.objects.new(self.name, mesh)
        return obj


MATERIALS = {}


def material(key):
    if key in MATERIALS:
        return MATERIALS[key]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        mat = bpy.data.materials.new("monk_" + key)
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    layer = nodes.new("ShaderNodeVertexColor")
    layer.layer_name = COLOR_LAYER
    mat.node_tree.links.new(layer.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    mat.diffuse_color = srgb_to_linear(PALETTE[key])
    mat["palette_hex"] = "#%06x" % PALETTE[key]
    MATERIALS[key] = mat
    return mat


def bake_colors(mesh, keys):
    attr = mesh.color_attributes.new(COLOR_LAYER, "FLOAT_COLOR", "CORNER")
    for poly in mesh.polygons:
        colour = srgb_to_linear(PALETTE[keys[poly.material_index]])
        for li in poly.loop_indices:
            attr.data[li].color = colour
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = mesh.color_attributes.find(COLOR_LAYER)


# ----------------------------------------------------------------------------------------------------------------------
# Head, face, hair (frame: origin at the base of the neck, +Z up, face toward +Y)
# ----------------------------------------------------------------------------------------------------------------------


def skull_at(t):
    """Latitude t (-pi/2 chin ... pi/2 crown) -> (z, half-width, half-depth) of the skull cross-section."""
    s, c = sin(t), max(cos(t), 0.0)
    below = (-s) ** 1.5 if s < 0 else 0.0
    z = SKULL_ZC + SKULL_A * s
    rx = SKULL_RX * c**0.9 * (1.0 - FACE["jaw_taper"] * below)
    ry = SKULL_RY * c**0.9 * (1.0 - 0.6 * FACE["jaw_taper"] * below)
    return z, rx, ry


def skull_front(x, z):
    """y of the skull surface in front at (x, z), plus the outward normal angle about Z."""
    t = math.asin(clamp((z - SKULL_ZC) / SKULL_A, -0.999, 0.999))
    _, rx, ry = skull_at(t)
    xn = clamp(abs(x) / rx, 0.0, 0.999)
    y = SKULL_CY + ry * sqrt(1 - xn * xn)
    nx, ny = x / rx**2, (y - SKULL_CY) / ry**2
    return y, atan2(-nx, ny)


def face_z(fraction):
    return CHIN_Z + fraction * H


def build_head():
    p = Part("head")
    n = SEGMENTS["head"]
    lats = 12
    rings = []
    for i in range(1, lats):
        t = -pi / 2 + pi * i / lats
        z, rx, ry = skull_at(t)
        rings.append(ring_xy(0.0, SKULL_CY, z, rx, ry, n))
    p.loft(rings, "skin", cap_first=Vector((0.0, SKULL_CY, CHIN_Z)), cap_last=Vector((0.0, SKULL_CY, CROWN_Z)))

    neck = [ring_xy(0.0, 0.004, z, r, r, 12) for z, r in ((-0.025, 0.056), (0.0, 0.052), (CHIN_Z + 0.02, 0.05))]
    p.loft(neck, "skin")

    ex = SKULL_RX
    for side in (-1, 1):
        z = face_z(FACE["ear_f"])
        t = math.asin(clamp((z - SKULL_ZC) / SKULL_A, -0.999, 0.999))
        _, rx, ry = skull_at(t)
        y, _ = skull_front(side * rx * 0.97, z)
        centre = Vector((side * (rx + FACE["ear_out"] - FACE["ear_radii"][0] * 0.9), SKULL_CY - 0.012, z))
        p.ellipsoid(centre, FACE["ear_radii"], "skin", rot=(0, 0, side * radians(-14)), u=8, v=6)
    return p.to_object()


def build_face():
    p = Part("face")
    for side in (-1, 1):
        x = side * FACE["eye_x"]
        z = face_z(FACE["eye_f"])
        y, ang = skull_front(x, z)
        p.ellipsoid(Vector((x, y - 0.003, z)), FACE["eye_radii"], "eye", rot=(0, 0, ang), u=8, v=6)

        x = side * FACE["cheek_x"]
        z = face_z(FACE["cheek_f"])
        y, ang = skull_front(x, z)
        p.ellipsoid(Vector((x, y - 0.004, z)), FACE["cheek_radii"], "cheek", rot=(0, 0, ang), u=8, v=6)

    z = face_z(FACE["nose_f"])
    y, _ = skull_front(0.0, z)
    p.ellipsoid(Vector((0.0, y - 0.003, z)), FACE["nose_radii"], "nose", u=8, v=6)

    # a small smile: a short tube bent along an arc, lying on the skull surface
    z0 = face_z(FACE["mouth_f"])
    hw = FACE["mouth_halfwidth"]
    r = FACE["mouth_radius"]
    pts = []
    steps = 7
    for i in range(steps):
        u = -1 + 2 * i / (steps - 1)
        x = hw * u
        z = z0 + 0.0075 * u * u
        y, ang = skull_front(x, z)
        pts.append((Vector((x, y - 0.0005, z)), ang))
    sides = 5
    ring_list = []
    for pt, ang in pts:
        ring = []
        for k in range(sides):
            a = 2 * pi * k / sides
            local = Vector((r * cos(a), r * sin(a) * 0.7, 0.0))
            rot = Euler((0, 0, ang), "XYZ").to_matrix()
            ring.append(pt + rot @ Vector((local.x, local.y, 0)) + Vector((0, 0, 0)))
        ring_list.append(ring)
    mouth_rings(p, ring_list)
    return p.to_object()


def mouth_rings(p, rings):
    """Connect tube rings that are stacked sideways (along x); winding chosen so the outside faces out."""
    bm = p.bm
    vr = [[bm.verts.new(v) for v in ring] for ring in rings]
    n = len(vr[0])
    for i in range(len(vr) - 1):
        for j in range(n):
            k = (j + 1) % n
            p.face([vr[i][k], vr[i][j], vr[i + 1][j], vr[i + 1][k]], "mouth")
    for ring, flip in ((vr[0], False), (vr[-1], True)):
        centre = sum((v.co for v in ring), Vector()) / n
        c = bm.verts.new(centre)
        for j in range(n):
            k = (j + 1) % n
            p.face([c, ring[k], ring[j]] if flip else [c, ring[j], ring[k]], "mouth")


def build_hair():
    p = Part("hair")
    if not HAIR["enabled"]:
        return p.to_object()
    n = SEGMENTS["head"]
    thick = HAIR["thickness"]
    t_front = math.asin((HAIR["hairline_front_f"] - 0.5) * 2)
    t_side = math.asin((HAIR["hairline_side_f"] - 0.5) * 2)
    t_back = math.asin((HAIR["hairline_back_f"] - 0.5) * 2)
    steps = 5
    top_t = radians(78)

    def shell_point(a, t, off):
        z, rx, ry = skull_at(t)
        x, y = rx * cos(a), ry * sin(a)
        zc = z - SKULL_ZC
        sx, sy, sz = 1 + off / SKULL_RX, 1 + off / SKULL_RY, 1 + off / SKULL_A
        return Vector((x * sx, SKULL_CY + y * sy, SKULL_ZC + zc * sz))

    rings = []
    for i in range(steps):
        ring = []
        for k in range(n):
            a = 2 * pi * k / n
            s = sin(a)
            low = lerp(t_side, t_front, s**1.4) if s > 0 else lerp(t_side, t_back, -s)
            t = lerp(low, top_t, i / (steps - 1))
            off = lerp(0.0015, thick, clamp(i / 1.5, 0.0, 1.0))
            ring.append(shell_point(a, t, off))
        rings.append(ring)
    pole = Vector((0.0, SKULL_CY, CROWN_Z + thick))
    p.loft(rings, "stubble", cap_last=pole)

    if HAIR["crown_marks"]:
        for x, y in ((-0.03, SKULL_CY + 0.012), (0.03, SKULL_CY + 0.012), (0.0, SKULL_CY - 0.032)):
            q = 1 - (x / SKULL_RX) ** 2 - ((y - SKULL_CY) / SKULL_RY) ** 2
            z = SKULL_ZC + SKULL_A * sqrt(max(q, 0.0)) + thick - 0.0015
            p.ellipsoid(Vector((x, y, z)), (0.0085, 0.0085, 0.0035), "mark", u=8, v=4)
    return p.to_object()


# ----------------------------------------------------------------------------------------------------------------------
# Robe (frame: origin at the hip pivot)
# ----------------------------------------------------------------------------------------------------------------------

TORSO_PROFILE = [  # z, half-width, half-depth, superellipse power
    (0.000, 0.172, 0.142, 2.3),
    (0.060, 0.160, 0.133, 2.3),
    (0.180, 0.172, 0.138, 2.4),
    (0.290, 0.192, 0.138, 2.6),
    (TORSO_H - 0.080, 0.194, 0.128, 2.8),
    (TORSO_H - 0.050, 0.166, 0.114, 2.5),
    (TORSO_H - 0.024, 0.116, 0.088, 2.2),
    (TORSO_H, 0.068, 0.066, 2.0),
]


def torso_at(z):
    prof = TORSO_PROFILE
    z = clamp(z, prof[0][0], prof[-1][0])
    for (z0, w0, d0, p0), (z1, w1, d1, p1) in zip(prof, prof[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            return lerp(w0, w1, t), lerp(d0, d1, t), lerp(p0, p1, t)
    return prof[-1][1:]


def torso_front(x, z):
    hw, hd, power = torso_at(z)
    xn = clamp(abs(x) / hw, 0.0, 0.999)
    return hd * (1 - xn**power) ** (1 / power)


def build_torso():
    p = Part("torso")
    n = SEGMENTS["torso"]
    rings = [ring_xy(0.0, 0.0, z, w, d, n, power) for z, w, d, power in TORSO_PROFILE]
    p.loft(rings, "robe", cap_first=True, cap_last=True)
    return p.to_object()


def build_skirt():
    p = Part("skirt")
    n = SEGMENTS["skirt"]
    drop = RIG["skirtDrop"]
    folds = 6
    stations = [  # z, half-width, half-depth, fold amplitude
        (-drop, 0.268, 0.258, 0.0),
        (-drop + 0.004, 0.2755, 0.2655, 0.0),
        (-drop + 0.016, 0.2745, 0.2635, 0.012),
        (-0.30, 0.262, 0.246, 0.011),
        (-0.22, 0.240, 0.222, 0.009),
        (-0.12, 0.208, 0.188, 0.006),
        (-0.04, 0.184, 0.158, 0.003),
        (0.0, 0.176, 0.146, 0.0),
    ]
    rings = []
    for z, w, d, amp in stations:
        ring = []
        for k in range(n):
            a = 2 * pi * k / n
            wob = 1 + amp * cos(folds * a) / max(w, 1e-6) * 3
            ring.append(Vector((w * wob * cos(a), d * wob * sin(a), z)))
        rings.append(ring)
    inner = ring_xy(0.0, 0.0, -drop + 0.012, 0.25, 0.24, n)
    p.loft([inner] + rings, "robe")
    return p.to_object()


def build_trim():
    p = Part("trim")
    n = SEGMENTS["belt"]
    z0 = 0.004
    belt = []
    for z, grow in ((z0, 0.003), (z0 + 0.012, 0.012), (z0 + 0.05, 0.012), (z0 + 0.062, 0.003)):
        hw, hd, power = torso_at(z)
        belt.append(ring_xy(0.0, 0.0, z, hw + grow, hd + grow, n, power))
    p.loft(belt, "gold", cap_first=False, cap_last=False)

    if OUTFIT["belt_knot"]:
        zc = z0 + 0.031
        hw, hd, _ = torso_at(zc)
        y = hd + 0.012
        p.ellipsoid(Vector((0.0, y + 0.003, zc)), (0.017, 0.011, 0.016), "gold", u=8, v=4)
        for side in (-1, 1):
            p.ellipsoid(Vector((side * 0.026, y, zc + 0.004)), (0.015, 0.008, 0.012), "gold", rot=(0, side * radians(-25), 0), u=8, v=4)

    if OUTFIT["collar_ring"]:
        collar = []
        for z, grow in ((TORSO_H - 0.016, 0.012), (TORSO_H - 0.004, 0.010), (TORSO_H + 0.012, 0.0)):
            hw, hd, power = torso_at(min(z, TORSO_H))
            collar.append(ring_xy(0.0, 0.0, z, hw + grow, hd + grow, 16, 2.0))
        p.loft(collar, "cream")

    if OUTFIT["sash"]:
        width = OUTFIT["sash_width"]
        tip = (0.0, z0 + 0.075)
        for side in (-1, 1):
            start = (side * 0.07, TORSO_H - 0.012)
            samples = 7
            rings = []
            for i in range(samples):
                t = i / (samples - 1)
                cx, cz = lerp(start[0], tip[0], t), lerp(start[1], tip[1], t)
                dx, dz = tip[0] - start[0], tip[1] - start[1]
                ln = sqrt(dx * dx + dz * dz)
                px, pz = -dz / ln, dx / ln
                pts = []
                for off, lift in ((-0.5, 0.004), (0.0, 0.0085), (0.5, 0.004)):
                    x, z = cx + px * width * off, cz + pz * width * off
                    pts.append(Vector((x, torso_front(x, z) + lift, z)))
                rings.append(pts)
            sash_strip(p, rings)
    return p.to_object()


def sash_strip(p, rows):
    """A flat ribbon over the chest; every quad is wound so it faces the front (+Y)."""
    bm = p.bm
    vr = [[bm.verts.new(v) for v in row] for row in rows]
    for i in range(len(vr) - 1):
        for j in range(2):
            quad = [vr[i][j], vr[i][j + 1], vr[i + 1][j + 1], vr[i + 1][j]]
            f = p.face(quad, "cream")
            f.normal_update()
            if f.normal.y < 0:
                f.normal_flip()


# ----------------------------------------------------------------------------------------------------------------------
# Arms, hands, feet (frames: shoulder joint, elbow, wrist, ankle - all origin at the joint, hanging toward -Z)
# ----------------------------------------------------------------------------------------------------------------------


def dome_rings(radius, n, steps, z_centre=0.0, squash=1.0):
    """Upper hemisphere rings from the equator up, excluding the pole."""
    rings = []
    for i in range(steps):
        t = (pi / 2) * i / steps
        rings.append(ring_xy(0.0, 0.0, z_centre + radius * sin(t) * squash, radius * cos(t), radius * cos(t), n))
    return rings


def build_sleeve_upper():
    p = Part("sleeveUpper")
    n = SEGMENTS["sleeve"]
    r = SHOULDER_R
    arm = RIG["upperArm"]
    tube = [
        ring_xy(0.0, 0.0, -arm, r * 1.12, r * 1.12, n),
        ring_xy(0.0, 0.0, -arm * 0.6, r * 1.06, r * 1.06, n),
        ring_xy(0.0, 0.0, -arm * 0.2, r * 1.0, r * 1.0, n),
    ]
    dome = dome_rings(r, n, 3, squash=0.62)
    p.loft(tube + dome, "robe", cap_first=True, cap_last=Vector((0.0, 0.0, r * 0.62)))
    return p.to_object()


def build_sleeve_lower():
    p = Part("sleeveLower")
    n = SEGMENTS["sleeve"]
    fore = RIG["foreArm"]
    top_r = SHOULDER_R * 1.14
    cuff = top_r + 0.03
    end = -(fore - 0.02)
    rings = [
        ring_xy(0.0, 0.0, end - 0.004, 0.034, 0.034, n),
        ring_xy(0.0, 0.0, end - 0.002, cuff - 0.02, cuff - 0.02, n),
        ring_xy(0.0, 0.0, end + 0.0, cuff - 0.012, cuff - 0.012, n),
        ring_xy(0.0, 0.0, end + 0.008, cuff + 0.004, cuff + 0.004, n),
        ring_xy(0.0, 0.0, end + 0.04, cuff - 0.004, cuff - 0.004, n),
        ring_xy(0.0, 0.0, -fore * 0.5, lerp(top_r, cuff, 0.5), lerp(top_r, cuff, 0.5), n),
        ring_xy(0.0, 0.0, -0.01, top_r, top_r, n),
    ]
    elbow_dome = [
        ring_xy(0.0, 0.0, top_r * 0.7 * sin((pi / 2) * i / 3), top_r * cos((pi / 2) * i / 3), top_r * cos((pi / 2) * i / 3), n)
        for i in range(1, 3)
    ]
    p.loft(rings + elbow_dome, "robe", cap_last=Vector((0.0, 0.0, top_r * 0.7)))
    return p.to_object()


def build_hand():
    p = Part("hand")
    n = SEGMENTS["hand"]
    profile = [  # z, half-width, half-depth (origin at the wrist, fingers hang down)
        (-0.098, 0.016, 0.014),
        (-0.088, 0.030, 0.024),
        (-0.066, 0.039, 0.030),
        (-0.040, 0.040, 0.031),
        (-0.014, 0.033, 0.026),
        (0.012, 0.029, 0.024),
        (0.030, 0.029, 0.024),
    ]
    rings = [ring_xy(0.0, 0.0, z, w, d, n) for z, w, d in profile]
    p.loft(rings, "skin", cap_first=Vector((0.0, 0.0, -0.103)), cap_last=True)
    return p.to_object()


def build_foot():
    """버선: a cream sock with the upturned tip. Toes point toward +Y; the sole is at z = -footY."""
    p = Part("foot")
    n = SEGMENTS["foot"]
    sole = -RIG["footY"]
    stations = [  # y, half-width, bottom z, top z
        (-0.062, 0.020, sole + 0.012, sole + 0.070),
        (-0.050, 0.033, sole + 0.002, sole + 0.098),
        (-0.020, 0.040, sole, sole + 0.100),
        (0.020, 0.043, sole, sole + 0.078),
        (0.062, 0.039, sole, sole + 0.052),
        (0.100, 0.029, sole + 0.002, sole + 0.040),
        (0.130, 0.017, sole + 0.012, sole + 0.052),
        (0.150, 0.008, sole + 0.034, sole + 0.066),
    ]
    rings = []
    for y, w, zb, zt in stations:
        zc, h = (zb + zt) / 2, (zt - zb) / 2
        rings.append([Vector((w * cos(2 * pi * k / n), y, zc - h * sin(2 * pi * k / n))) for k in range(n)])
    bm = p.bm
    vr = [[bm.verts.new(v) for v in ring] for ring in rings]
    for i in range(len(vr) - 1):
        for j in range(n):
            k = (j + 1) % n
            p.face([vr[i][j], vr[i][k], vr[i + 1][k], vr[i + 1][j]], "sock")
    for ring, tip_y, flip in ((vr[0], -0.074, True), (vr[-1], 0.158, False)):
        centre = sum((v.co for v in ring), Vector()) / n
        pole = Vector((0.0, tip_y, centre.z + (0.004 if not flip else 0.0)))
        c = bm.verts.new(pole)
        for j in range(n):
            k = (j + 1) % n
            p.face([c, ring[k], ring[j]] if flip else [c, ring[j], ring[k]], "sock")
    return p.to_object()


BUILDERS = {
    "head": build_head,
    "face": build_face,
    "hair": build_hair,
    "torso": build_torso,
    "skirt": build_skirt,
    "trim": build_trim,
    "sleeveUpper": build_sleeve_upper,
    "sleeveLower": build_sleeve_lower,
    "hand": build_hand,
    "foot": build_foot,
}

# ----------------------------------------------------------------------------------------------------------------------
# Scene assembly, checks, export
# ----------------------------------------------------------------------------------------------------------------------


def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.collections, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)
    MATERIALS.clear()


def new_collection(name, parent=None):
    coll = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def layer_collection(coll, root=None):
    root = root or bpy.context.view_layer.layer_collection
    if root.collection == coll:
        return root
    for child in root.children:
        found = layer_collection(coll, child)
        if found:
            return found
    return None


def triangle_count(obj):
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def bbox_three(obj):
    """Bounding box in three.js axes (x, z, -y from Blender)."""
    pts = [v.co for v in obj.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.z for p in pts]
    zs = [-p.y for p in pts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def mirror_error(obj):
    pts = {(round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in obj.data.vertices}
    return sum(1 for (x, y, z) in pts if (round(-x, 5) + 0.0, y, z) not in pts and (-x, y, z) not in pts)


def outward_share(obj):
    me = obj.data
    me.calc_loop_triangles()
    centre = sum((v.co for v in me.vertices), Vector()) / max(len(me.vertices), 1)
    good = total = 0
    for poly in me.polygons:
        total += 1
        if poly.normal.dot(poly.center - centre) > 0:
            good += 1
    return good / max(total, 1)


def report_parts(parts):
    total = 0
    for name in PART_ORDER:
        obj = parts[name]
        tris = triangle_count(obj) * COPIES.get(name, 1)
        total += tris
        lo, hi = bbox_three(obj)
        sym = mirror_error(obj) if name in SYMMETRIC_PARTS else "-"
        print(
            "PART %-12s tris=%-4d copies=%d outward=%.2f mirrorErr=%s bbox(three)=(%.3f,%.3f,%.3f)..(%.3f,%.3f,%.3f)"
            % (name, triangle_count(obj), COPIES.get(name, 1), outward_share(obj), sym, *lo, *hi)
        )
    print("TRIANGLES per monk:", total)
    return total


def rig_dict():
    return {
        "_source": "packages/client/assets/monk/build_monk.py",
        "headHeight": round(H, 5),
        "crownY": round(CROWN_Z, 5),
        "chinY": round(CHIN_Z, 5),
        "hipStand": RIG["hipStand"],
        "hipKneel": RIG["hipKneel"],
        "skirtDrop": RIG["skirtDrop"],
        "torsoHeight": round(TORSO_H, 5),
        "neckY": round(NECK_Y, 5),
        "shoulderX": RIG["shoulderX"],
        "shoulderY": round(SHOULDER_Y, 5),
        "upperArm": RIG["upperArm"],
        "foreArm": RIG["foreArm"],
        "footX": RIG["footX"],
        "footY": RIG["footY"],
    }


def export_glb(parts_coll, path):
    bpy.context.view_layer.active_layer_collection = layer_collection(parts_coll)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_active_collection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_extras=False,
    )


# ---- poses (a copy of the three.js rig in monk-model.ts, only for previews) -----------------------------------------

C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three.js -> Blender


def tmat(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.Translation(Vector(pos)) @ euler_matrix(rot) @ Matrix.Diagonal(Vector((*scale, 1.0)))


def pose_matrices(kneel, cushion):
    """World matrices (Blender axes) for every part copy in the idle (kneel=0) or praying (kneel=1) rest pose."""
    lift = cushion * kneel
    hips = tmat((0, lift + lerp(RIG["hipStand"], RIG["hipKneel"], kneel), 0))
    skirt = hips @ tmat((0, 0.01 * kneel, 0), scale=(1 + 0.38 * kneel, lerp(1, 0.56, kneel), 1 + 0.38 * kneel))
    torso = hips
    head = torso @ tmat((0, NECK_Y, 0))
    out = {"head": [head], "face": [head], "hair": [head], "skirt": [skirt], "torso": [torso], "trim": [torso]}
    for key in ("sleeveUpper", "sleeveLower", "hand", "foot"):
        out[key] = []
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        shoulder = torso @ tmat((sign * RIG["shoulderX"], SHOULDER_Y, 0), (lerp(0.1, 0.62, kneel), 0, -sign * lerp(0.12, 0.5, kneel)))
        elbow = shoulder @ tmat((0, -RIG["upperArm"], 0), (lerp(0.22, 1.95, kneel), 0, 0))
        hand = elbow @ tmat((0, -RIG["foreArm"], 0))
        foot = tmat((sign * RIG["footX"], lift + RIG["footY"], 0.2 * kneel), (0.5 * kneel, 0, 0))
        out["sleeveUpper"].append(shoulder)
        out["sleeveLower"].append(elbow)
        out["hand"].append(hand)
        out["foot"].append(foot)
    return {k: [C4 @ m @ C4.inverted() for m in v] for k, v in out.items()}


def robe_tint(hue):
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360.0, 0.62, 0.42)
    return (r, g, b, 1.0)


def build_pose(name, parts, kneel, tint_hue=None, cushion=0.13):
    coll = new_collection(name)
    mats = pose_matrices(kneel, cushion)
    robe = {"torso", "skirt", "sleeveUpper", "sleeveLower"}
    for part, matrices in mats.items():
        src = parts[part]
        data = src.data
        if tint_hue is not None and part in robe:
            data = src.data.copy()
            colour = robe_tint(tint_hue)
            attr = data.color_attributes[COLOR_LAYER]
            for item in attr.data:
                item.color = colour
        for i, m in enumerate(matrices):
            obj = bpy.data.objects.new("%s_%d" % (part, i), data)
            obj.matrix_world = m
            coll.objects.link(obj)
    if kneel > 0:
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.42, depth=cushion, location=(0, 0, cushion / 2))
        cushion_obj = bpy.context.active_object
        cushion_obj.name = "cushion"
        for c in cushion_obj.users_collection:
            c.objects.unlink(cushion_obj)
        coll.objects.link(cushion_obj)
        mesh = cushion_obj.data
        attr = mesh.color_attributes.new(COLOR_LAYER, "FLOAT_COLOR", "CORNER")
        for item in attr.data:
            item.color = srgb_to_linear(0x8C3B35)
        mesh.color_attributes.active_color = attr
    return coll


def setup_preview_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = PREVIEW_SIZE
    scene.render.film_transparent = False
    scene.display.render_aa = "8"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_backface_culling = True
    shading.show_object_outline = False
    shading.show_specular_highlight = False
    world = bpy.data.worlds.new("preview")
    world.color = (0.62, 0.72, 0.86)
    scene.world = world
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def render_view(cam, name, azimuth_deg, target, scale):
    az = radians(azimuth_deg)
    direction = Vector((sin(az), cos(az), 0.12)).normalized()  # azimuth 0 = from the front (+Y)
    cam.location = Vector(target) + direction * 4.0
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = scale
    cam.data.clip_end = 20
    path = os.path.join(PREVIEW_DIR, name + ".png").replace("\\", "/")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", path)


def render_previews(parts):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    cam = setup_preview_scene()
    standing = build_pose("preview_standing", parts, 0.0, PREVIEW_HUE)
    kneeling = build_pose("preview_kneeling", parts, 1.0, PREVIEW_HUE)
    for coll in list(bpy.data.collections):
        coll.hide_render = coll.name.startswith("monk_")
    kneeling.hide_render = True
    mid = (0, 0, 0.58)
    for name, az in (("monk_front", 0), ("monk_side", 90), ("monk_back", 180), ("monk_three_quarter", 38)):
        render_view(cam, name, az, mid, 1.45)
    standing.hide_render = True
    kneeling.hide_render = False
    kmid = (0, 0, 0.62)
    for name, az in (("monk_kneel_front", 0), ("monk_kneel_three_quarter", 38), ("monk_kneel_side", 90)):
        render_view(cam, name, az, kmid, 1.45)
    for coll in (standing, kneeling):
        for obj in list(coll.objects):
            bpy.data.objects.remove(obj)
        bpy.data.collections.remove(coll)
    bpy.data.objects.remove(cam)


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    reset_scene()
    parts_coll = new_collection("monk_parts")
    parts = {}
    for name in PART_ORDER:
        obj = BUILDERS[name]()
        parts_coll.objects.link(obj)
        parts[name] = obj
    total = report_parts(parts)

    glb = os.path.join(HERE, "monk.glb")
    export_glb(parts_coll, glb)
    print("WROTE", glb, os.path.getsize(glb), "bytes")

    rig_path = os.path.join(HERE, "monk-rig.json")
    with open(rig_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rig_dict(), fh, indent=2)
        fh.write("\n")
    print("WROTE", rig_path)

    standing = build_pose("monk_pose_standing", parts, 0.0)
    layer_collection(parts_coll).hide_viewport = True
    bpy.context.view_layer.active_layer_collection = layer_collection(standing)

    if "--no-render" not in args:
        render_previews(parts)

    blend = os.path.join(HERE, "monk.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("WROTE", blend)
    print("DONE triangles=%d" % total)


main()
