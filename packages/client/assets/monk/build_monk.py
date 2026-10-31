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
    head, face, hair, torso, pelvis, trousers, trim, sleeveUpper, sleeveLower, hand, foot, leg
sleeveUpper, sleeveLower, hand, foot, leg and trousers are mirror-symmetric about x = 0 because one geometry serves both sides.
The head is shaved: the scalp shade is a smooth vertex-colour gradient on the head itself (no cap mesh, so there is no
edge to show). "hair" stays as a swappable slot but holds only a tiny scalp-coloured core buried inside the skull, so
nothing sits above the scalp until a hairstyle is dropped in.
The outfit is a Korean child-monk set taken from a reference photograph (kept outside this repository): an ash-grey jacket and darker grey
baggy trousers (no skirt). "torso" is the jacket (crossed front with the left panel over the right, a side tie, long sleeves
in sleeveUpper / sleeveLower), "trim" its collar, crossing edges and tie. The trousers are two parts: "trousers" is one baggy
leg that hangs from the same pivot as "leg" (the bare calf + cream knee sock inside it, mostly hidden) and is stretched with it,
so it follows strides, bobbing and the folded kneeling feet; "pelvis" is the seat of the trousers below the jacket hem,
bound to the hips, which closes the gap between the two legs and rests on the cushion when kneeling.
The jacket ends JACKET_HEM below the hip pivot, the trouser cuff stops CUFF_ABOVE_ANKLE above the ankle, and the cream sock
shows below it.
Robe parts (torso, pelvis, trousers, sleeveUpper, sleeveLower) are light and dark grey; the game tints them per monk by
multiplying a muted hue (HSL(hue, robeTintSaturation, robeTintLightness)) into that grey (robe_tint below mirrors monk-model.ts).
Colours are written to the "Col" vertex-colour layer from PALETTE, and the materials read that layer.

Blender axes: X right, Y forward (the face looks toward +Y), Z up. glTF export maps (x, y, z) -> (x, z, -y).

Proportions: a chibi 3.4 heads tall (3.4등신) with a big round head and a squat body, laid out like the player character of
sansatemple.com (its measurements, taken from the live site, are the targets below; its sage robe, saffron wrap, mittens and
rounded shoes are not copied: the outfit stays the ash-grey jacket, grey trousers and cream sock). H = head height without hair
(crown of the skull to the chin); everything is laid out in H (H = 0.33, so the monk is 1.122 high), listed as the height above the sole:
    standing height, skull top           3.40
    chin                                 2.40
    shoulder joint                       2.36     (chin to shoulder 0.04; the neck is 0.02 and the shoulder sits just under its base)
    elbow, arm hanging                   1.835
    wrist                                1.425
    fingertip                            1.305
    hip pivot                            1.85     (chin to hip 0.55)
    knee                                 0.95
    ankle pivot                          0.21
    upper arm 0.54, forearm 0.41, hand 0.12 (a stubby mitt)
    thigh (hip pivot to knee) 0.90, shin (knee to ankle pivot) 0.74
    jacket hem above the sole            0.95     (0.90 below the hip pivot: a long tunic ending at the knee)
    trouser seat (crotch) above the sole 0.81     (1.04 below the hip pivot, tucked under the jacket and never wider than its hem)
    trouser cuff above the sole          0.265    (just over the ankle; the cream sock and the flat foot show below it)
    head width, ears included            1.25, head depth 1.15 (a round skull, the jaw barely tapers)
    robe width at the widest              1.20, sleeve to sleeve with the arms hanging 1.9 (silhouette), hip joints 0.50 apart
The face has closed upturned eyes (^^), a small smile and two blush ovals; no nose, no brows.
The arms hang straight, splayed about 35 degrees (POSE idle_z) so the sleeves clear the wide robe. Praying folds the arms until the
fingertips meet just under the chin; bowing tips the torso almost flat and lays both hands on the seat together, under the face (POSE below).
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
from mathutils.bvhtree import BVHTree

# ----------------------------------------------------------------------------------------------------------------------
# CONFIG - change numbers here and rebuild. Lengths are scene units (1 unit = the game's world unit).
# ----------------------------------------------------------------------------------------------------------------------

HEAD_H = 0.33  # crown to chin (the lowest jaw vertex) of the shaved skull; the unit of every ratio below. Standing crown = 3.4 H = 1.122.

RATIO = {  # in units of HEAD_H, measured from the sansatemple.com player character (see the docstring)
    "head_width": 1.25,  # skull plus ears: 0.4125 absolute
    "head_depth": 1.15,  # 0.3795 absolute (a round skull)
    "robe_width": 1.2,  # the jacket at its widest, 0.396 absolute
    "shoulder_breadth": 1.9,  # sleeve to sleeve with the arms hanging: a silhouette, measured by check_proportions
    "hip_joints": 0.50,  # the two hip joints (and the two feet) this far apart: 0.165 absolute
    "neck": 0.02,  # chin down to the base of the neck (chibi: almost none), 0.0066 absolute
    "chin_to_shoulder": 0.04,  # chin down to the shoulder joint: a hair under the base of the neck, so the sleeve root tucks under the jaw
    "chin_to_hip": 0.55,  # chin down to the hip pivot
    "waist_to_sole": 1.85,  # hip pivot height when standing
    "upper_arm": 0.54,  # shoulder joint to elbow pivot
    "fore_arm": 0.41,  # elbow pivot to wrist pivot
    "hand": 0.12,  # wrist pivot down to the fingertip: a stubby mitt
    "knee": 0.95,  # knee height above the sole: thigh 0.90, shin 0.74 plus the ankle
    "ankle": 0.21,  # ankle pivot above the sole
    "cuff": 0.265,  # the trouser cuff above the sole, just over the ankle (0.26 in the reference; a hair higher so the cuff clears the foot at full stride on the short leg)
}
STAND_H = 3.4  # standing height in head heights: 3.4등신
JACKET_HEM = 0.90  # in H: the jacket hem hangs this far below the hip pivot (a long tunic that ends at the knee)
PELVIS_DEPTH = 1.04  # in H: the crotch of the trousers hangs this far below the hip pivot; a kneeling monk sits on it, which keeps the jacket hem 5 cm above the seat

RIG = {  # pivots and lengths the animation code uses
    "hipStand": round(RATIO["waist_to_sole"] * HEAD_H, 3),
    "hipKneel": 0.0,  # set below: the kneeling pelvis rests on the cushion
    "jacketDrop": round(JACKET_HEM * HEAD_H, 3),  # the jacket hem hangs this far below the hip pivot
    "pelvisDrop": round(PELVIS_DEPTH * HEAD_H, 3),  # the crotch of the trousers hangs this far below the hip pivot
    "shoulderX": 0.11,
    "shoulderDrop": 0.0,  # set below: shoulder joint below the neck base
    "upperArm": round(RATIO["upper_arm"] * HEAD_H, 3),
    "foreArm": round(RATIO["fore_arm"] * HEAD_H, 3),
    "footX": round(RATIO["hip_joints"] / 2 * HEAD_H, 4),  # half the distance between the hip joints
    "footY": round(RATIO["ankle"] * HEAD_H, 4),  # the ankle pivot above the sole; the flat sock's top reaches it
    "footForward": 0.03,  # standing: the ankle sits this far in front of the hip, the toes reach a hand further
    "footKneelZ": 0.25,  # kneeling: the foot folds sole-up behind the hip, toes peeking out behind the trousers
    "footKneelTilt": pi,
    "legKneelLift": 0.046,  # kneeling: the leg lower end lies this far above the foot pivot, on top of the folded foot, so the trouser cuff clears the cushion
    "legTopDrop": 0.12,  # the leg's top pivot hangs this far below the hip pivot, inside the pelvis of the trousers
    "kneelPelvisGrow": 0.25,  # kneeling spreads the trousers' pelvis sideways ...
    "kneelPelvisScaleY": 1.0,  # ... and keeps its height, so its underside rests on the cushion
    "kneelPelvisLift": 0.0,
    "bowHipForward": 0.1,  # the deepest bow carries the hip pivot (torso, head, arms and the tops of the legs) this far forward ...
    "bowSeatBack": 0.1,  # ... and the seat of the trousers back by this much, so it stays on the heels instead of reaching under the folded arms
    "seatTop": 0.13,
    "robeTintSaturation": 1.0,  # the game multiplies HSL(hue, this, that) into the grey robe: a muted hue that still reads as grey 승복
    "robeTintLightness": 0.78,
}
RIG["hipKneel"] = round(RIG["pelvisDrop"] * RIG["kneelPelvisScaleY"] + 0.007, 3)  # the kneeling crotch hangs 7 mm over the cushion
RIG["shoulderDrop"] = round((RATIO["chin_to_shoulder"] - RATIO["neck"]) * HEAD_H, 4)
RIG["legLength"] = round(RIG["hipStand"] - RIG["legTopDrop"] - RIG["footY"], 4)  # top pivot down to the ankle pivot, standing
CUFF_ABOVE_ANKLE = round(RATIO["cuff"] * HEAD_H - RIG["footY"], 4)  # the trouser cuff stops this far above the ankle pivot, so the foot shows below it

HAND = {"reach": round(RATIO["hand"] * HEAD_H, 3)}  # wrist pivot down to the fingertip
HAND_DRAWN_REACH = 0.102  # the wrist-to-fingertip reach the hand's width profile was drawn for

POSE = {  # arm angles of the idle, walking, praying and bowing poses (radians; z is positive inward); a copy of the numbers in monk-model.ts, used by the previews
    "idle_x": 0.08,
    "idle_z": -0.61,  # the arms hang straight, splayed about 35 degrees, so the sleeves clear the wide robe
    "idle_elbow": 0.1,
    "walk_swing": 0.5,  # the arm swings this far at full stride, opposite the same side's leg; the back swing bends the elbow half as much
    "pray_x": 0.924,
    "pray_y": 0.315,
    "pray_z": 0.185,
    "pray_elbow": 1.301,
    "pray_twist": 1.478,
    "bow_lean": 1.648,
    "bow_head": 0.0,
    "bow_x": 1.261,
    "bow_z": 0.2,
    "bow_elbow": 0.44,
}

LEG = {
    "sock_top": 0.192,  # the cuff's top edge above the ankle pivot
    "radius": 0.038,
}

FACE = {  # heights are fractions of HEAD_H above the chin, x is a distance from the centre line, sizes are absolute
    "eye_f": 0.62,
    "eye_x": round(0.19 * HEAD_H, 4),  # the eyes' centres are 0.38 H apart
    "eye_halfwidth": round(0.075 * HEAD_H, 4),  # each closed eye is 0.15 H wide
    "eye_arch": round(0.04 * HEAD_H, 4),  # the stroke rises this far in the middle: a ^ shape
    "eye_thick": 0.0085,  # the stroke is a flat ribbon this wide in the middle ...
    "eye_tip": 0.0035,  # ... and this wide at both ends
    "mouth_f": 0.30,
    "mouth_halfwidth": round(0.10 * HEAD_H, 4),  # the smile is 0.20 H wide
    "mouth_sag": round(0.03 * HEAD_H, 4),  # the middle of the smile dips this far below its ends: a u shape
    "mouth_thick": 0.0065,
    "mouth_tip": 0.0030,
    "stroke_lift": 0.002,  # the eyes and the smile float this far above the faceted skull (decals, measured along the facet normal) ...
    "blush_lift": 0.0025,  # ... the blush a little higher: its big flat polygons span facet creases, which dip them about 1.5 mm
    "blush_f": 0.50,
    "blush_x": round(0.265 * HEAD_H, 4),  # just outward of the eyes
    "blush_radii": (round(0.10 * HEAD_H, 4), round(0.058 * HEAD_H, 4)),  # half length (x) and half height (z): the oval is 0.20 H long
    "jaw_taper": 0.07,  # how much the skull narrows toward the chin
    "ear_f": 0.42,
    "ear_radii": (0.010, 0.022, 0.032),
    "ear_out": 0.012,  # how far an ear sticks out of the skull
}

HAIR = {  # shaved head: the scalp of the head part just turns a shade darker toward the crown
    "scalp_tint": True,
    "hairline_front_f": 0.72,  # fractions of the head height above the chin where the tint starts to fade in
    "hairline_side_f": 0.62,
    "hairline_back_f": 0.42,
    "fade": 0.75,  # latitude (radians) over which skin turns into full scalp colour
    "core_radius": 0.012,  # the hair slot's placeholder: a tiny scalp-coloured blob buried in the middle of the skull
}

OUTFIT = {
    "collar_ring": True,  # the dark collar band round the neck
    "lapel_width": 0.022,  # the crossing edge of the jacket (깃)
    "lapel_lift": 0.0035,  # how far the lapel band floats above the jacket (it is a decal, not a 3D strap)
    "tie": True,  # the fabric string that ties the jacket at the wearer's right side
}

PALETTE = {  # sRGB hex
    "skin": 0xF3CBA2,
    "jacket": 0x9CA0A8,  # the 승복 jacket: ash grey, tinted at runtime like the rest of the robe
    "trousers": 0x7F8288,  # the wide trousers: a darker grey, tinted the same way
    "seam": 0x6E727A,  # collar band, crossing edge and tie of the jacket: neutral, never tinted
    "cream": 0xF1ECDF,  # the undershirt in the V of the neck
    "sock": 0xFAF5E8,
    "eye": 0x2B1A12,
    "mouth": 0x9A4A3C,
    "blush": 0xF2A3A0,  # the two pink ovals under the eyes
    "scalp": 0xDDB693,
}

SEGMENTS = {"head": 20, "torso": 20, "pelvis": 16, "trousers": 12, "sleeve": 12, "hand": 10, "foot": 10, "leg": 8}

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
SHOULDER_R = 0.036  # sleeve radius just below the shoulder joint: slim, so the 35 degree splay of the arms stays inside the 1.9 H silhouette and the sleeve clears the head

CHIN_Z = NECK_LEN  # head frame: origin at the base of the neck. The lowest ring of the skull (the jaw) sits exactly here
CROWN_Z = NECK_LEN + H
JAW_LAT0 = radians(-62)  # the skull is cut off at this latitude; that ring is the chin, and a flat disc closes it
SKULL_A = H / (1 - sin(JAW_LAT0))  # half height, so that the chin ring is at CHIN_Z and the crown pole at CROWN_Z
SKULL_ZC = CROWN_Z - SKULL_A
JAW_FRONT = 0.07  # head vertices this far in front of the neck axis belong to the jaw (the neck column ends at 0.05)
SKULL_RX = (RATIO["head_width"] * H - 2 * FACE["ear_out"]) / 2
SKULL_RY = RATIO["head_depth"] * H / 2
SKULL_CY = 0.02  # the skull sits a little forward of the neck, which also keeps the face and hair on the front side

COLOR_LAYER = "Col"
HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW_DIR = os.environ.get("MONK_PREVIEW_DIR") or os.path.join(tempfile.gettempdir(), "monk-preview")
PART_ORDER = ["head", "face", "hair", "pelvis", "torso", "trim", "sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers"]
SYMMETRIC_PARTS = ["sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers"]
COPIES = {"sleeveUpper": 2, "sleeveLower": 2, "hand": 2, "foot": 2, "leg": 2, "trousers": 2}

# ----------------------------------------------------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------------------------------------------------


def linear_channel(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb_to_linear(hex_value):
    r, g, b = ((hex_value >> 16) & 255) / 255, ((hex_value >> 8) & 255) / 255, (hex_value & 255) / 255
    return (linear_channel(r), linear_channel(g), linear_channel(b), 1.0)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix_colors(a, b, t):
    return tuple(lerp(x, y, t) for x, y in zip(a, b))


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
        self.tint = None  # optional fn(key, co) -> linear colour or None, for smooth colour gradients

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
        bake_colors(mesh, self.keys, self.tint)
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


def bake_colors(mesh, keys, tint=None):
    attr = mesh.color_attributes.new(COLOR_LAYER, "FLOAT_COLOR", "CORNER")
    for poly in mesh.polygons:
        key = keys[poly.material_index]
        colour = srgb_to_linear(PALETTE[key])
        for li in poly.loop_indices:
            shaded = tint(key, mesh.vertices[mesh.loops[li].vertex_index].co) if tint else None
            attr.data[li].color = shaded or colour
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


def face_z(fraction):
    return CHIN_Z + fraction * H


def hairline(a):
    """Latitude where the scalp tint starts, around the head (a = azimuth, 0 = right ear, pi/2 = forehead)."""
    t_front, t_side, t_back = (
        math.asin(clamp((face_z(HAIR[key]) - SKULL_ZC) / SKULL_A, -1.0, 1.0))
        for key in ("hairline_front_f", "hairline_side_f", "hairline_back_f")
    )
    s = sin(a)
    return lerp(t_side, t_front, s**1.4) if s > 0 else lerp(t_side, t_back, -s)


def scalp_tint(key, co):
    """Skin turns smoothly into the shaved-scalp shade above the old hairline; neck, ears and face stay skin."""
    if key != "skin" or not HAIR["scalp_tint"]:
        return None
    lat = math.asin(clamp((co.z - SKULL_ZC) / SKULL_A, -1.0, 1.0))
    a = atan2((co.y - SKULL_CY) / SKULL_RY, co.x / SKULL_RX)
    w = smoothstep((lat - hairline(a)) / HAIR["fade"])
    return mix_colors(srgb_to_linear(PALETTE["skin"]), srgb_to_linear(PALETTE["scalp"]), w)


def skull_rings():
    n = SEGMENTS["head"]
    lats = 12
    top = radians(75)
    rings = []
    for i in range(lats):
        t = JAW_LAT0 + (top - JAW_LAT0) * i / (lats - 1)
        z, rx, ry = skull_at(t)
        rings.append(ring_xy(0.0, SKULL_CY, z, rx, ry, n))
    return rings


class SkullSurface:
    """The faceted skull mesh itself (not the smooth ellipsoid it is sampled from: its facets lie up to 2.5 mm inside it), so the
    face can be laid on exactly what the game draws."""

    def __init__(self):
        self.bm = bmesh.new()
        vr = [[self.bm.verts.new(v) for v in ring] for ring in skull_rings()]
        n = len(vr[0])
        for i in range(len(vr) - 1):
            for j in range(n):
                k = (j + 1) % n
                self.bm.faces.new([vr[i][j], vr[i][k], vr[i + 1][k], vr[i + 1][j]])
        self.bm.normal_update()
        self.tree = BVHTree.FromBMesh(self.bm)

    def laid(self, x, z, lift):
        """The point `lift` above the skull's front surface at (x, z), along that facet's outward normal, and the normal."""
        hit, normal, _, _ = self.tree.ray_cast(Vector((x, 1.0, z)), Vector((0.0, -1.0, 0.0)))
        if hit is None:
            raise RuntimeError("no skull surface at x=%.3f z=%.3f" % (x, z))
        return hit + normal * lift, normal


def build_head():
    p = Part("head")
    p.tint = scalp_tint
    p.loft(skull_rings(), "skin", cap_first=True, cap_last=Vector((0.0, SKULL_CY, CROWN_Z)))

    neck = [ring_xy(0.0, 0.004, z, r, r, 12) for z, r in ((-0.025, 0.046), (0.0, 0.043), (CHIN_Z + 0.02, 0.042))]
    p.loft(neck, "skin")

    for side in (-1, 1):
        z = face_z(FACE["ear_f"])
        t = math.asin(clamp((z - SKULL_ZC) / SKULL_A, -0.999, 0.999))
        _, rx, ry = skull_at(t)
        centre = Vector((side * (rx + FACE["ear_out"] - FACE["ear_radii"][0] * 0.9), SKULL_CY - 0.012, z))
        p.ellipsoid(centre, FACE["ear_radii"], "skin", rot=(0, 0, side * radians(-14)), u=8, v=6)
    return p.to_object()


def stroke_inset(halfwidth, rise, tip):
    """Centre-line half width that leaves the finished stroke, its slanted end cuts included, `halfwidth` wide on each side."""
    return halfwidth - tip / 2 * sin(atan2(2 * abs(rise), halfwidth))


def laid_stroke(p, skull, x0, z0, halfwidth, rise, steps, thick, tip, key, lift):
    """A flat ribbon across the skull's front, seen from the front (+Y): x runs from x0 - halfwidth to x0 + halfwidth along
    z = z0 + rise * (1 - u^2) (an arch for a positive rise, a bowl for a negative one). It is `thick` wide in the middle and `tip`
    wide at both ends, and every vertex is laid `lift` above the facet of the skull under it, so no part of it is buried."""
    centres = []
    for i in range(steps):
        u = -1 + 2 * i / (steps - 1)
        centres.append((x0 + halfwidth * u, z0 + rise * (1 - u * u), u))
    rows = []
    for i, (x, z, u) in enumerate(centres):
        before, after = centres[max(i - 1, 0)], centres[min(i + 1, steps - 1)]
        dx, dz = after[0] - before[0], after[1] - before[1]
        length = math.hypot(dx, dz)
        half = lerp(tip, thick, 1 - u * u) / 2
        nx, nz = -dz / length * half, dx / length * half
        rows.append([p.bm.verts.new(skull.laid(x + side * nx, z + side * nz, lift)[0]) for side in (-1, 1)])
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        quad = [a0, a1, b1, b0]
        facing = (a1.co - a0.co).cross(b0.co - a0.co)  # the normal of this winding
        p.face(quad if facing.y >= 0 else quad[::-1], key)


def laid_oval(p, skull, cx, cz, rx, rz, key, lift, rings=2, sides=10):
    """A flat oval laid over the skull's front: a fan of rings whose points sit `lift` above the facets under them."""

    def vert(x, z):
        return p.bm.verts.new(skull.laid(x, z, lift)[0])

    centre = vert(cx, cz)
    ring_verts = [[vert(cx + rx * (r / rings) * cos(2 * pi * k / sides), cz + rz * (r / rings) * sin(2 * pi * k / sides)) for k in range(sides)] for r in range(1, rings + 1)]
    for k in range(sides):
        j = (k + 1) % sides
        p.face([centre, ring_verts[0][j], ring_verts[0][k]], key)
    for r in range(rings - 1):
        for k in range(sides):
            j = (k + 1) % sides
            p.face([ring_verts[r][k], ring_verts[r][j], ring_verts[r + 1][j], ring_verts[r + 1][k]], key)


def build_face():
    """Closed upturned eyes (^ ^), a small u smile and two blush ovals. No nose, no brows. All three are decals laid on the skull's
    facets (SkullSurface), so a stroke keeps one width over the whole head however its facets fall."""
    p = Part("face")
    skull = SkullSurface()
    z_eye = face_z(FACE["eye_f"]) - FACE["eye_arch"] / 2  # eye_f is the height of the middle of the stroke's box
    eye_hw = stroke_inset(FACE["eye_halfwidth"], FACE["eye_arch"], FACE["eye_tip"])
    for side in (-1, 1):
        laid_stroke(p, skull, side * FACE["eye_x"], z_eye, eye_hw, FACE["eye_arch"], 7, FACE["eye_thick"], FACE["eye_tip"], "eye", FACE["stroke_lift"])
        laid_oval(p, skull, side * FACE["blush_x"], face_z(FACE["blush_f"]), FACE["blush_radii"][0], FACE["blush_radii"][1], "blush", FACE["blush_lift"])
    mouth_hw = stroke_inset(FACE["mouth_halfwidth"], FACE["mouth_sag"], FACE["mouth_tip"])
    laid_stroke(p, skull, 0.0, face_z(FACE["mouth_f"]) + FACE["mouth_sag"] / 2, mouth_hw, -FACE["mouth_sag"], 9, FACE["mouth_thick"], FACE["mouth_tip"], "mouth", FACE["stroke_lift"])
    return p.to_object()


def build_hair():
    """The head is shaved, so the slot is empty: a tiny scalp-coloured blob in the middle of the skull keeps the part (and
    the loader's contract) alive without drawing a single visible triangle. A hairstyle replaces it."""
    p = Part("hair")
    r = HAIR["core_radius"]
    p.ellipsoid(Vector((0.0, SKULL_CY, SKULL_ZC)), (r, r, r), "scalp", u=4, v=2)
    return p.to_object()


# ----------------------------------------------------------------------------------------------------------------------
# Jacket and trousers (frame: origin at the hip pivot)
# ----------------------------------------------------------------------------------------------------------------------

JACKET_DROP = RIG["jacketDrop"]
PELVIS_DROP = RIG["pelvisDrop"]

TORSO_PROFILE = [  # z, half-width, half-depth, superellipse power. The jacket: a long tunic that flares from a narrow, shallow yoke under the head to its widest (1.2 H) over the lower body, so the splayed arms stay clear of it and the praying hands fit in front of the chest
    (-JACKET_DROP, 0.198, 0.146, 2.4),
    (-JACKET_DROP + 0.014, 0.197, 0.145, 2.4),
    (-0.150, 0.197, 0.142, 2.4),
    (-0.050, 0.188, 0.128, 2.4),
    (0.030, 0.160, 0.104, 2.5),
    (0.100, 0.132, 0.080, 2.6),
    (0.140, 0.118, 0.068, 2.8),
    (0.160, 0.104, 0.060, 2.5),
    (0.170, 0.086, 0.052, 2.2),
    (TORSO_H, 0.060, 0.044, 2.0),
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


def torso_rings():
    n = SEGMENTS["torso"]
    return [ring_xy(0.0, 0.0, z, w, d, n, power) for z, w, d, power in TORSO_PROFILE]


def build_torso():
    """The jacket body, from the hem (just below the hip pivot) up to the base of the neck."""
    p = Part("torso")
    p.loft(torso_rings(), "jacket", cap_first=True, cap_last=True)
    return p.to_object()


def clearance_of(tree, point):
    """Signed distance from a closed surface's BVH tree (positive = outside)."""
    hit, normal, _, dist = tree.find_nearest(point)
    return dist if (point - hit).dot(normal) >= 0 else -dist


class TorsoSurface:
    """The faceted torso mesh itself (not the smooth curve it is sampled from), so trim can sit exactly on it."""

    def __init__(self):
        self.bm = bmesh.new()
        n = SEGMENTS["torso"]
        vr = [[self.bm.verts.new(v) for v in ring] for ring in torso_rings()]
        for i in range(len(vr) - 1):
            for j in range(n):
                k = (j + 1) % n
                self.bm.faces.new([vr[i][j], vr[i][k], vr[i + 1][k], vr[i + 1][j]])
        self.bm.normal_update()
        self.tree = BVHTree.FromBMesh(self.bm)

    def front(self, x, z):
        """(point, outward normal) of the torso surface seen from the front (+Y) at (x, z)."""
        hit, normal, _, _ = self.tree.ray_cast(Vector((x, 1.0, z)), Vector((0.0, -1.0, 0.0)))
        if hit is None:
            raise RuntimeError("no torso surface at x=%.3f z=%.3f" % (x, z))
        return hit, normal

    def clearance(self, point):
        """Signed distance from the surface (positive = outside the robe)."""
        hit, normal, _, dist = self.tree.find_nearest(point)
        return dist if (point - hit).dot(normal) >= 0 else -dist


PELVIS_PROFILE = [  # z, half-width, half-depth. The seat of the trousers: tucked under the jacket (never wider than its hem), a little of it showing below the hem, then rounding off into the crotch
    (-PELVIS_DROP, 0.050, 0.044),
    (-PELVIS_DROP + 0.014, 0.100, 0.082),
    (-0.320, 0.130, 0.100),
    (-0.290, 0.140, 0.108),
    (-0.200, 0.140, 0.108),
    (-0.100, 0.130, 0.100),
    (-0.020, 0.115, 0.090),
    (0.030, 0.100, 0.080),
]


def build_pelvis():
    p = Part("pelvis")
    n = SEGMENTS["pelvis"]
    rings = [ring_xy(0.0, 0.0, z, w, d, n, 2.3) for z, w, d in PELVIS_PROFILE]
    p.loft(rings, "trousers", cap_first=True, cap_last=True)
    return p.to_object()


def build_trousers():
    """One baggy trouser leg. Frame: origin at the leg's top pivot (legTopDrop below the hip), the leg hangs toward -Z for
    legLength down to the ankle pivot, and monk-model.ts stretches it with the leg. It is wide at the thigh (about 1.5 times the
    bare leg's radius), full at the knee, and gathers in just above the ankle so the foot shows below the cuff."""
    p = Part("trousers")
    n = SEGMENTS["trousers"]
    length = RIG["legLength"]
    cuff = -length + CUFF_ABOVE_ANKLE
    knee = -length + RATIO["knee"] * HEAD_H - RIG["footY"]  # the human knee height: the widest point of the leg
    stations = [  # z, half-width (x), half-depth (y)
        (cuff, 0.0420, 0.0400),  # the cuff hugs the sock inside; shallow front to back, so its rim stays up when the leg swings
        (cuff + 0.005, 0.0455, 0.0440),
        (cuff + 0.026, 0.0580, 0.0620),  # the fabric billows out of the gather ...
        (cuff + 0.080, 0.0640, 0.0720),  # ... and hangs full to the knee
        (knee, 0.0665, 0.0840),
        (-0.110, 0.0660, 0.0950),
        (-0.050, 0.0650, 0.1020),  # thigh: as deep as the seat it hangs from, so legs and seat read as one garment
        (0.000, 0.0630, 0.1000),
    ]
    rings = [ring_xy(0.0, 0.0, z, w, d, n, 2.3) for z, w, d in stations]
    p.loft(rings, "trousers", cap_last=Vector((0.0, 0.0, 0.012)))
    return p.to_object()


def build_trim():
    p = Part("trim")
    surface = TorsoSurface()
    if OUTFIT["collar_ring"]:
        collar = []
        for z, grow in ((TORSO_H - 0.012, 0.007), (TORSO_H - 0.003, 0.006), (TORSO_H + 0.009, 0.0)):
            hw, hd, power = torso_at(min(z, TORSO_H))
            collar.append(ring_xy(0.0, 0.0, z, hw + grow, hd + grow, 16, 2.0))
        p.loft(collar, "seam")
    build_lapels(p, surface)
    if OUTFIT["tie"]:
        build_tie(p, surface)
    return p.to_object()


LAPEL_TOP_Z = TORSO_H - 0.006
LAPEL_TOP_X = 0.040  # where the two collar edges leave the neck, either side of the centre line
LAPEL_END = (0.120, -0.100)  # x, z: the over edge ends at the wearer's right flank, where the tie is
LAPEL_CROSS = (0.043, 0.030)  # x, z: the under edge slides beneath the over edge here


def over_edge_x(z):
    """x of the over edge at height z: the left panel's free edge runs from the left of the neck across the chest to the right flank."""
    t = (LAPEL_TOP_Z - z) / (LAPEL_TOP_Z - LAPEL_END[1])
    return lerp(-LAPEL_TOP_X, LAPEL_END[0], t)


def under_edge_x(z):
    t = (LAPEL_TOP_Z - z) / (LAPEL_TOP_Z - LAPEL_CROSS[1])
    return lerp(LAPEL_TOP_X, LAPEL_CROSS[0], t)


def torso_ring_heights(lo, hi):
    return [z for z, *_ in reversed(TORSO_PROFILE) if lo + 0.008 < z < hi - 0.004]


def build_lapels(p, surface):
    """The crossed front: the left panel wraps over the right. Two dark bands (the over edge and the under edge) and the cream
    undershirt in the V between them. They are decals: every vertex sits a few millimetres above the faceted torso (ray-cast
    onto it), and the rows sit on the torso's own ring heights so no row straddles a crease."""
    width, lift = OUTFIT["lapel_width"], OUTFIT["lapel_lift"]
    low, high = 1.0, -1.0

    def band(z_from, z_to, edge_x, key, band_lift, band_width):
        nonlocal low, high
        rows_z = [z_from] + torso_ring_heights(z_to, z_from) + [z_to]
        rings = []
        for z in rows_z:
            cx = edge_x(z)
            dz = (edge_x(z + 0.01) - edge_x(z - 0.01)) / 0.02  # dx per dz: the band's direction
            norm = sqrt(1 + dz * dz)
            px, pz = 1 / norm, -dz / norm  # perpendicular, in the x-z plane
            row = []
            for off in (-0.5, 0.0, 0.5):
                x, zz = cx + px * band_width * off, z + pz * band_width * off
                hit, normal = surface.front(x, zz)
                row.append(hit + normal * band_lift)
            rings.append(row)
        strip(p, rings, key)
        for a, b in zip(rings, rings[1:]):
            for j in range(3):
                mid = (a[j] + b[j]) / 2
                c = surface.clearance(mid)
                low, high = min(low, c), max(high, c)

    # the undershirt shows in the V above the crossing, under both bands
    v_rows = [LAPEL_TOP_Z] + torso_ring_heights(LAPEL_CROSS[1], LAPEL_TOP_Z) + [LAPEL_CROSS[1] + 0.004]
    v_rings = []
    for z in v_rows:
        xl, xr = over_edge_x(z), under_edge_x(z)
        row = []
        for x in (xl, (xl + xr) / 2, xr):
            hit, normal = surface.front(x, z)
            row.append(hit + normal * lift * 0.3)
        v_rings.append(row)
    strip(p, v_rings, "cream")

    band(LAPEL_TOP_Z, LAPEL_END[1], over_edge_x, "seam", lift, width)
    band(LAPEL_TOP_Z, LAPEL_CROSS[1], under_edge_x, "seam", lift * 0.8, width * 0.85)
    print("LAPEL clearance over the torso: min %.4f max %.4f" % (low, high))
    assert low > 0.0003 and high < 0.0045, "the lapels must lie on the torso, not sink into it or float off it"


def strip(p, rows, key):
    """A flat ribbon over the chest; every quad is wound so it faces the front (+Y)."""
    bm = p.bm
    vr = [[bm.verts.new(v) for v in row] for row in rows]
    for i in range(len(vr) - 1):
        for j in range(2):
            quad = [vr[i][j], vr[i][j + 1], vr[i + 1][j + 1], vr[i + 1][j]]
            f = p.face(quad, key)
            f.normal_update()
            if f.normal.y < 0:
                f.normal_flip()


def build_tie(p, surface):
    """The jacket's string: a small knot where the over edge ends, at the wearer's right side, with two short tails."""
    x, z = LAPEL_END
    hit, normal = surface.front(x, z)
    out = normal.normalized()
    p.ellipsoid(hit + out * 0.004, (0.011, 0.0085, 0.011), "seam", u=8, v=4)
    for dx, dz, tilt in ((-0.005, -0.038, 0.30), (0.010, -0.034, -0.22)):
        tail, tail_n = surface.front(clamp(x + dx, -0.18, 0.18), z + dz)
        p.ellipsoid(tail + tail_n.normalized() * 0.0035, (0.0070, 0.0040, 0.0280), "seam", rot=(0, tilt, 0), u=6, v=4)


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


SHOULDER_CAP_R = 0.020  # radius of the shoulder cap at the joint: the sleeve narrows to it from SHOULDER_R, so the root tucks under the jaw
SHOULDER_TAPER = 0.3  # how far from the cap radius to the sleeve radius the sleeve has widened a fifth of the way down the upper arm (0 = the cap radius, 1 = SHOULDER_R)
SHOULDER_DOME = 0.5  # height of the shoulder cap over the joint, as a fraction of the cap radius
SLEEVE_FLARE = 0.010  # how much wider the cuff is than the sleeve at the elbow
ELBOW_BILLOW = 1.2  # sleeve width at the elbow relative to the shoulder
ELBOW_R = SHOULDER_R * ELBOW_BILLOW


def build_sleeve_upper():
    p = Part("sleeveUpper")
    n = SEGMENTS["sleeve"]
    r = SHOULDER_R
    arm = RIG["upperArm"]
    tube = [
        ring_xy(0.0, 0.0, -arm, ELBOW_R, ELBOW_R, n),
        ring_xy(0.0, 0.0, -arm * 0.6, lerp(r, ELBOW_R, 0.5), lerp(r, ELBOW_R, 0.5), n),
        ring_xy(0.0, 0.0, -arm * 0.2, lerp(SHOULDER_CAP_R, r, SHOULDER_TAPER), lerp(SHOULDER_CAP_R, r, SHOULDER_TAPER), n),
    ]
    dome = dome_rings(SHOULDER_CAP_R, n, 3, squash=SHOULDER_DOME)
    p.loft(tube + dome, "jacket", cap_last=Vector((0.0, 0.0, SHOULDER_CAP_R * SHOULDER_DOME)))  # no cap at the elbow: its flat normal would shade the last ring dark
    return p.to_object()


def build_sleeve_lower():
    p = Part("sleeveLower")
    n = SEGMENTS["sleeve"]
    fore = RIG["foreArm"]
    cuff = SHOULDER_R * 1.07 + SLEEVE_FLARE  # the long loose sleeve widens toward the wrist and ends in an open cuff
    end = -(fore - 0.012)
    rings = [
        ring_xy(0.0, 0.0, end - 0.004, 0.032, 0.032, n),
        ring_xy(0.0, 0.0, end - 0.002, cuff - 0.016, cuff - 0.016, n),
        ring_xy(0.0, 0.0, end + 0.0, cuff - 0.01, cuff - 0.01, n),
        ring_xy(0.0, 0.0, end + 0.005, cuff + 0.003, cuff + 0.003, n),
        ring_xy(0.0, 0.0, end + 0.014, cuff - 0.003, cuff - 0.003, n),
        ring_xy(0.0, 0.0, -fore * 0.4, lerp(ELBOW_R, cuff, 0.5), lerp(ELBOW_R, cuff, 0.5), n),
    ]
    # a hemisphere about the elbow pivot stays round at any bend
    elbow_ball = [ring_xy(0.0, 0.0, ELBOW_R * sin(radians(a)), ELBOW_R * cos(radians(a)), ELBOW_R * cos(radians(a)), n) for a in (0, 10, 35, 62)]
    p.loft(rings + elbow_ball, "jacket", cap_last=Vector((0.0, 0.0, ELBOW_R)))
    return p.to_object()


def build_hand():
    p = Part("hand")
    n = SEGMENTS["hand"]
    profile = [  # z, half-width, half-depth (origin at the wrist, fingers hang down), drawn for a 0.102 hand, 0.2 H wide
        (-0.070, 0.014, 0.013),
        (-0.062, 0.027, 0.021),
        (-0.046, 0.035, 0.027),
        (-0.028, 0.036, 0.028),
        (-0.010, 0.030, 0.024),
        (0.008, 0.026, 0.022),
        (0.021, 0.026, 0.022),
    ]
    tip = -0.074
    stretch = -HAND["reach"] / tip  # the part below the wrist is lengthened to the wrist-to-fingertip reach ...
    grow = HAND["reach"] / HAND_DRAWN_REACH * 1.5  # ... and grows sideways a bit more than that, so it reads as a stubby mitt
    rings = [ring_xy(0.0, 0.0, z * stretch if z < 0 else z, w * grow, d * grow, n) for z, w, d in profile]
    p.loft(rings, "skin", cap_first=Vector((0.0, 0.0, tip * stretch)), cap_last=True)
    return p.to_object()


FOOT_WIDEN = 1.55  # the sock was drawn 0.096 wide; the foot is 0.45 H (0.1485) across
FOOT_LENGTHEN = 1.05


def foot_geometry():
    """Rings and the two end poles of the sock, in the ankle frame. Toes point toward +Y; the sole is at z = -footY."""
    n = SEGMENTS["foot"]
    sole = -RIG["footY"]
    flat = RIG["footY"] / 0.092  # the sock was drawn 0.092 high; it is pressed flat so its top reaches the ankle pivot, under the trouser cuff
    wide, long = FOOT_WIDEN, FOOT_LENGTHEN  # the chibi's feet are broad, flat pads: 0.45 H across
    stations = [  # y, half-width, bottom z, top z (above the sole)
        (-0.054, 0.021, 0.011, 0.065),
        (-0.044, 0.036, 0.002, 0.090),
        (-0.017, 0.044, 0.0, 0.092),
        (0.017, 0.048, 0.0, 0.074),
        (0.054, 0.044, 0.0, 0.054),
        (0.088, 0.034, 0.002, 0.047),
        (0.117, 0.022, 0.012, 0.059),
        (0.136, 0.011, 0.036, 0.077),
    ]
    rings = []
    for y, w, zb, zt in stations:
        zb, zt = sole + zb * flat, sole + zt * flat
        zc, h = (zb + zt) / 2, (zt - zb) / 2
        rings.append([Vector((w * wide * cos(2 * pi * k / n), y * long, zc - h * sin(2 * pi * k / n))) for k in range(n)])
    heel = Vector((0.0, -0.065 * long, sum(v.z for v in rings[0]) / n))
    toe = Vector((0.0, 0.144 * long, sum(v.z for v in rings[-1]) / n + 0.007 * flat))
    return rings, heel, toe


def build_foot():
    """버선: a cream sock with the upturned tip."""
    p = Part("foot")
    n = SEGMENTS["foot"]
    rings, heel, toe = foot_geometry()
    bm = p.bm
    vr = [[bm.verts.new(v) for v in ring] for ring in rings]
    for i in range(len(vr) - 1):
        for j in range(n):
            k = (j + 1) % n
            p.face([vr[i][j], vr[i][k], vr[i + 1][k], vr[i + 1][j]], "sock")
    for ring, pole, flip in ((vr[0], heel, True), (vr[-1], toe, False)):
        c = bm.verts.new(pole)
        for j in range(n):
            k = (j + 1) % n
            p.face([c, ring[k], ring[j]] if flip else [c, ring[j], ring[k]], "sock")
    return p.to_object()


def build_leg():
    """Bare calf under a cream knee sock with a folded cuff. Frame: origin at the top pivot (inside the trousers, legTopDrop below
    the hip), the leg hangs toward -Z for legLength down to the ankle pivot. monk-model.ts stretches it from the hip to the
    ankle every frame, so only its length changes (cuff and sock stay round, never sheared)."""
    p = Part("leg")
    n = SEGMENTS["leg"]
    length = RIG["legLength"]
    r = LEG["radius"]
    cuff = LEG["sock_top"]

    def ring(above_ankle, radius):
        return ring_xy(0.0, 0.0, -length + above_ankle, radius, radius, n)

    sock = [  # the bottom end hides inside the foot's instep
        ring(-0.008, r * 0.9),
        ring(0.03, r * 0.97),
        ring(0.12, r * 1.03),
        ring(cuff - 0.036, r * 1.06),
        ring(cuff - 0.030, r * 1.20),
        ring(cuff - 0.005, r * 1.20),
        ring(cuff, r * 1.08),
    ]
    p.loft(sock, "sock", cap_first=True, cap_last=True)
    calf = [ring(cuff - 0.012, r * 0.95), ring(0.25, r * 0.97), ring(length - 0.03, r * 1.0), ring(length - 0.008, r * 0.9)]
    p.loft(calf, "skin", cap_last=True)
    return p.to_object()


def foot_top():
    rings, heel, toe = foot_geometry()
    return max(max(v.z for ring in rings for v in ring), heel.z, toe.z)


RIG["footKneelY"] = round(foot_top() + 0.001, 4)  # folded sole-up, the top of the sock rests on the cushion


BUILDERS = {
    "head": build_head,
    "face": build_face,
    "hair": build_hair,
    "pelvis": build_pelvis,
    "torso": build_torso,
    "trim": build_trim,
    "sleeveUpper": build_sleeve_upper,
    "sleeveLower": build_sleeve_lower,
    "hand": build_hand,
    "foot": build_foot,
    "leg": build_leg,
    "trousers": build_trousers,
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


ARM_REACH = RATIO["upper_arm"] + RATIO["fore_arm"] + round(RATIO["hand"] * HEAD_H, 3) / HEAD_H  # shoulder joint to fingertip, in H


def face_box(parts, key, side=0):
    """Bounding box (x0, x1, z0, z1) of the face polygons painted `key` (side -1 / 1: only the left / right half)."""
    mesh = parts["face"].data
    slot = [m.name for m in mesh.materials].index("monk_" + key)
    xs, zs = [], []
    for poly in mesh.polygons:
        if poly.material_index != slot:
            continue
        for i in poly.vertices:
            co = mesh.vertices[i].co
            if side == 0 or co.x * side > 0:
                xs.append(co.x)
                zs.append(co.z)
    return min(xs), max(xs), min(zs), max(zs)


def check_face(parts, chin):
    """The closed eyes, the smile and the blush, measured on the finished face mesh in head heights above the chin."""
    wanted = {}
    for side in (-1, 1):
        x0, x1, z0, z1 = face_box(parts, "eye", side)
        wanted["eye width / H (side %d)" % side] = ((x1 - x0) / H, 2 * FACE["eye_halfwidth"] / H, 0.02)
        wanted["eye height / H (side %d)" % side] = (((z0 + z1) / 2 - chin) / H, FACE["eye_f"], 0.02)
        wanted["eye centre x / H (side %d)" % side] = (abs(x0 + x1) / 2 / H, FACE["eye_x"] / H, 0.01)
        x0, x1, z0, z1 = face_box(parts, "blush", side)
        wanted["blush length / H (side %d)" % side] = ((x1 - x0) / H, 2 * FACE["blush_radii"][0] / H, 0.01)
        wanted["blush height / H (side %d)" % side] = (((z0 + z1) / 2 - chin) / H, FACE["blush_f"], 0.02)
    x0, x1, z0, z1 = face_box(parts, "mouth")
    wanted["mouth width / H"] = ((x1 - x0) / H, 2 * FACE["mouth_halfwidth"] / H, 0.03)
    wanted["mouth height / H"] = (((z0 + z1) / 2 - chin) / H, FACE["mouth_f"], 0.02)
    for label, (value, want, tol) in wanted.items():
        print("FACE %-28s %.4f (want %.4f +- %.3f)" % (label, value, want, tol))
        assert abs(value - want) <= tol, "%s is %.4f, wanted %.4f +- %.3f" % (label, value, want, tol)


def check_face_on_head(parts):
    """The eyes, the smile and the blush are drawn over the head, never in it (a buried stroke breaks into pieces) and never
    floating off it: every corner, edge middle and centre of their polygons, measured against the finished head mesh, is a hair
    above it, and each polygon faces the way the skin there does."""
    head = world_bvh(parts["head"], Matrix.Identity(4))
    mesh = parts["face"].data
    slots = [m.name for m in mesh.materials]
    for key in ("eye", "mouth", "blush"):
        samples, facing = [], 1.0
        for poly in mesh.polygons:
            if poly.material_index != slots.index("monk_" + key):
                continue
            corners = [mesh.vertices[i].co for i in poly.vertices]
            samples += corners + [poly.center] + [(corners[i] + corners[(i + 1) % len(corners)]) / 2 for i in range(len(corners))]
            normal = head.find_nearest(poly.center)[1]
            facing = min(facing, poly.normal.dot(normal))
        heights = [clearance_of(head, point) for point in samples]
        print("FACE %-6s %3d samples %.4f .. %.4f above the head, facing the skin %.2f" % (key, len(samples), min(heights), max(heights), facing))
        assert min(heights) >= 0.0008, "the %s sinks %.4f into the head" % (key, 0.0008 - min(heights))
        assert max(heights) <= 0.004, "the %s floats %.4f off the head" % (key, max(heights))
        assert facing > 0.8, "a polygon of the %s faces away from the head (%.2f)" % (key, facing)


def check_proportions(parts):
    """Measures the finished meshes (not the config numbers) against the reference, in head heights where H is the crown
    to the lowest jaw vertex, and fails the build when a ratio drifts."""
    head = [v.co for v in parts["head"].data.vertices]
    crown = max(v.z for v in head)
    chin = min(v.z for v in head if v.y > JAW_FRONT)  # Blender +Y is the face side
    size = crown - chin
    jacket_bottom = min(v.co.z for v in parts["torso"].data.vertices)
    pelvis_bottom = min(v.co.z for v in parts["pelvis"].data.vertices)
    cuff_bottom = min(v.co.z for v in parts["trousers"].data.vertices)
    foot = [v.co.z for v in parts["foot"].data.vertices]
    leg = [v.co.z for v in parts["leg"].data.vertices]
    hip, neck = RIG["hipStand"], NECK_Y
    sole = RIG["footY"] + min(foot)
    hem = hip + jacket_bottom  # the jacket's lower edge
    crotch = hip + pelvis_bottom
    cuff = hip - RIG["legTopDrop"] + cuff_bottom  # the trouser cuff, legs straight
    shoulder = hip + SHOULDER_Y
    upper = -min(v.co.z for v in parts["sleeveUpper"].data.vertices)  # the sleeve's lower edge sits on the elbow pivot
    hand = -min(v.co.z for v in parts["hand"].data.vertices)  # wrist pivot down to the fingertip
    elbow = shoulder - upper
    wrist = elbow - RIG["foreArm"]
    fingertip = wrist - hand  # arms hanging straight
    reach = shoulder - fingertip
    knee_vertex = max(parts["trousers"].data.vertices, key=lambda v: v.co.x)  # the trouser leg is widest at the knee
    knee = hip - RIG["legTopDrop"] + knee_vertex.co.z
    ankle = sole + RIG["footY"]
    foot_x = [v.co.x for v in parts["foot"].data.vertices]
    idle = pose_matrices(0.0, 0.0)
    hip_joints = idle["leg"][1].translation.x - idle["leg"][0].translation.x
    sleeve_x = [(m @ v.co).x for key in ("sleeveUpper", "sleeveLower", "hand") for m in idle[key] for v in parts[key].data.vertices]
    span = max(sleeve_x) - min(sleeve_x)  # the arms hanging at rest: the silhouette from one sleeve to the other
    measured = {
        "H (crown to chin, m)": (size, HEAD_H, 0.002),
        "standing height / H": ((hip + neck + crown - sole) / size, STAND_H, 0.05),
        "hip / H (hip to sole)": ((hip - sole) / size, RATIO["waist_to_sole"], 0.02),
        "chin to hip / H": ((neck + chin) / size, RATIO["chin_to_hip"], 0.02),
        "shoulder joint / H": ((shoulder - sole) / size, STAND_H - 1 - RATIO["chin_to_shoulder"], 0.02),
        "elbow / H": ((elbow - sole) / size, STAND_H - 1 - RATIO["chin_to_shoulder"] - RATIO["upper_arm"], 0.02),
        "wrist / H": ((wrist - sole) / size, STAND_H - 1 - RATIO["chin_to_shoulder"] - RATIO["upper_arm"] - RATIO["fore_arm"], 0.02),
        "fingertip / H": ((fingertip - sole) / size, STAND_H - 1 - RATIO["chin_to_shoulder"] - ARM_REACH, 0.02),
        "upper arm / H": (upper / size, RATIO["upper_arm"], 0.01),
        "forearm / H": (RIG["foreArm"] / size, RATIO["fore_arm"], 0.01),
        "hand / H": (hand / size, RATIO["hand"], 0.01),
        "shoulder to fingertip / H": (reach / size, ARM_REACH, 0.02),
        "elbow along the arm": (upper / reach, RATIO["upper_arm"] / ARM_REACH, 0.01),
        "knee / H": ((knee - sole) / size, RATIO["knee"], 0.01),
        "ankle pivot / H": ((ankle - sole) / size, RATIO["ankle"], 0.01),
        "thigh / H (hip to knee)": ((hip - knee) / size, RATIO["waist_to_sole"] - RATIO["knee"], 0.02),
        "shin / H (knee to ankle)": ((knee - ankle) / size, RATIO["knee"] - RATIO["ankle"], 0.02),
        "head width / H": ((max(v.x for v in head) - min(v.x for v in head)) / size, RATIO["head_width"], 0.03),
        "head depth / H": ((max(v.y for v in head) - min(v.y for v in head)) / size, RATIO["head_depth"], 0.03),
        "robe width / H": ((max(v.co.x for v in parts["torso"].data.vertices) - min(v.co.x for v in parts["torso"].data.vertices)) / size, RATIO["robe_width"], 0.02),
        "foot width / H": ((max(foot_x) - min(foot_x)) / size, 0.45, 0.02),
        "hip joints apart / H": (hip_joints / size, RATIO["hip_joints"], 0.01),
        "sleeve to sleeve / H": (span / size, RATIO["shoulder_breadth"], 0.05),
        "jacket hem above sole / H": ((hem - sole) / size, RATIO["waist_to_sole"] - JACKET_HEM, 0.03),
        "crotch above sole / H": ((crotch - sole) / size, RATIO["waist_to_sole"] - PELVIS_DEPTH, 0.03),
        "trouser cuff above sole / H": ((cuff - sole) / size, RATIO["cuff"], 0.01),
    }
    for label, (value, want, tol) in measured.items():
        print("MEASURED %-28s %.4f (want %.4f +- %.3f)" % (label, value, want, tol))
        assert abs(value - want) <= tol, "%s is %.4f, wanted %.4f +- %.3f" % (label, value, want, tol)
    print("MEASURED jacket hem above sole (m): %.4f, trouser cuff: %.4f, standing crown (m): %.4f" % (hem - sole, cuff - sole, hip + neck + crown - sole))
    foot_top_y = RIG["footY"] + max(foot)
    assert foot_top_y < cuff, "the foot must stay below the trouser cuff so the sock shows"
    assert crotch < hem and hem < hip, "the trousers' seat must hang below the jacket hem, which hangs below the hip"
    leg_top, leg_bottom = hip - RIG["legTopDrop"] + max(leg), hip - RIG["legTopDrop"] + min(leg)
    assert leg_top > cuff and leg_bottom < foot_top_y, "the leg must bridge the trouser cuff and the foot"
    check_face(parts, chin)
    print("MEASURED hair top above head crown: %.4f" % (max(v.co.z for v in parts["hair"].data.vertices) - crown))


def check_kneel_clearance(parts):
    """Nothing may sink into the cushion when kneeling, and the hem must rest on it."""
    cushion = RIG["seatTop"]
    lowest = {}
    for part, matrices in pose_matrices(1.0, cushion).items():
        mesh = parts[part].data
        lowest[part] = min((m @ v.co).z for m in matrices for v in mesh.vertices)
    for part, z in lowest.items():
        print("KNEEL lowest %-12s %.4f above the cushion" % (part, z - cushion))
        assert z >= cushion - 0.0005, "%s sinks %.4f into the cushion" % (part, cushion - z)
    assert lowest["pelvis"] - cushion < 0.02, "the kneeling seat of the trousers hovers over the cushion"


def check_kneel_hands(parts):
    """The praying hands stay outside the robe and the neck, below the chin, and do not cross the middle of the chest."""
    mats = pose_matrices(1.0, RIG["seatTop"])
    to_torso = mats["torso"][0].inverted()
    torso = TorsoSurface()
    chin = NECK_Y + CHIN_Z
    worst_torso, worst_neck = 1.0, 1.0
    for side, m in enumerate(mats["hand"]):
        for v in parts["hand"].data.vertices:
            p = to_torso @ (m @ v.co)
            worst_torso = min(worst_torso, torso.clearance(p))
            worst_neck = min(worst_neck, math.hypot(p.x, p.y - 0.004) - 0.046) if p.z > NECK_Y - 0.025 else worst_neck
            assert p.z < chin, "a praying fingertip rises above the chin (%.4f)" % (p.z - chin)
            assert (p.x <= 0.012) if side == 0 else (p.x >= -0.012), "the praying hands cross the middle by %.4f" % abs(p.x)
    print("KNEEL hand clearance: robe %.4f, neck %.4f (praying)" % (worst_torso, worst_neck))
    assert worst_torso >= -0.002, "the praying hands sink %.4f into the robe" % -worst_torso
    assert worst_neck >= -0.002, "the praying hands sink %.4f into the neck" % -worst_neck


def world_bvh(obj, matrix):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


BOW_DEPTHS = (0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0)  # the bow's way down (and back up), from the first tilt to the deepest
BOW_CLEARANCE = {  # what each arm part must stay clear of, in metres: a margin of 0 only forbids sinking in
    "head": {"hand": 0.004, "sleeveLower": 0.0, "sleeveUpper": 0.001},
    "torso": {"hand": 0.0, "sleeveLower": 0.0},
    "pelvis": {"hand": 0.005, "sleeveLower": 0.005, "sleeveUpper": 0.005},  # the seat of the trousers
    "trousers": {"hand": 0.005, "sleeveLower": 0.005, "sleeveUpper": 0.005},  # both trouser legs
}
BOW_HANDS_GAP = 0.06  # the hands, palm to palm across the middle, stay at most this far apart: together under the face
BOW_CUFFS_CROSS = 0.002  # from the half bow on, a cuff crosses the middle by at most this much (before that, by no more than the prayer does)


def middle_cross(parts, mats, part):
    """How far the part, either copy, reaches past the middle of the body (negative: it stays clear by that much)."""
    return max(max((m @ v.co).x * (1 if side == 0 else -1) for v in parts[part].data.vertices) for side, m in enumerate(mats[part]))


def check_bow(parts):
    """Every depth of the bow: nothing sinks into the seat (a cushion, or a thinner mat: the plane at the seat top is the safe bound
    for both), the arms and hands stay clear of the head, the torso, the seat of the trousers and both trouser legs, the two forearms
    do not go through each other (the praying cuffs overlap a little where they meet, and the bow never more than that), and the
    hands lie side by side, together under the face and never across the middle."""
    cushion = RIG["seatTop"]
    prayer_cuffs = middle_cross(parts, pose_matrices(1.0, cushion), "sleeveLower")
    for bow in BOW_DEPTHS:
        mats = pose_matrices(1.0, cushion, bow=bow)
        for part, matrices in mats.items():
            low = min((m @ v.co).z - cushion for m in matrices for v in parts[part].data.vertices)
            assert low >= -0.0005, "%s sinks %.4f into the seat at bow %.3f" % (part, -low, bow)
        for target, margins in BOW_CLEARANCE.items():
            trees = [world_bvh(parts[target], m) for m in mats[target]]
            for part, margin in margins.items():
                near = min(clearance_of(tree, m @ v.co) for tree in trees for m in mats[part] for v in parts[part].data.vertices)
                if bow == BOW_DEPTHS[-1]:
                    print("BOW %-12s clearance from the %s %.4f" % (part, target, near))
                assert near >= margin, "the %s at bow %.3f comes within %.4f of the %s (it needs %.4f)" % (part, bow, near, target, margin)
        cuffs = middle_cross(parts, mats, "sleeveLower")
        assert cuffs <= prayer_cuffs + 0.0005, "the cuffs cross the middle by %.4f at bow %.3f, more than in prayer (%.4f)" % (cuffs, bow, prayer_cuffs)
        assert bow < 0.5 or cuffs <= BOW_CUFFS_CROSS, "the forearms go through each other by %.4f at bow %.3f" % (cuffs, bow)
        hands = middle_cross(parts, mats, "hand")
        assert hands <= 0.0, "the bowing hands cross the middle by %.4f at bow %.3f" % (hands, bow)
        gap = -2 * hands
        assert gap <= BOW_HANDS_GAP, "the bowing hands are %.4f apart at bow %.3f" % (gap, bow)
        if bow == BOW_DEPTHS[-1]:
            print("BOW cuffs cross the middle by %.4f (prayer %.4f), hands %.4f apart" % (cuffs, prayer_cuffs, gap))


def check_sleeves_clear_head(parts):
    """The whole sleeves and the hands stay out of the head standing, at either end of a stride, and kneeling in prayer (the bow is
    in check_bow). The shoulder is right under the jaw in this chibi, so this holds the root of the sleeve to it too."""
    cushion = RIG["seatTop"]
    for label, kneel, stride in (("standing", 0.0, 0.0), ("stride forward", 0.0, 1.0), ("stride back", 0.0, -1.0), ("praying", 1.0, 0.0)):
        mats = pose_matrices(kneel, cushion if kneel else 0.0, stride)
        head = world_bvh(parts["head"], mats["head"][0])
        for part in ("sleeveUpper", "sleeveLower", "hand"):
            near_head = min(clearance_of(head, m @ v.co) for m in mats[part] for v in parts[part].data.vertices)
            print("HEAD %-14s %-12s clearance from the head %.4f" % (label, part, near_head))
            assert near_head >= 0.0, "the %s %s sinks %.4f into the head" % (label, part, -near_head)


def check_standing_hands(parts):
    """The hanging hands and cuffs stay outside the baggy hips and thighs."""
    mats = pose_matrices(0.0, 0.0)
    pelvis = world_bvh(parts["pelvis"], mats["pelvis"][0])
    legs = [world_bvh(parts["trousers"], m) for m in mats["trousers"]]
    for part, limit in (("hand", -0.002), ("sleeveLower", -0.012)):
        worst = 1.0
        for m in mats[part]:
            for v in parts[part].data.vertices:
                p = m @ v.co
                worst = min(worst, clearance_of(pelvis, p), *(clearance_of(leg, p) for leg in legs))
        print("STAND %-12s clearance from the hips and legs %.4f" % (part, worst))
        assert worst >= limit, "the hanging %s sinks %.4f into the hips or legs" % (part, -worst)


def rig_dict():
    return {
        "_source": "packages/client/assets/monk/build_monk.py",
        "headHeight": round(H, 5),
        "crownY": round(CROWN_Z, 5),
        "chinY": round(CHIN_Z, 5),
        "hipStand": RIG["hipStand"],
        "hipKneel": RIG["hipKneel"],
        "jacketDrop": RIG["jacketDrop"],
        "pelvisDrop": RIG["pelvisDrop"],
        "torsoHeight": round(TORSO_H, 5),
        "neckY": round(NECK_Y, 5),
        "shoulderX": RIG["shoulderX"],
        "shoulderY": round(SHOULDER_Y, 5),
        "upperArm": RIG["upperArm"],
        "foreArm": RIG["foreArm"],
        "footX": RIG["footX"],
        "footY": RIG["footY"],
        "footForward": RIG["footForward"],
        "footKneelZ": RIG["footKneelZ"],
        "footKneelY": RIG["footKneelY"],
        "footKneelTilt": round(RIG["footKneelTilt"], 5),
        "legKneelLift": RIG["legKneelLift"],
        "legTopDrop": RIG["legTopDrop"],
        "legLength": RIG["legLength"],
        "kneelPelvisGrow": RIG["kneelPelvisGrow"],
        "kneelPelvisScaleY": RIG["kneelPelvisScaleY"],
        "kneelPelvisLift": RIG["kneelPelvisLift"],
        "bowHipForward": RIG["bowHipForward"],
        "bowSeatBack": RIG["bowSeatBack"],
        "seatTop": RIG["seatTop"],
        "robeTintSaturation": RIG["robeTintSaturation"],
        "robeTintLightness": RIG["robeTintLightness"],
    }


PROBE_PARTS = ("head", "pelvis", "sleeveUpper", "sleeveLower", "hand")
PROBE_BOWS = (0.0, 0.25, 0.5, 0.75, 1.0)


def pose_probe(parts):
    """The world bounds (three.js axes: min x, y, z then max x, y, z) of the first copy of a few parts, kneeling at each bow depth.
    The checks above run on pose_matrices, a copy of animate() in monk-model.ts; a test replays the bow there and holds it to these."""
    out = {"bows": list(PROBE_BOWS)}
    for part in PROBE_PARTS:
        rows = []
        for bow in PROBE_BOWS:
            m = pose_matrices(1.0, RIG["seatTop"], bow=bow)[part][0]
            points = [m @ v.co for v in parts[part].data.vertices]
            low = (min(p.x for p in points), min(p.z for p in points), -max(p.y for p in points))
            high = (max(p.x for p in points), max(p.z for p in points), -min(p.y for p in points))
            rows.append([round(c, 4) for c in low + high])
        out[part] = rows
    return out


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
    three_euler = Euler(rot, "ZYX").to_matrix().to_4x4()  # three.js "XYZ" multiplies Rx @ Ry @ Rz, which is Blender's "ZYX"
    return Matrix.Translation(Vector(pos)) @ three_euler @ Matrix.Diagonal(Vector((*scale, 1.0)))


def pose_matrices(kneel, cushion, stride=0.0, bow=0.0):
    """World matrices (Blender axes) for every part copy in the idle (kneel=0) or praying (kneel=1) rest pose.
    stride (-1 .. 1) swings the feet and arms like the walk cycle does, so the stretched legs can be checked; bow (0 .. 1, kneeling
    only) tips the torso and head forward with the arms reaching out, like the bow animation at its deepest."""
    lift = cushion * kneel
    hips = tmat((0, lift + lerp(RIG["hipStand"], RIG["hipKneel"], kneel), -RIG["bowHipForward"] * bow))
    grow = 1 + RIG["kneelPelvisGrow"] * kneel
    pelvis = hips @ tmat((0, RIG["kneelPelvisLift"] * kneel, RIG["bowSeatBack"] * bow), scale=(grow, lerp(1, RIG["kneelPelvisScaleY"], kneel), grow))
    torso = hips @ tmat((0, 0, 0), (-POSE["bow_lean"] * bow, 0, 0))
    head = torso @ tmat((0, NECK_Y, 0), (-POSE["bow_head"] * bow, 0, 0))
    out = {"head": [head], "face": [head], "hair": [head], "pelvis": [pelvis], "torso": [torso], "trim": [torso]}
    for key in ("sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers"):
        out[key] = []
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        pray = kneel * (1 - bow)
        swing = POSE["walk_swing"] * stride * sign * (1 - kneel)
        arm_x = lerp(POSE["idle_x"], POSE["pray_x"], kneel)
        arm_x = arm_x + (POSE["bow_x"] - arm_x) * bow + swing
        arm_y = sign * POSE["pray_y"] * pray
        arm_z = -sign * (POSE["idle_z"] + (POSE["pray_z"] - POSE["idle_z"]) * pray + (POSE["bow_z"] - POSE["idle_z"]) * bow * kneel)
        shoulder = torso @ tmat((sign * RIG["shoulderX"], SHOULDER_Y, 0), (arm_x, arm_y, arm_z))
        elbow_x = lerp(POSE["idle_elbow"], POSE["pray_elbow"], kneel)
        elbow_x = elbow_x + (POSE["bow_elbow"] - elbow_x) * bow + max(0.0, -swing) * 0.5
        elbow = shoulder @ tmat((0, -RIG["upperArm"], 0), (elbow_x, -sign * POSE["pray_twist"] * pray, 0))
        hand = elbow @ tmat((0, -RIG["foreArm"], 0))
        foot_y = lift + lerp(RIG["footY"], RIG["footKneelY"], kneel)
        foot_z = lerp(-RIG["footForward"], RIG["footKneelZ"], kneel) + stride * sign * 0.2
        foot = tmat((sign * RIG["footX"], foot_y, foot_z), (RIG["footKneelTilt"] * kneel, 0, 0))
        top_y = hips.translation.y - RIG["legTopDrop"]
        reach_y, reach_z = foot_y + RIG["legKneelLift"] * kneel - top_y, foot_z - hips.translation.z
        leg = tmat(
            (sign * RIG["footX"], top_y, hips.translation.z),
            (atan2(-reach_z, -reach_y), 0, 0),
            (1, sqrt(reach_y**2 + reach_z**2) / RIG["legLength"], 1),
        )
        out["leg"].append(leg)
        out["trousers"].append(leg)
        out["sleeveUpper"].append(shoulder)
        out["sleeveLower"].append(elbow)
        out["hand"].append(hand)
        out["foot"].append(foot)
    return {k: [C4 @ m @ C4.inverted() for m in v] for k, v in out.items()}


def robe_tint(hue):
    """The colour monk-model.ts multiplies into the robe's vertex colours for a monk of this hue. three.js' setHSL reads the HSL as
    linear channel values (the working colour space), so no sRGB conversion here."""
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360.0, RIG["robeTintLightness"], RIG["robeTintSaturation"])
    return (r, g, b, 1.0)


def build_pose(name, parts, kneel, tint_hue=None, cushion=RIG["seatTop"], stride=0.0, bow=0.0):
    coll = new_collection(name)
    mats = pose_matrices(kneel, cushion, stride, bow)
    robe = {"torso", "pelvis", "trousers", "sleeveUpper", "sleeveLower"}
    for part, matrices in mats.items():
        src = parts[part]
        data = src.data
        if tint_hue is not None and part in robe:
            data = src.data.copy()
            tint = robe_tint(tint_hue)
            attr = data.color_attributes[COLOR_LAYER]
            for item in attr.data:
                item.color = [c * t for c, t in zip(item.color, tint)]
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
    walking = build_pose("preview_walking", parts, 0.0, PREVIEW_HUE, stride=0.85)
    kneeling = build_pose("preview_kneeling", parts, 1.0, PREVIEW_HUE)
    bowing = build_pose("preview_bowing", parts, 1.0, PREVIEW_HUE, bow=1.0)
    for coll in list(bpy.data.collections):
        coll.hide_render = coll.name.startswith("monk_")
    walking.hide_render = kneeling.hide_render = bowing.hide_render = True
    mid = (0, 0, 0.66)
    for name, az in (("monk_front", 0), ("monk_side", 90), ("monk_back", 180), ("monk_three_quarter", 38)):
        render_view(cam, name, az, mid, 1.7)
    face_mid = (0, SKULL_CY, NECK_Y + CHIN_Z + 0.55 * H + RIG["hipStand"])
    for name, az in (("monk_face_front", 0), ("monk_face_three_quarter", 38), ("monk_face_side", 80)):
        render_view(cam, name, az, face_mid, 0.5)
    standing.hide_render = True
    walking.hide_render = False
    render_view(cam, "monk_walk_side", 90, mid, 1.7)
    walking.hide_render = True
    kneeling.hide_render = False
    kmid = (0, 0, 0.66)
    for name, az in (("monk_kneel_front", 0), ("monk_kneel_three_quarter", 38), ("monk_kneel_side", 90)):
        render_view(cam, name, az, kmid, 1.7)
    kneeling.hide_render = True
    bowing.hide_render = False
    for name, az in (("monk_bow_front", 0), ("monk_bow_three_quarter", 38), ("monk_bow_side", 90)):
        render_view(cam, name, az, (0, 0.3, 0.4), 1.7)
    for coll in (standing, walking, kneeling, bowing):
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
    check_proportions(parts)
    check_face_on_head(parts)
    check_kneel_clearance(parts)
    check_kneel_hands(parts)
    check_bow(parts)
    check_sleeves_clear_head(parts)
    check_standing_hands(parts)

    glb = os.path.join(HERE, "monk.glb")
    export_glb(parts_coll, glb)
    print("WROTE", glb, os.path.getsize(glb), "bytes")

    rig_path = os.path.join(HERE, "monk-rig.json")
    with open(rig_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rig_dict(), fh, indent=2)
        fh.write("\n")
    print("WROTE", rig_path)

    poses_path = os.path.join(HERE, "monk-poses.json")
    with open(poses_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"_source": "packages/client/assets/monk/build_monk.py", "bow": pose_probe(parts)}, fh, separators=(",", ":"))
        fh.write("\n")
    print("WROTE", poses_path)

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
