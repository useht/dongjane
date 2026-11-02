"""Builds the child-monk (동자승) model from scratch. Every monk in the game shares this one model.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python packages/client/assets/monk/build_monk.py
    (add "-- --no-render" after the script to skip the preview PNGs)

Writes next to this script:
    monk.blend     editable source. Parts sit at their pivots in the hidden "monk_parts" collection; the visible
                    "monk_pose_standing" collection holds linked copies in rest pose, so editing either edits both.
                    To re-export by hand: unhide monk_parts, make it the active collection, glTF export with
                    "Active Collection" ticked, Vertex Color = Material.
    monk.glb        what the game loads (Y-up; the face ends up on three.js -Z)
    monk-rig.json   pivot and length numbers the TypeScript rig reads (generated from the same config below)
    monk-poses.json where each part's bounds fall in the bow, walk and fishing poses (probes for the TypeScript tests)
and monk-bend-samples.json: where bend_vertex puts a dozen jacket vertices at each depth, the numbers
the TypeScript copy of the bend is held to; and previews to <temp>/monk-preview/ (or $MONK_PREVIEW_DIR; never into the repo).

Parts (one mesh object each, named exactly like the slot in monk-model.ts), each built in the local frame of its pivot:
    head, face, hair, pelvis, jacket, trim, sleeveUpper, sleeveLower, hand, foot, leg, trousers
sleeveUpper, sleeveLower, hand, foot, leg and trousers are mirror-symmetric about x = 0 because one geometry serves both sides.
The head is shaved: the scalp shade is a smooth vertex-colour gradient on the head itself (no cap mesh, so there is no
edge to show). "hair" stays as a swappable slot but holds only a tiny scalp-coloured core buried inside the skull, so
nothing sits above the scalp until a hairstyle is dropped in.
The outfit is a Korean child-monk set taken from a reference photograph (kept outside this repository): an ash-grey jacket and darker grey
baggy trousers. The jacket is one part, "jacket": the chest (crossed front with the left panel over the right, long sleeves in
sleeveUpper / sleeveLower) and the tunic below it in a single closed surface, modelled upright. Bowing, every vertex of it is bent
by one position-based curve (bend_vertex): below RIG bendLength under the hip pivot it stays where it is, between there and the pivot it
curves forward at a constant rate, and from the pivot up to the neck it goes on curving at a slower one (the back's hump); above the neck it is stiff and turns with the head. "trim" is the collar, crossing edges and
side tie, laid on the same surface and bent with it. The trousers are two parts: "trousers" is one baggy
leg that hangs from the same pivot as "leg" (the bare calf + cream knee sock inside it, mostly hidden) and is stretched with it,
so it follows strides, bobbing and the folded kneeling feet; "pelvis" is the seat of the trousers below the jacket hem,
bound to the hips, which closes the gap between the two legs and rests on the cushion when kneeling.
The jacket ends JACKET_HEM below the hip pivot, the trouser cuff stops CUFF_ABOVE_ANKLE above the ankle, and the cream sock
shows below it.
Robe parts (jacket, pelvis, trousers, sleeveUpper, sleeveLower) are light and dark grey; the game tints them per monk by
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
import struct
import sys
import tempfile
import warnings
from math import asin, atan2, cos, degrees, pi, radians, sin, sqrt
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

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
    "cuff": 0.278,  # the trouser cuff above the sole, just over the ankle (0.26 in the reference; higher, so the rim of the cuff of a leg that swings far forward, tilted, still clears the foot)
}
STAND_H = 3.4  # standing height in head heights: 3.4등신
JACKET_HEM = 0.90  # in H: the jacket hem hangs this far below the hip pivot (a long tunic that ends at the knee)
PELVIS_DEPTH = 1.04  # in H: the crotch of the trousers hangs this far below the hip pivot; a kneeling monk sits on it, which keeps the jacket hem 5 cm above the seat

RIG = {  # pivots and lengths the animation code uses
    "hipStand": round(RATIO["waist_to_sole"] * HEAD_H, 3),
    "hipKneel": 0.0,  # set below: the kneeling seat of the trousers rests on the heels
    "jacketDrop": round(JACKET_HEM * HEAD_H, 3),  # the jacket hem hangs this far below the hip pivot
    "pelvisDrop": round(PELVIS_DEPTH * HEAD_H, 3),  # the crotch of the trousers hangs this far below the hip pivot
    "shoulderX": 0.11,
    "shoulderDrop": 0.0,  # set below: shoulder joint below the neck base
    "upperArm": round(RATIO["upper_arm"] * HEAD_H, 3),
    "foreArm": round(RATIO["fore_arm"] * HEAD_H, 3),
    "footX": round(RATIO["hip_joints"] / 2 * HEAD_H, 4),  # half the distance between the hip joints
    "footY": round(RATIO["ankle"] * HEAD_H, 4),  # the ankle pivot above the sole; the flat sock's top reaches it
    "footForward": 0.03,  # standing: the ankle sits this far in front of the hip, the toes reach a hand further
    "footKneelX": 0.1,  # kneeling (정좌): the ankles sit this far either side of the middle, the heels apart under the seat ...
    "footKneelZ": 0.013,  # ... the sole-up foot's heel pad right under the hip, the toes pointing back past the trousers ...
    "footKneelTilt": pi,
    "footKneelYaw": 0.76,  # ... each foot turned in this far, so the big toes meet behind the seat ...
    "footOverTilt": 0.155,  # ... and the right foot's toes lie over the left's: it is pitched up by this much at the toes ...
    "footOverShift": 0.039,  # ... moved this much back ...
    "footOverLift": 0.0065,  # ... and held this much higher, resting on the left foot's instep
    "legKneelLift": 0.046,  # kneeling: the leg lower end lies this far above the foot pivot, on top of the folded foot, so the trouser cuff clears the cushion
    "legTopDrop": 0.12,  # the leg's top pivot hangs this far below the hip pivot, inside the pelvis of the trousers
    "legKneelTopY": 0.085,  # kneeling: the top pivot becomes the knee, this far above the seat (the leg folds: thigh under the jacket, shin along the cushion) ...
    "legKneelTopForward": 0.12,  # ... this far in front of the hip ...
    "legKneelTopX": 0.166,  # ... and this far either side of the middle: the knees a hand-span (0.2 m, 0.6 H) apart
    "legKneelFlat": 0.62,  # kneeling: the shin is pressed to this share of its standing depth, so it lies on the cushion instead of standing on its edge
    "kneelPelvisGrow": 0.25,  # kneeling spreads the trousers' pelvis sideways ...
    "kneelPelvisScaleY": 1.0,  # ... and keeps its height, so its underside rests on the heels
    "kneelPelvisLift": 0.0,
    "bendLength": 0.20,  # bowing, the jacket bends in one smooth curve from this far below the hip pivot up to the pivot (its base stays on the thighs) ...
    "bendUpper": 0.80,  # ... and goes on bending, from the pivot up to the neck, by this many radians more at the deepest bow (the bow_lean of the lower span): the back rounds into the hump of a 큰절 and the head hangs from the neck at its end; above the neck everything is stiff and turns with it
    "bendForward": 0.10,  # the curve runs along an axis this far in front of the hip pivot's origin: the jacket's front folds on the inside of the bend, its back stretches on the outside
    "bendFold": 0.8,  # the front of the bend may fold by this much at most: the curvature times the distance in front of the axis
    "kneelSkirtScale": 0.86,  # kneeling gathers the jacket below the hip pivot to this share of its length: the hem comes to rest on the thighs and the folded legs show below it
    "seatTop": 0.13,
    "robeTintSaturation": 1.0,  # the game multiplies HSL(hue, this, that) into the grey robe: a muted hue that still reads as grey 승복
    "robeTintLightness": 0.78,
}
RIG["shoulderDrop"] = round((RATIO["chin_to_shoulder"] - RATIO["neck"]) * HEAD_H, 4)
RIG["legLength"] = round(RIG["hipStand"] - RIG["legTopDrop"] - RIG["footY"], 4)  # top pivot down to the ankle pivot, standing
CUFF_ABOVE_ANKLE = round(RATIO["cuff"] * HEAD_H - RIG["footY"], 4)  # the trouser cuff stops this far above the ankle pivot, so the foot shows below it

HAND = {"reach": round(RATIO["hand"] * HEAD_H, 3)}  # wrist pivot down to the fingertip
HAND_DRAWN_REACH = 0.102  # the wrist-to-fingertip reach the hand's width profile was drawn for

POSE = {  # arm angles of the idle, walking, praying and bowing poses (radians; z is positive inward); a copy of the numbers in monk-model.ts, used by the previews
    "idle_x": 0.08,
    "idle_z": -0.61,  # the arms hang straight, splayed about 35 degrees, so the sleeves clear the wide robe
    "idle_elbow": 0.1,
    "walk_swing": 0.5,  # the arm swings this far at full stride, opposite the same side's leg ...
    "walk_elbow": 0.5,  # ... and the back swing bends the elbow by this share of the swing
    "walk_stride": 0.2,  # the foot travels this far fore and aft of its rest place at full stride
    "walk_hip_shift": 0.05,  # the top of a leg slides this far back as its foot swings forward (and forward as it swings back), so the thigh does not push through the jacket
    "walk_lift": 0.07,  # a foot passing under the body is lifted this high
    "walk_bob": 0.03,  # the hips bob this high at full stride (twice a cycle)
    "walk_lean": 0.05,  # the torso leans this far forward (radians) ...
    "walk_head_tilt": 0.03,  # ... and the head tips back a little against it
    "walk_head_roll": 0.035,  # the head rolls this far with each step
    "fish_lean": 0.06,  # holding a rod (a copy of ROD_POSE in monk-items.ts): the monk leans back against the pull ...
    "fish_roll": 0.3,  # ... both arms roll in toward the middle of the chest ...
    "fish_lead_x": 1.1,  # ... the lead hand, which grips the rod (high enough that a downward tug does not sink the elbow into the jacket) ...
    "fish_lead_elbow": 0.7,
    "fish_rear_x": 0.96,  # ... and the rear hand, which steadies the butt (a straight arm held out in front of the belly, clear of the jacket and the lead arm)
    "fish_rear_elbow": 0.0,
    "fish_tug": 0.07,  # a fish on the line jerks the lead shoulder this far (and the torso by fish_tug_lean of it) ...
    "fish_tug_lean": 0.4,
    "fish_sway": 0.02,  # ... on top of the slow sway of the rod
    "pray_x": 0.924,
    "pray_y": 0.315,
    "pray_z": 0.185,
    "pray_elbow": 1.301,
    "pray_twist": 1.478,
    "bow_lean": 1.54,  # 88 degrees: the back is level at the deepest
    "bow_head": 0.2866,  # the head tucks down this far more at the deepest
    "bow_x": 1.836,  # the arms hang from shoulders slid down the front of the folded chest, the hands together on the cushion under the face
    "bow_z": 0.13,
    "bow_y": -0.048,
    "bow_twist": -1.41,
    "bow_elbow": 0.186,
    "bow_drop": 0.083,  # the shoulders slide this far toward the chest's front (down, once the back is level) ...
    "bow_dx": -0.024,  # ... this far inward ...
    "bow_dy": -0.105,  # ... and this far down the torso, so the straight arms reach the cushion past the jaw
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
PART_ORDER = ["head", "face", "hair", "pelvis", "jacket", "trim", "sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers"]
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


def ring_xy(cx, cy, z, rx, ry, n, power=2.0, phase=0.0, back_power=None):
    """A superellipse ring in the plane at z; back_power (the half behind the middle, y < cy) is squarer or rounder than the front's."""
    pts = []
    for k in range(n):
        a = phase + 2 * pi * k / n
        p = power if back_power is None or sin(a) >= 0 else back_power
        pts.append(Vector((cx + rx * smooth_pow(cos(a), p), cy + ry * smooth_pow(sin(a), p), z)))
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
HEM_ROLL = {"height": 0.030, "side": 0.022, "front": 0.022, "back": 0.040}  # the hem turns under over this height, and this far in at the sides, the front and the back (the back tucks the furthest, where the thighs are not): a roll, so the lower edge shades into the trousers below it instead of ending in a flat shelf, and the thighs still lie inside it walking
HEM_ROLL_ANGLES = (90.0, 60.0, 30.0, 0.0)  # the roll is a quarter of an ellipse, one ring at each of these angles round it from the lower edge (90) up to where it joins the tunic (0): one straight bevel read as a diagonal where the hem corner meets the sky, three facets of 30 degrees read as the corner they stand for


def hem_roll():
    """The rolled hem's rings, lowest first, and the back's extra depth at each (BACK_PROFILE form): at angle t round the quarter ellipse a
    ring is 1 - cos t of the way in from the tunic's full size, and sin t of the way down the roll's height."""
    rows, back = [], {}
    for degree in HEM_ROLL_ANGLES:
        t = radians(degree)
        z = -JACKET_DROP + HEM_ROLL["height"] * (1.0 - sin(t))
        inset = 1.0 - cos(t)
        rows.append((z, 0.198 - HEM_ROLL["side"] * inset, 0.176 - HEM_ROLL["front"] * inset, 2.4))
        if inset > 0.0:
            back[z] = ((HEM_ROLL["front"] - HEM_ROLL["back"]) * inset, 2.4)
    return rows, back


HEM_ROWS, HEM_BACK = hem_roll()

TORSO_PROFILE = [  # z, half-width, half-depth, superellipse power. The jacket: a long tunic that flares from a narrow, shallow yoke under the head to its widest (1.2 H) over the lower body, so the splayed arms stay clear of it and the praying hands fit in front of the chest
    *HEM_ROWS,
    (-0.150, 0.197, 0.172, 2.4),
    (-0.050, 0.188, 0.143, 2.4),
    (0.000, 0.1705, 0.1218, 2.46),  # the hinge, at the hip pivot: the bend ends here (on the line between its neighbours)
    (0.030, 0.160, 0.109, 2.5),
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


BACK_PROFILE = {  # z: how much deeper the back runs behind the profile's depth there, and the power of the back half of the ring. The back is squarer over the hip, so the chest comes out of the tunic's square back as one body, and rounder at the shoulder blade, so no corner stands out of it; the front is the profile's, where the arms and the trim lie. The hem's own back tucks in further than its front
    **HEM_BACK,
    -0.050: (0.0, 2.8),
    0.000: (0.0, 3.6),
    0.030: (0.010, 3.4),
    0.100: (0.008, 2.6),
}


def mix_specs(a, b, t):
    return tuple(lerp(x, y, t) for x, y in zip(a, b))


def ring_spec(z, w, d, power):
    """A profile row with the back's extra depth and power: (z, half-width, half-depth, power, extra, back power)."""
    extra, back_power = BACK_PROFILE.get(z, (0.0, power))
    return (z, w, d, power, extra, back_power)


BEND_FACET = radians(10.6)  # the bend turns each facet of the jacket by this much at most at the deepest bow; the front, which the bend compresses and shears, turns up to two degrees more (JACKET_BEND facet). Tuned so the rings fit the monk's byte budget
BEND_RINGS_FROM = -round(RIG["bendLength"] / RIG["kneelSkirtScale"], 4)  # the rings are dense from here up to the hinge: the kneeling jacket is gathered, so this is where its curve begins


def bend_turn(low, high):
    """How far the bend turns between the heights low and high of the upright jacket at the deepest bow: below the hinge the larger of
    standing, where it covers bendLength, and gathered, where it covers more of the upright jacket and turns less of it per metre;
    above it the upper span's constant rate up to the neck (the gather does not reach there)."""
    length, gather = RIG["bendLength"], RIG["kneelSkirtScale"]
    standing = max(0.0, min(high, 0.0) - max(low, -length)) * POSE["bow_lean"] / length
    gathered = max(0.0, min(high, 0.0) - max(low, -length / gather)) * gather * POSE["bow_lean"] / length
    upper = max(0.0, min(high, NECK_Y) - max(low, 0.0)) * RIG["bendUpper"] / NECK_Y
    return max(standing, gathered) + upper


def jacket_specs():
    """The jacket's rings, bottom to top: the profile's own rows (the silhouette is drawn straight between them) and, from
    BEND_RINGS_FROM up to the neck, rows on those lines in between, so that the bend turns no facet by more than BEND_FACET."""
    rows = [ring_spec(*row) for row in TORSO_PROFILE]
    for a, b in zip(rows, rows[1:]):
        if a[0] < BEND_RINGS_FROM < b[0]:
            rows.insert(rows.index(b), mix_specs(a, b, (BEND_RINGS_FROM - a[0]) / (b[0] - a[0])))
            break
    specs = [rows[0]]
    for a, b in zip(rows, rows[1:]):
        steps = math.ceil(bend_turn(a[0], b[0]) / BEND_FACET - 1e-9) if BEND_RINGS_FROM - 1e-9 <= a[0] and b[0] <= NECK_Y + 1e-9 else 1
        specs += [mix_specs(a, b, k / steps) for k in range(1, steps)] + [b]
    return specs


def ring_of(spec):
    z, w, d, power, extra, back_power = spec
    return ring_xy(0.0, -extra / 2, z, w, d + extra / 2, SEGMENTS["torso"], power, back_power=back_power)


def jacket_rings():
    return [ring_of(spec) for spec in jacket_specs()]


HINGE_Z = 0.0  # the hip pivot: where the lower span of the jacket's bend ends and the upper one begins
BEND_UPPER = RIG["bendUpper"] / POSE["bow_lean"]  # the upper span turns this share of what the lower one does, at every depth
BEND_NECK = round(NECK_Y, 5)  # the upper span ends here (the rig's neckY): the jacket's top ring is at NECK_Y, a hair under it at most
BEND_MEET = 1e-5  # a height this close to where two spans meet is that height (a vertex is a float32, the rig's numbers are rounded)
UP = Vector((0.0, 0.0, 1.0))


def bend_curve(h, theta):
    """The bend's axis (f = bendForward in the waist frame) at the upright height h, already gathered: where it is as (f, h), the
    angle phi it has turned to there, and the rate at which it turns there (a surface squeezed along the axis stretches by 1 - rate
    times its distance in front of the axis; at the height where two spans meet it is their mean, so a ring of the jacket there is
    shaded as the seam between them). Two spans of constant rate: from bendLength under the hinge up to it, theta over bendLength;
    from the hinge up to the neck, theta * BEND_UPPER over BEND_NECK. Below the base the axis stays put, above the neck it goes on
    straight."""
    length, forward = RIG["bendLength"], RIG["bendForward"]
    low, high = theta / length, theta * BEND_UPPER / BEND_NECK
    if abs(h - HINGE_Z) < BEND_MEET:
        rate = (low + high) / 2
    elif abs(h - BEND_NECK) < BEND_MEET:
        rate = high / 2
    elif -length < h < HINGE_Z:
        rate = low
    elif HINGE_Z < h < BEND_NECK:
        rate = high
    else:
        rate = 0.0
    if h <= HINGE_Z:
        u = h + length
        s = clamp(u, 0.0, length)
        phi = low * s
        c, sn = cos(phi), sin(phi)
        return (forward + (1 - c) / low + (u - s) * sn, -length + sn / low + (u - s) * c), phi, rate
    v = min(h, BEND_NECK)
    phi = theta + high * v
    c, sn = cos(phi), sin(phi)
    ca, sa = cos(theta), sin(theta)
    return (forward + (1 - ca) / low + (ca - c) / high + (h - v) * sn, -length + sa / low + (sn - sa) / high + (h - v) * c), phi, rate


def bend_vertex(co, n, theta, gather=1.0):
    """The one bend the jacket takes when bowing: where the point `co` (with the shading normal `n`) of the upright jacket goes, and
    its normal, with the chest turned forward by `theta` below the hinge and BEND_UPPER of it more up to the neck. gather (kneeling:
    1 standing, less when the jacket is gathered on the thighs) shortens everything below the hinge first. The bend works in the
    waist frame: h the height, f the forward distance (+Y), x untouched. Below the base (h = -bendLength) nothing moves. From there
    up to the hinge the jacket curves forward at the constant rate theta / bendLength about the axis f = bendForward, and from the
    hinge up to the neck at the constant rate theta * BEND_UPPER / NECK_Y (bend_curve): arc length along the axis is kept, the front
    (f above the axis) is compressed and the back stretched, and a point keeps its distance from the axis, so a facet never leaves
    the curve. Above the neck it is one rigid body with the head (bend_frame_at), which keeps the curve's end tangent."""
    forward = RIG["bendForward"]
    f, h = co.y, co.z
    n_f, n_h = n.y, n.z
    if h < 0.0:
        h *= gather
        n_h /= gather
    if theta < 1e-4:
        return Vector((co.x, f, h)), Vector((n.x, n_f, n_h)).normalized()
    (axis_f, axis_h), phi, rate = bend_curve(h, theta)
    o = f - forward
    c, sn = cos(phi), sin(phi)
    n_o, n_s = n_f, n_h / (1.0 - rate * o)
    position = Vector((co.x, axis_f + o * c, axis_h - o * sn))
    return position, Vector((n.x, n_o * c + n_s * sn, -n_o * sn + n_s * c)).normalized()


def bend_point(co, theta, gather=1.0):
    return bend_vertex(co, UP, theta, gather)[0]


def bend_frame_at(h, theta):
    """The frame the bend gives the upright height h (Blender axes, in the jacket's own): the point of the axis plane f = 0 at h
    where the bend puts it, turned forward by the angle the bend has turned to there. The hinge's is the frame of the lean; the
    neck's carries the head, and everything above the neck is rigid in it; the shoulders ride the frame of the height they slid to."""
    turned = bend_curve(h, theta)[1] if theta >= 1e-4 else 0.0
    return Matrix.Translation(bend_point(Vector((0.0, 0.0, h)), theta)) @ Matrix.Rotation(-turned, 4, "X")


def bend_frame(theta):
    """The frame of the hinge: what the lean of the chest is measured in."""
    return bend_frame_at(HINGE_Z, theta)


class BentMatrix:
    """The jacket's pose as the checks and the previews see it, in place of a matrix: the bend about the waist, then `node`, the
    matrix that carries the waist (the hips, leaning when it walks). `m @ co` is a point of the jacket in the world."""

    def __init__(self, theta, gather, node):
        self.theta, self.gather, self.node = theta, gather, node
        self.straight = theta < 1e-4 and gather == 1.0

    def __matmul__(self, co):
        return self.node @ (co if self.straight else bend_point(co, self.theta, self.gather))

    def normal(self, co, n):
        return (self.node.to_3x3() @ (n if self.straight else bend_vertex(co, n, self.theta, self.gather)[1])).normalized()

    def frame(self, h):
        """The matrix of the frame the bend gives the upright height h (bend_frame_at): the head rides the neck's, the shoulders the
        one of the height they slid to."""
        return self.node @ bend_frame_at(h, self.theta)

    @property
    def chest(self):
        """The matrix of the hinge: the frame the lean of the chest is measured in."""
        return self.frame(HINGE_Z)

    def converted(self, c4):
        return BentMatrix(self.theta, self.gather, c4 @ self.node @ c4.inverted())


def check_bend():
    """The bend is the identity upright, one rigid body above the neck, continuous (position and axis direction) where its spans meet,
    keeps the arc along its axis in both spans and keeps the normals normal."""
    samples = [Vector((x, f, h)) for x in (0.0, 0.1) for f in (-0.15, 0.0, 0.08, 0.15) for h in (-0.28, -0.2, -0.12, -0.04, 0.0, 0.05, 0.17, 0.18, 0.3)]
    normals = [Vector(v).normalized() for v in ((0, 1, 0), (0, 0.6, 0.8), (0.3, -0.7, 0.2), (0, 0, 1), (0, 0, -1))]
    thetas, gathers = (0.4, 1.0, POSE["bow_lean"]), (1.0, RIG["kneelSkirtScale"])
    worst_still = worst_rigid = worst_join = worst_length = worst_normal = 0.0
    for p in samples:
        for n in normals:
            q, m = bend_vertex(p, n, 0.0)
            worst_still = max(worst_still, (q - p).length, (m - n).length)
            if p.z < BEND_NECK:
                continue
            for theta in thetas:
                for gather in gathers:
                    frame = bend_frame_at(BEND_NECK, theta)
                    q, m = bend_vertex(p, n, theta, gather)
                    worst_rigid = max(worst_rigid, (q - frame @ (p - Vector((0.0, 0.0, BEND_NECK)))).length, (m - frame.to_3x3() @ n).length)
    length, forward = RIG["bendLength"], RIG["bendForward"]

    def plane(f, h, theta, gather):  # bend_point in the plane of the bend and in double precision (mathutils' vectors are single)
        axis, phi, _ = bend_curve(h * gather if h < 0.0 else h, theta)
        return axis[0] + (f - forward) * cos(phi), axis[1] - (f - forward) * sin(phi)

    def direction(a, b):
        d = (b[0] - a[0], b[1] - a[1])
        return d[0] / math.hypot(*d), d[1] / math.hypot(*d)

    eps = 1e-6
    for theta in thetas:
        for gather in gathers:
            steps = 4000
            for low, high, arc in ((-length / gather, HINGE_Z, length), (HINGE_Z, BEND_NECK, BEND_NECK)):  # the arc of the axis in each span (the gather shortens the lower one's upright height to bendLength)
                axis = [plane(forward, low + (high - low) * i / steps, theta, gather) for i in range(steps + 1)]
                worst_length = max(worst_length, abs(sum(math.dist(a, b) for a, b in zip(axis, axis[1:])) - arc))
            for seam in (HINGE_Z, BEND_NECK):  # one curve through where the spans meet: no step, no kink
                axis = [plane(forward, seam + side * eps, theta, gather) for side in (-2, -1, 1, 2)]
                a, b = direction(axis[0], axis[1]), direction(axis[2], axis[3])
                step = eps * (1.0 + (gather if seam == HINGE_Z else 1.0))  # a micron either side: the gather shortens the jacket under the hinge only
                worst_join = max(worst_join, math.dist(a, b), abs(math.dist(axis[1], axis[2]) / step - 1.0))
            for f, slope in ((0.12, 0.0), (0.12, 0.3), (-0.1, -0.2), (0.17, 0.5)):
                for h in (-0.19, -0.1, -0.02, 0.02, 0.08, 0.15):
                    p0 = Vector((0.0, f + slope * h, h))
                    n = Vector((0.0, 1.0, -slope)).normalized()
                    q0, m0 = bend_vertex(p0, n, theta, gather)
                    tangent = direction(plane(f + slope * h, h, theta, gather), plane(f + slope * (h + eps), h + eps, theta, gather))
                    worst_normal = max(worst_normal, abs(tangent[0] * m0.y + tangent[1] * m0.z))
    print("BEND identity upright %.1e, rigid above the neck %.1e, axis through the seams %.1e off, arc length off by %.1e, normal against tangent %.1e" % (worst_still, worst_rigid, worst_join, worst_length, worst_normal))
    assert worst_still < 1e-9 and worst_rigid < 1e-6, "the bend must be the identity upright and one rigid body above the neck"  # (mathutils' matrices are single precision)
    assert worst_join < 1e-4, "the bend's axis must run on without a kink where its spans meet"
    assert worst_length < 1e-4, "the bend must keep the arc length along its axis"
    assert worst_normal < 1e-3, "the bent normals must stay perpendicular to the bent surface"


def build_jacket():
    """The chest and the tunic as one closed jacket, upright: the surface the thighs, the sleeves and the hands are held against."""
    p = Part("jacket")
    p.loft(jacket_rings(), "jacket", cap_first=True, cap_last=True)
    return p.to_object()


HEM_TILT = radians(30)  # how far below the horizontal the hem's lowest ring is shaded: it turns under, it does not face down


def shade_hem_normals(jacket):
    """The lowest ring shares its vertices with the flat bottom cap, so its smooth normals point almost straight down and shade
    near black: the hem's turned-under back would catch the light as a hard dark rim across the thighs. It is shaded as the tucked
    edge it is instead, its horizontal direction kept and tilted HEM_TILT below the horizontal."""
    mesh = jacket.data
    low = min(v.co.z for v in mesh.vertices)
    normals = [Vector(n.vector) for n in mesh.vertex_normals]
    for v in mesh.vertices:
        flat = Vector((normals[v.index].x, normals[v.index].y, 0.0))
        if abs(v.co.z - low) < 1e-6 and flat.length > 0.1:
            flat.normalize()
            normals[v.index] = Vector((flat.x * cos(HEM_TILT), flat.y * cos(HEM_TILT), -sin(HEM_TILT)))
    mesh.normals_split_custom_set_from_vertices(normals)


PARITY_RAY = Vector((0.371, 0.613, 0.696)).normalized()


def inside_surface(tree, point):
    """True when the point is inside the closed surface: a ray from it crosses the surface an odd number of times."""
    origin = point.copy()
    crossings = 0
    while True:
        hit = tree.ray_cast(origin, PARITY_RAY)[0]
        if hit is None:
            return crossings % 2 == 1
        crossings += 1
        origin = hit + PARITY_RAY * 1e-6


def clearance_of(tree, point):
    """Signed distance from a closed surface's BVH tree (positive = outside). Beside a rim the nearest face can face away from a point
    that is plainly outside (the hem's underside against a point just above it), so a negative sign is confirmed by counting crossings."""
    hit, normal, _, dist = tree.find_nearest(point)
    if (point - hit).dot(normal) >= 0:
        return dist
    return -dist if inside_surface(tree, point) else dist


class JacketSurface:
    """The faceted jacket mesh itself (not the smooth curve it is sampled from), so trim can sit exactly on it."""

    def __init__(self):
        self.bm = bmesh.new()
        n = SEGMENTS["torso"]
        vr = [[self.bm.verts.new(v) for v in ring] for ring in jacket_rings()]
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


PELVIS_PROFILE = [  # z, half-width, half-depth. The seat of the trousers: tucked under the jacket (never wider than its hem), a little of it showing below the hem, then rounding off into the crotch. It ends where the jacket's bend begins: above that the jacket curves forward and nothing of the seat stands in it
    (-PELVIS_DROP, 0.050, 0.044),
    (-PELVIS_DROP + 0.014, 0.100, 0.082),
    (-0.320, 0.130, 0.100),
    (-0.290, 0.140, 0.108),
    (-RIG["bendLength"], 0.140, 0.108),
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
        (cuff + 0.026, 0.0580, 0.0620),  # the fabric billows out of the gather ...
        (cuff + 0.080, 0.0640, 0.0720),  # ... and hangs full to the knee
        (knee, 0.0665, 0.0840),
        (-0.050, 0.0650, 0.1020),  # thigh: as deep as the seat it hangs from, so legs and seat read as one garment
        (0.000, 0.0630, 0.1000),
    ]
    rings = [ring_xy(0.0, 0.0, z, w, d, n, 2.3) for z, w, d in stations]
    p.loft(rings, "trousers", cap_last=Vector((0.0, 0.0, 0.012)))  # open at the cuff; the top shows as the knee when kneeling
    return p.to_object()


def build_trim():
    """The collar, the crossed front and the tie, laid on the jacket and bent with it."""
    return trim_decals().to_object()


def trim_decals():
    p = Part("trim")
    surface = JacketSurface()
    if OUTFIT["collar_ring"]:
        collar = []
        for z, grow in ((TORSO_H - 0.012, 0.007), (TORSO_H - 0.003, 0.006), (TORSO_H + 0.009, 0.0)):
            hw, hd, power = torso_at(min(z, TORSO_H))
            collar.append(ring_xy(0.0, 0.0, z, hw + grow, hd + grow, 16, 2.0))
        p.loft(collar, "seam")
    build_lapels(p, surface)
    if OUTFIT["tie"]:
        build_tie(p, surface)
    return p


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
    return [spec[0] for spec in reversed(jacket_specs()) if lo + 0.008 < spec[0] < hi - 0.004]


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
    dome = dome_rings(SHOULDER_CAP_R, n, 2, squash=SHOULDER_DOME)
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
    p.loft(rings, "skin", cap_first=Vector((0.0, 0.0, tip * stretch)))  # the wrist end stays open: a cap is 20 triangles, the budget has none left
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
    p.loft(calf, "skin")
    return p.to_object()


def foot_low(tilt):
    """How far below its pivot the foot reaches (negative) once it is turned about the pivot's sideways axis by `tilt`, in three.js axes."""
    rings, heel, toe = foot_geometry()
    points = [v for ring in rings for v in ring] + [heel, toe]
    return min(v.z * cos(tilt) + v.y * sin(tilt) for v in points)  # three.js y' = y cos - z sin, with y = Blender z and z = -Blender y


RIG["footKneelY"] = round(0.001 - foot_low(RIG["footKneelTilt"]), 4)  # folded sole-up, the top of the sock rests on the cushion
RIG["heelTop"] = round(RIG["footKneelY"] + RIG["footY"], 4)  # ... which puts the soles of the folded feet this high over the cushion
RIG["hipKneel"] = round(RIG["pelvisDrop"] * RIG["kneelPelvisScaleY"] + RIG["heelTop"], 3)  # the kneeling seat of the trousers rests on the heels
RIG["legKneelTopDrop"] = round(RIG["hipKneel"] - RIG["legKneelTopY"], 4)  # the kneeling knee hangs this far below the hip pivot


BUILDERS = {
    "head": build_head,
    "face": build_face,
    "hair": build_hair,
    "pelvis": build_pelvis,
    "jacket": build_jacket,
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
    jacket_bottom = min(v.co.z for v in parts["jacket"].data.vertices)
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
        "robe width / H": ((max(v.co.x for v in parts["jacket"].data.vertices) - min(v.co.x for v in parts["jacket"].data.vertices)) / size, RATIO["robe_width"], 0.02),
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
    """Nothing may sink into the cushion when kneeling, and the seat rests on the heels, a heel's height above it."""
    cushion = RIG["seatTop"]
    lowest = {}
    for part, matrices in pose_matrices(1.0, cushion).items():
        mesh = parts[part].data
        lowest[part] = min((m @ v.co).z for m in matrices for v in mesh.vertices)
    for part, z in lowest.items():
        print("KNEEL lowest %-12s %.4f above the cushion" % (part, z - cushion))
        assert z >= cushion - 0.0005, "%s sinks %.4f into the cushion" % (part, cushion - z)
    assert 0.06 < lowest["pelvis"] - cushion < 0.075, "the kneeling seat of the trousers is %.4f above the cushion, not on the heels" % (lowest["pelvis"] - cushion)


def check_kneel_hands(parts):
    """The praying hands stay outside the robe and the neck, below the chin, and do not cross the middle of the chest."""
    mats = pose_matrices(1.0, RIG["seatTop"])
    to_torso = mats["jacket"][0].chest.inverted()
    torso = JacketSurface()
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


def world_bvh(obj, matrix, below=None):
    """The part's faces in the world as a BVH tree; the matrix may be a BentMatrix. below: only the faces of the upright part whose
    vertices all lie at or under this height, closed by a lid (the tunic of the jacket, from the hip pivot down)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if below is not None:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if max(v.co.z for v in f.verts) > below + 1e-9], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        rim = [e for e in bm.edges if e.is_boundary]
        bmesh.ops.holes_fill(bm, edges=rim, sides=len(rim))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if isinstance(matrix, BentMatrix):
        for v in bm.verts:
            v.co = matrix @ v.co
    else:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree
BOW_DEPTHS = (0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0)  # the bow's way down (and back up), from the first tilt to the deepest
BOW_CLEARANCE = {  # what each arm part must stay clear of, in metres: a margin of 0 only forbids sinking in
    "head": {"hand": 0.004, "sleeveLower": 0.0, "sleeveUpper": 0.001},
    "jacket": {"hand": 0.0, "sleeveLower": 0.0, "sleeveUpper": -0.03},  # the root of the sleeve sits inside the shoulder: 27 mm deep at the first tilt, and the bow brings it back out to 19 mm
    "tunic": {"hand": 0.0, "sleeveLower": 0.0, "sleeveUpper": 0.0},  # the jacket from the hip pivot down, bent: nothing sinks into it
    "pelvis": {"hand": 0.005, "sleeveLower": 0.005, "sleeveUpper": 0.005},  # the seat of the trousers
    "trousers": {"hand": 0.005, "sleeveLower": 0.005, "sleeveUpper": 0.005},  # both trouser legs
}
BOW_HANDS_GAP = 0.06  # the hands, palm to palm across the middle, stay at most this far apart: together under the face
BOW_HANDS_REST = 0.05  # at the deepest bow the hands lie on the cushion: their lowest point is less than this above it
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
            trees = [world_bvh(parts["jacket"], m, HINGE_Z) for m in mats["jacket"]] if target == "tunic" else [world_bvh(parts[target], m) for m in mats[target]]
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
            rest = min((m @ v.co).z for m in mats["hand"] for v in parts["hand"].data.vertices) - cushion
            print("BOW cuffs cross the middle by %.4f (prayer %.4f), hands %.4f apart, %.4f above the seat top (they may be %.2f)" % (cuffs, prayer_cuffs, gap, rest, BOW_HANDS_REST))
            assert rest < BOW_HANDS_REST, "the hands hover %.4f above the seat at the deepest bow (they may hover %.2f)" % (rest, BOW_HANDS_REST)


def down_gap(tree, point):
    """How far straight down from the point to the surface below it (None when there is none)."""
    hit = tree.ray_cast(point, Vector((0.0, 0.0, -1.0)))[0]
    return None if hit is None else point.z - hit.z


KNEEL_SEAT = {  # the seat on the heels and the feet under it, in metres
    "rest": (-0.002, 0.004),  # the underside of the seat above the top of each heel: resting on it, not sunk into it, not hovering
    "instep": (-0.0005, 0.004),  # the lowest point of each instep above the cushion: laid flat on it
    "toes_back": 0.12,  # each foot's toe tip lies this far behind its heel at least
    "overlap": (0.01, 0.04),  # how far the toes of the two feet overlap across the middle, the heels staying apart
    "over": (0.0, 0.01),  # the right foot lies on the left, never sunk into it and never lifted more than this off it
    "upright": 0.005,  # the seated back is straight: the head sits this near above the middle of the seat, at most
}


def check_kneel_seat(parts):
    """The seated pose (정좌): the buttocks rest on both heels, each instep lies flat on the cushion with the toes pointing back, the
    big toes cross with the right foot over the left, and the back stands straight up from the seat to the head."""
    cushion = RIG["seatTop"]
    mats = pose_matrices(1.0, cushion)
    feet = [world_bvh(parts["foot"], m) for m in mats["foot"]]
    pelvis = [mats["pelvis"][0] @ v.co for v in parts["pelvis"].data.vertices]
    seat = min(p.z for p in pelvis)
    low, high = KNEEL_SEAT["rest"]
    for side, tree in enumerate(feet):
        rest = min(g for g in (down_gap(tree, p) for p in pelvis if p.z < seat + 0.004) if g is not None)
        print("SEAT rests on the %s heel by %.4f (it needs %.4f to %.4f)" % ("left" if side == 0 else "right", rest, low, high))
        assert low <= rest <= high, "the seat is %.4f off the %s heel (it needs %.4f to %.4f)" % (rest, "left" if side == 0 else "right", low, high)
    points = [[m @ v.co for v in parts["foot"].data.vertices] for m in mats["foot"]]
    for side, pts in enumerate(points):
        name = "left" if side == 0 else "right"
        flat = min(p.z for p in pts) - cushion
        toes = max(p.y for p in pts) - min(p.y for p in pts)
        print("SEAT %s instep %.4f above the cushion, the toes %.4f behind the heel, foot x %.4f to %.4f" % (name, flat, toes, min(p.x for p in pts), max(p.x for p in pts)))
        assert KNEEL_SEAT["instep"][0] <= flat <= KNEEL_SEAT["instep"][1], "the %s instep is %.4f off the cushion (it needs %.4f to %.4f)" % ((name, flat) + KNEEL_SEAT["instep"])
        assert toes >= KNEEL_SEAT["toes_back"], "the %s toes reach only %.4f behind the heel (it needs %.4f)" % (name, toes, KNEEL_SEAT["toes_back"])
        toe = min(pts, key=lambda p: p.y)
        heel = max(pts, key=lambda p: p.y)
        assert (toe.x - heel.x) * (1 if side == 0 else -1) > 0, "the %s toes point away from the middle, so the big toes cannot meet" % name
    overlap = max(p.x for p in points[0]) - min(p.x for p in points[1])
    gap = min(g for g in (down_gap(feet[0], p) for p in points[1]) if g is not None)
    print("SEAT the toes overlap %.4f, the right foot lies %.4f over the left" % (overlap, gap))
    assert KNEEL_SEAT["overlap"][0] <= overlap <= KNEEL_SEAT["overlap"][1], "the feet overlap by %.4f (it needs %.4f to %.4f)" % ((overlap,) + KNEEL_SEAT["overlap"])
    assert KNEEL_SEAT["over"][0] <= gap <= KNEEL_SEAT["over"][1], "the right foot is %.4f off the left (it needs %.4f to %.4f)" % ((gap,) + KNEEL_SEAT["over"])
    assert all(down_gap(feet[1], p) is None for p in points[0]), "the left foot lies over the right"
    head, pelvis_at = mats["head"][0].translation, mats["pelvis"][0].translation
    lean = max(abs(head.x - pelvis_at.x), abs(head.y - pelvis_at.y))
    print("SEAT the head is %.4f off the middle of the seat" % lean)
    assert lean <= KNEEL_SEAT["upright"], "the seated back leans: the head is %.4f off the middle of the seat" % lean


JACKET_BEND = {  # the bent jacket at every depth of the bow, in metres and radians
    "legs": 0.02,  # the chest (the jacket from the hip pivot up) stays this far from the thighs at least
    "round": (0.03, 0.06),  # the back from the hinge to the neck, at the deepest bow, bulges this far out from the straight line between them, and nowhere turns the other way: the hump of a bowing back
    "lean": (radians(85), radians(90)),  # the hinge's frame lies this far over at the deepest bow: the lower back, level
    "neck": (radians(125), radians(140)),  # the neck's frame, which the head rides, lies this far over: the upper back has turned on past the hinge, down toward the cushion
    "slope": (radians(10), radians(30)),  # the line from the hinge down to the neck falls this far below the horizontal at the deepest bow
    "forehead": (0.005, 0.03),  # the lowest point of the head at the deepest bow lies this far above the seat top: the forehead reaches the 방석 without sinking in
    "fold": RIG["bendFold"],  # the curvature times the distance in front of the bend's axis: the front of the bend is compressed to 1 - this of its length at most
    "facet": radians(13),  # no facet of a meridian is more than this sharper against its neighbour than it is upright, at the deepest bow
    "trim": 0.001,  # the trim sits no deeper in the jacket, at any depth of the bow, than it does upright, by more than this
}
LEG_SKIRT = (0.005, 0.02)  # the thighs against the jacket, kneeling and bowing: the jacket lies on them, this far off at least, and no further than this


def jacket_triangles(obj):
    obj.data.calc_loop_triangles()
    return [tuple(t.vertices) for t in obj.data.loop_triangles]


def self_crossings(obj, matrix, triangles):
    """How many pairs of the posed part's triangles cross, not counting the pairs that share a corner."""
    tree = BVHTree.FromPolygons([matrix @ v.co for v in obj.data.vertices], triangles, all_triangles=True)
    return sum(1 for a, b in tree.overlap(tree) if a < b and not set(triangles[a]) & set(triangles[b]))


def bend_fold(parts):
    """The curvature times the distance in front of the axis, at its largest over the jacket's vertices in the bend, both spans up to
    the neck: standing, and kneeling with the jacket gathered."""
    low, high = POSE["bow_lean"] / RIG["bendLength"], POSE["bow_lean"] * BEND_UPPER / BEND_NECK
    worst = 0.0
    for gather in (1.0, RIG["kneelSkirtScale"]):
        for v in parts["jacket"].data.vertices:
            h = v.co.z * gather if v.co.z < 0.0 else v.co.z
            if -RIG["bendLength"] < h <= HINGE_Z:
                rate = low
            elif HINGE_Z < h <= NECK_Y + 1e-9:
                rate = high
            else:
                continue
            worst = max(worst, rate * (v.co.y - RIG["bendForward"]))
    return worst


def bend_facets():
    """How far the facets of the jacket's meridians turn against their neighbours at the deepest bow, standing and gathered. Four
    numbers: the most any facet turns beyond the turn it has upright (stretching the back smooths a kink, so only a sharper turn
    counts; this is the one JACKET_BEND limits), the sharpest turn of a facet in the bend (the rings from BEND_RINGS_FROM up to the neck)
    bent and upright, and the sharpest turn of any facet of the jacket bent (the hem's roll and the collar, which the bend does not touch)."""
    rings = jacket_rings()
    worst = bent_in_bend = upright_in_bend = bent_anywhere = 0.0

    def aim(line, i):
        return atan2(line[i + 1].y - line[i].y, line[i + 1].z - line[i].z)

    def turn(line, i):
        return (aim(line, i) - aim(line, i - 1) + pi) % (2 * pi) - pi

    for gather in (1.0, RIG["kneelSkirtScale"]):
        for j in range(SEGMENTS["torso"]):
            upright = [bend_point(ring[j], 0.0, gather) for ring in rings]
            bent = [bend_point(ring[j], POSE["bow_lean"], gather) for ring in rings]
            for i in range(1, len(upright) - 1):
                worst = max(worst, abs(turn(bent, i)) - abs(turn(upright, i)))
                bent_anywhere = max(bent_anywhere, abs(turn(bent, i)))
                if BEND_RINGS_FROM - 1e-9 <= rings[i][j].z <= NECK_Y + 1e-9:
                    bent_in_bend, upright_in_bend = max(bent_in_bend, abs(turn(bent, i))), max(upright_in_bend, abs(turn(upright, i)))
    return worst, bent_in_bend, upright_in_bend, bent_anywhere


def check_jacket_bend(parts):
    """The jacket is one surface bent by one curve, so there is no seam to check, only that the curve is a good one: no two of its
    triangles cross at any depth of the bow (the front folds in, and a fold that went too far would pass through itself), the front
    is not compressed past the fold limit in either span, the facets are small enough to read as a curve up to the neck, the bent
    chest keeps clear of the thighs, the hinge lies level and the neck well past it with the forehead on the 방석, the back between
    them is one convex hump, and the trim lies on the jacket."""
    cushion = RIG["seatTop"]
    triangles = jacket_triangles(parts["jacket"])
    crossings = {}
    for step in range(BOW_SWEEP["depths"] + 1):
        bow = step / BOW_SWEEP["depths"]
        crossings[bow] = self_crossings(parts["jacket"], pose_matrices(1.0, cushion, bow=bow)["jacket"][0], triangles)
    print("BEND triangles of the jacket crossing each other by depth: %s" % " ".join("%.2f:%d" % item for item in crossings.items()))
    assert not any(crossings.values()), "the bent jacket crosses itself at bow %s" % ", ".join("%.2f" % b for b, c in crossings.items() if c)
    fold, (facet, bent_in_bend, upright_in_bend, bent_anywhere) = bend_fold(parts), bend_facets()
    print("BEND the front is folded by %.3f (it may be %.3f), the facets turn %.1f degrees more than upright at the sharpest (they may turn %.1f)" % (fold, JACKET_BEND["fold"], degrees(facet), degrees(JACKET_BEND["facet"])))
    print("BEND absolute facet turn at the deepest bow: %.1f degrees at the sharpest facet in the bend (%.1f upright there) and %.1f anywhere in the jacket (the hem's roll and the collar, unchanged by the bend); the limit of %.1f applies to the excess over upright of each facet (%.1f), not to these" % (degrees(bent_in_bend), degrees(upright_in_bend), degrees(bent_anywhere), degrees(JACKET_BEND["facet"]), degrees(facet)))
    assert fold <= JACKET_BEND["fold"], "the front of the bend is folded by %.3f (it may be %.3f)" % (fold, JACKET_BEND["fold"])
    assert facet <= JACKET_BEND["facet"], "the bend turns a facet %.1f degrees sharper than upright (it may turn it %.1f)" % (degrees(facet), degrees(JACKET_BEND["facet"]))
    chest = [v.co for v in parts["jacket"].data.vertices if v.co.z >= HINGE_Z]
    worst_legs = {}
    for bow in (0.0,) + BOW_DEPTHS:
        mats = pose_matrices(1.0, cushion, bow=bow)
        thighs = [world_bvh(parts["trousers"], m) for m in mats["trousers"]]
        bent = mats["jacket"][0]
        worst_legs[bow] = min(clearance_of(tree, bent @ p) for tree in thighs for p in chest)
        assert worst_legs[bow] >= JACKET_BEND["legs"], "the chest comes within %.4f of the thighs at bow %.3f (it needs %.4f)" % (worst_legs[bow], bow, JACKET_BEND["legs"])
    print("BEND the chest is %.4f from the thighs at the nearest (it needs %.4f)" % (min(worst_legs.values()), JACKET_BEND["legs"]))
    mats = pose_matrices(1.0, cushion, bow=BOW_DEPTHS[-1])
    bent = mats["jacket"][0]
    lean, neck = ((frame.to_3x3() @ UP).angle(UP) for frame in (bent.chest, bent.frame(BEND_NECK)))
    reach = bent.frame(BEND_NECK).translation - bent.chest.translation
    slope = atan2(-reach.z, reach.y)
    print("BEND the hinge lies %.1f degrees over (it needs %.0f to %.0f), the neck %.1f (it needs %.0f to %.0f), the line from the hinge to the neck falls %.1f degrees (it needs %.0f to %.0f)" % (degrees(lean), degrees(JACKET_BEND["lean"][0]), degrees(JACKET_BEND["lean"][1]), degrees(neck), degrees(JACKET_BEND["neck"][0]), degrees(JACKET_BEND["neck"][1]), degrees(slope), degrees(JACKET_BEND["slope"][0]), degrees(JACKET_BEND["slope"][1])))
    assert JACKET_BEND["lean"][0] <= lean <= JACKET_BEND["lean"][1], "the hinge lies %.1f degrees over at the deepest bow" % degrees(lean)
    assert JACKET_BEND["neck"][0] <= neck <= JACKET_BEND["neck"][1], "the neck lies %.1f degrees over at the deepest bow" % degrees(neck)
    assert JACKET_BEND["slope"][0] <= slope <= JACKET_BEND["slope"][1], "the line from the hinge to the neck falls %.1f degrees at the deepest bow" % degrees(slope)
    back = [bent @ min(ring, key=lambda v: v.y) for ring in jacket_rings() if HINGE_Z - 1e-9 <= ring[0].z <= NECK_Y + 1e-9]
    (y0, z0), (y1, z1) = (back[0].y, back[0].z), (back[-1].y, back[-1].z)
    length = math.hypot(y1 - y0, z1 - z0)
    bulge = [((p.z - z0) * (y1 - y0) - (p.y - y0) * (z1 - z0)) / length for p in back]
    turns = [(b.y - a.y) * (c.z - b.z) - (b.z - a.z) * (c.y - b.y) for a, b, c in zip(back, back[1:], back[2:])]
    print("BEND the back bulges %.4f from the line between the hinge and the neck (it needs %.2f to %.2f), %d points, the sharpest turn the wrong way %.1e" % (max(bulge), JACKET_BEND["round"][0], JACKET_BEND["round"][1], len(back), max(0.0, max(turns))))
    assert JACKET_BEND["round"][0] <= max(bulge) <= JACKET_BEND["round"][1], "the back bulges %.4f from the line between the hinge and the neck (it needs %.2f to %.2f)" % ((max(bulge),) + JACKET_BEND["round"])
    assert min(bulge) >= -1e-6 and max(turns) <= 1e-7, "the back between the hinge and the neck is not one convex hump"
    top = min((m @ v.co).z for part in ("head", "face", "hair") for m in mats[part] for v in parts[part].data.vertices) - cushion
    print("BEND the forehead lies %.4f above the seat top (it needs %.3f to %.3f)" % ((top,) + JACKET_BEND["forehead"]))
    assert JACKET_BEND["forehead"][0] <= top <= JACKET_BEND["forehead"][1], "the head lies %.4f above the seat top at the deepest bow (it needs %.3f to %.3f)" % ((top,) + JACKET_BEND["forehead"])
    upright = world_bvh(parts["jacket"], Matrix.Identity(4))
    rest = [clearance_of(upright, v.co) for v in parts["trim"].data.vertices]
    for bow in (0.0,) + BOW_DEPTHS:
        pose = pose_matrices(1.0, cushion, bow=bow)
        jacket = world_bvh(parts["jacket"], pose["jacket"][0])
        deeper = max(r - clearance_of(jacket, pose["trim"][0] @ v.co) for r, v in zip(rest, parts["trim"].data.vertices))
        assert deeper <= JACKET_BEND["trim"], "the trim sinks %.4f deeper into the jacket than upright at bow %.3f (it may sink %.4f)" % (deeper, bow, JACKET_BEND["trim"])
        if bow == BOW_DEPTHS[-1]:
            lowest = min(clearance_of(jacket, pose["trim"][0] @ v.co) for v in parts["trim"].data.vertices)
            print("BEND the trim sits %.4f deeper in the jacket than upright at the worst (it may sit %.4f)" % (deeper, JACKET_BEND["trim"]))
            print("BEND absolute trim height at the deepest bow: the lowest vertex lies %.4f above the bent jacket's surface (upright %.4f; negative is below it, as the collar and the tie are laid into it); the limit of %.4f applies to the per-vertex change from upright (%.4f), not to the height" % (lowest, min(rest), JACKET_BEND["trim"], deeper))


def check_leg_skirt(parts):
    """The jacket lies on the thighs, kneeling and at every depth of the bow: the legs never sink into it, and it never hovers above them."""
    cushion = RIG["seatTop"]
    low, high = LEG_SKIRT
    for bow in (0.0,) + BOW_DEPTHS:
        mats = pose_matrices(1.0, cushion, bow=bow)
        jacket = world_bvh(parts["jacket"], mats["jacket"][0])
        near = min(clearance_of(jacket, m @ v.co) for m in mats["trousers"] for v in parts["trousers"].data.vertices)
        if bow in (0.0, BOW_DEPTHS[-1]):
            print("%s the thighs lie %.4f from the jacket (it needs %.4f to %.4f)" % ("KNEEL" if bow == 0.0 else "BOW", near, low, high))
        assert low <= near <= high, "the thighs are %.4f from the jacket at bow %.3f (it needs %.4f to %.4f)" % (near, bow, low, high)


TROUSERS_HIDDEN = 0.06  # kneeling, the trousers' highest vertex lies at least this far under where the jacket's bend begins: 0.0661 measured, which is also 0.0107 under the gathered hem


def check_trousers_hidden(parts):
    """The trousers stay under the jacket while it bends, kneeling at every depth of the bow. Two measures, because the trousers' own top
    is the visible knee when kneeling and cannot be cut back to hide it: (1) the trousers end TROUSERS_HIDDEN under the height where the
    bend begins (the seat ends exactly there), and the bend moves only the jacket above that, so it never lifts the jacket off them;
    (2) of the seat's and the trousers' vertices, every one that lies above the jacket's hem (the lower edge and HEM_LIP, the roll the
    trousers are free to show under) is inside the bent jacket at every depth, with the most outside it measured as a clearance."""
    cushion = RIG["seatTop"]
    hem = -JACKET_DROP * RIG["kneelSkirtScale"] + HEM_LIP
    start = -RIG["bendLength"]
    top, reaching, outermost = -math.inf, 0, -math.inf
    for step in range(BOW_SWEEP["depths"] + 1):
        mats = pose_matrices(1.0, cushion, bow=step / BOW_SWEEP["depths"])
        to_waist = mats["jacket"][0].node.inverted()
        jacket = world_bvh(parts["jacket"], mats["jacket"][0])
        for name in ("pelvis", "trousers"):
            for matrix in mats[name]:
                for vertex in parts[name].data.vertices:
                    point = matrix @ vertex.co
                    height = (to_waist @ point).z
                    if name == "trousers":
                        top = max(top, height)
                    if height > hem:
                        reaching += 1
                        outermost = max(outermost, clearance_of(jacket, point))
    print("TROUSERS the highest trouser vertex lies %.4f under where the bend begins (it needs %.4f); %d vertex-depths of the seat and the trousers rise above the hem, the one nearest the surface lies %.4f %s it (it must be inside)" % (start - top, TROUSERS_HIDDEN, reaching, abs(outermost), "inside" if outermost <= 0 else "outside"))
    assert start - top >= TROUSERS_HIDDEN, "the trousers reach %.4f under where the bend begins (they must stay %.4f under it)" % (start - top, TROUSERS_HIDDEN)
    assert reaching > 0, "no vertex of the seat reaches above the hem: the check measures nothing"
    assert outermost <= 0, "a vertex of the seat or the trousers lies %.4f outside the bent jacket above its hem" % outermost


BOW_SWEEP = {  # the back over the hip, at every depth of the bow in steps (a copy of this is in packages/client/test/monk-assets.test.ts)
    "depths": 20,  # the bow's depth from 0 to 1 in this many steps
    "planes": (0.0, 0.07),  # slices of the jacket along its length, this far from the middle line (the middle of the back and half-way to its edge)
    # Where the rays start, in the upright jacket (forward, height from the hip pivot), carried by the bend: the middle of the waist, where the
    # chest's old hip joint was. The biggest gap between neighbouring rays over the 21 depths and both planes, from
    #   (0, -0.15), this point:            0.0222 at most (bow 0.80, plane 0.07), under "jump"
    #   (0, -0.20), the bend's base point: 0.0293 to 0.0837 from bow 0.65 to 0.95 (0.0837 at bow 0.95, plane 0.07), 0.0095 and 0.0110 at bow 1.00
    #   (0, -0.20) fixed in the waist's frame, not carried: 0.0499 at bow 0.65, 0.1861 at 0.95, 0.2079 at 1.00 (plane 0)
    # The base point's jumps at bow 0.65 to 0.95 are a graze of the viewpoint, not a step: every hit is on the jacket (no other part is in front),
    # the first hit is 7 to 20 degrees off the surface where it is 39 to 55 at bow 1.00, and the two hits of a worst pair lie on one straight strip
    # of the chest (bow 0.95, plane 0.07: the cut's triangles 647, 686, 687, 726, 0.065 long, every hit within 2 mm of the line between the two,
    # 3.6 degrees from the rays' own direction, and 686 and 687 within 1 degree of it, so the rays slide past them). From this point the worst
    # pair's strip is 13.3 to 18.3 degrees off the rays at bow 0.65 to 0.80, not square to them, and its gap stays under "jump".
    "joint": (0.0, -0.15),
    "rays": (-70, 100),  # one ray a degree from the joint, from this far forward of straight up to this far back
    "jump": 0.03,  # no two neighbouring points of the outline lie further apart than this: no step, no gap
    # ... unless the rays graze one strip of one part edge-on, "graze" degrees or more off square-on at both hits: then the two hits lie on one
    # surface that runs along the rays, and it is the viewpoint that has spread them, not a step. The bent chest does it: its front is the
    # inside of the hump, a surface that runs on from the lower chest to the neck at a slant that sweeps through the rays as it bows (the
    # two hits of each such pair lie on one smooth strip, within 4.2 mm of the straight line between them), up to 0.094 apart at bow 0.70.
    "graze": 55.0,
    "grid": 0.002,  # the outline is walked in steps of this, and a dent is how far a point lies inside the chord to the points this far each way along it
    "reach": (0.05, 0.08),
    "dent": (0.0135, 0.013),  # a dent at most this deep over each reach: the one bent jacket measures 0.0054 and 0.0041 at worst (upright, kneeling); a seated monk's own seat and thighs show 0.0055 and 0.0041, and a back that dents shows at any zoom
    "span": 0.01,  # the shading turns by at most "turn" degrees between two points of the outline this far apart, within "zone" of the hip joint: the light can draw a ledge or a seam the shape has not got, and a band of it is a line at any zoom
    "turn": 19.5,  # a chest of 10 cm radius turns 6 degrees over 10 mm; the one bent jacket's shading turns 7.0 at worst (kneeling upright), and a seam or ledge of two surfaces shaded apart turned 16 to 34 over the bow, so this is the middle of that gap
    "zone": 0.28,
}
SWEEP_PARTS = ("jacket", "pelvis")


def shaded_bvh(obj, matrix):
    """The part's faces in the world as a BVH tree, and a function that gives the shading normal (in the world) at a point of one of
    its triangles: the corners' normals (the ones the exported file carries, bent with the jacket) mixed by where the point lies in it."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    points = [matrix @ v.co for v in mesh.vertices]
    triangles = list(mesh.loop_triangles)
    tree = BVHTree.FromPolygons(points, [tuple(t.vertices) for t in triangles])
    if isinstance(matrix, BentMatrix):
        normals = [matrix.normal(mesh.vertices[loop.vertex_index].co, mesh.corner_normals[i].vector) for i, loop in enumerate(mesh.loops)]
    else:
        normal_matrix = matrix.to_3x3().inverted().transposed()
        normals = [(normal_matrix @ Vector(n.vector)).normalized() for n in mesh.corner_normals]

    def shade(index, point):
        triangle = triangles[index]
        weights = poly_3d_calc([points[i] for i in triangle.vertices], point)
        return sum((normals[loop] * weight for loop, weight in zip(triangle.loops, weights)), Vector()).normalized()

    return tree, shade


def back_outline(trees, joint, plane):
    """The back and the top of the jacket as seen from the side, in the slice of the body this far from the middle line: for one ray a
    degree from the hip joint, from forward over the chest round to the seat, the farthest of the parts' outer faces: where it is, its
    shading normal there, which part it is on and how many degrees off square-on the ray meets it (None where none is hit)."""
    low, high = BOW_SWEEP["rays"]
    origin = joint + Vector((plane, 0.0, 0.0))
    outline = []
    for degree in range(high, low - 1, -1):
        out = Vector((0.0, -sin(radians(degree)), cos(radians(degree))))
        far = None
        for part, (tree, shade) in enumerate(trees):
            hit, normal, index, _ = tree.ray_cast(origin + out, -out)
            if hit is not None and normal.dot(out) > 0 and (far is None or (hit - origin).length > (far[0] - origin).length):
                far = (hit, shade(index, hit), part, degrees(math.acos(min(1.0, normal.dot(out)))))
        outline.append(None if far is None else (far[0].y, far[0].z, far[1], far[2], far[3]))
    return outline


def walk_outline(outline):
    """The outline's points walked in even steps of BOW_SWEEP["grid"] along its length (the shading normal mixed along with them), the
    longest step between two neighbouring points before that (infinity where a ray in between found nothing) and the longest one that
    was let go because the rays graze it (BOW_SWEEP["graze"]): two hits on one part, both that far off square-on."""
    hits = [i for i, point in enumerate(outline) if point is not None]
    between = outline[hits[0] : hits[-1] + 1]
    run = [point for point in between if point is not None]
    jump = math.inf if len(run) < len(between) else 0.0
    excused = 0.0
    for a, b in zip(run, run[1:]):
        gap = math.hypot(b[0] - a[0], b[1] - a[1])
        if gap > BOW_SWEEP["jump"] and a[3] == b[3] and min(a[4], b[4]) >= BOW_SWEEP["graze"]:
            excused = max(excused, gap)
        else:
            jump = max(jump, gap)
    walked = [run[0][:3]]
    for point in run[1:]:
        while math.hypot(point[0] - walked[-1][0], point[1] - walked[-1][1]) >= BOW_SWEEP["grid"]:
            ay, az, an = walked[-1]
            share = BOW_SWEEP["grid"] / math.hypot(point[0] - ay, point[1] - az)
            walked.append((ay + (point[0] - ay) * share, az + (point[1] - az) * share, an + (point[2] - an) * share))
    return walked, jump, excused


def outline_dent(walked, joint, reach):
    """How far the outline lies inside the chord between the points this far each way along it, at its worst, from the side of the
    hip joint (a bulge outward is no dent): a concave waist, a step or a crease shows here whatever its angle."""
    k = round(reach / BOW_SWEEP["grid"])
    worst = 0.0
    for i in range(k, len(walked) - k):
        a, b, p = walked[i - k], walked[i + k], walked[i]
        dy, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dy, dz)
        ny, nz = dz / length, -dy / length
        if ny * ((a[0] + b[0]) / 2 - joint.y) + nz * ((a[1] + b[1]) / 2 - joint.z) < 0:
            ny, nz = -ny, -nz
        worst = max(worst, -((p[0] - a[0]) * ny + (p[1] - a[1]) * nz))
    return worst


def outline_turn(walked, joint):
    """How far the shading normal turns, in degrees, between two points of the outline BOW_SWEEP["span"] apart, at its worst within
    BOW_SWEEP["zone"] of the hip joint."""
    k = round(BOW_SWEEP["span"] / BOW_SWEEP["grid"])
    worst = 0.0
    for i in range(len(walked) - k):
        a, b = walked[i], walked[i + k]
        if max(math.hypot(a[0] - joint.y, a[1] - joint.z), math.hypot(b[0] - joint.y, b[1] - joint.z)) <= BOW_SWEEP["zone"]:
            worst = max(worst, math.degrees(a[2].angle(b[2], 0.0)))
    return worst


def sweep_bow(parts):
    """The worst jump, dents and shading turn of the jacket's outline in each slice at each depth, and the longest jump let go as a graze:
    {depth: (jump, dent over each reach, turn, grazed)}.
    The rays start at BOW_SWEEP["joint"], a point of the waist that the bend carries with it."""
    cushion = RIG["seatTop"]
    worst = {}
    for step in range(BOW_SWEEP["depths"] + 1):
        bow = step / BOW_SWEEP["depths"]
        mats = pose_matrices(1.0, cushion, bow=bow)
        joint = mats["jacket"][0] @ Vector((0.0, *BOW_SWEEP["joint"]))
        trees = [shaded_bvh(parts[name], mats[name][0]) for name in SWEEP_PARTS]
        jump, dents, turn, grazed = 0.0, [0.0 for _ in BOW_SWEEP["reach"]], 0.0, 0.0
        for plane in BOW_SWEEP["planes"]:
            walked, gap, excused = walk_outline(back_outline(trees, joint, plane))
            jump = max(jump, gap)
            grazed = max(grazed, excused)
            dents = [max(dent, outline_dent(walked, joint, reach)) for dent, reach in zip(dents, BOW_SWEEP["reach"])]
            turn = max(turn, outline_turn(walked, joint))
        worst[bow] = (jump,) + tuple(dents) + (turn, grazed)
    return worst


def check_bow_sweep(parts):
    """The waist is one body at every depth of the bow, not only at the full depth: the jacket's outline over the hip, from the chest
    round the back to the seat, has no step and no gap between the chest, the tunic and the seat of the trousers (neighbouring
    points never further apart than a few centimetres), no dent or crease, and no ledge or seam in its shading either, at every
    step of the way down."""
    worst = sweep_bow(parts)
    print("SWEEP the outline's biggest dent over %s by depth: %s" % ("/".join("%.2f" % r for r in BOW_SWEEP["reach"]), " ".join("%.3f:%.4f/%.4f" % (b, d[1], d[2]) for b, d in worst.items())))
    print("SWEEP the outline's biggest jump by depth: %s" % " ".join("%.3f:%.4f" % (b, d[0]) for b, d in worst.items()))
    print("SWEEP the outline's longest grazed gap (let go, rays %.0f degrees or more off square-on on one part) by depth: %s" % (BOW_SWEEP["graze"], " ".join("%.3f:%.4f" % (b, d[-1]) for b, d in worst.items())))
    print("SWEEP the shading's biggest turn over %.0f mm, in degrees, by depth: %s" % (BOW_SWEEP["span"] * 1000, " ".join("%.3f:%.1f" % (b, d[-2]) for b, d in worst.items())))
    for bow, (jump, *dents, turn, _) in worst.items():
        assert jump <= BOW_SWEEP["jump"], "the jacket's outline has a step or a gap of %.4f at bow %.3f (it may have %.4f)" % (jump, bow, BOW_SWEEP["jump"])
        for dent, reach, most in zip(dents, BOW_SWEEP["reach"], BOW_SWEEP["dent"]):
            assert dent <= most, "the waist is dented %.4f deep over %.2f at bow %.3f (it may be %.4f)" % (dent, reach, bow, most)
        assert turn <= BOW_SWEEP["turn"], "the jacket's shading turns %.1f degrees over %.0f mm at bow %.3f, a ledge or a seam (it may turn %.1f)" % (turn, BOW_SWEEP["span"] * 1000, bow, BOW_SWEEP["turn"])


WALK_POSES =(None,) + tuple(k * pi / 8 for k in range(16))  # standing, then the walk cycle in sixteenths (a leg's swing, a lifted foot and the bob all peak within it)
HEM_LIP = 0.004  # the jacket's hem rolls under, so the trousers below this much above its lower edge are free to show
WALK_CLEARANCE = {  # what each arm part must stay clear of at every point of the walk, in metres (about half of what the walk leaves today)
    "head": {"hand": 0.1, "sleeveLower": 0.05, "sleeveUpper": 0.004},
    "jacket": {"hand": 0.03, "sleeveLower": 0.003, "sleeveUpper": -0.0125},  # the root of the sleeve sits 12 mm in the shoulder standing, and the swing sinks it no deeper
    "pelvis": {"hand": 0.05, "sleeveLower": 0.02, "sleeveUpper": 0.02},  # the seat of the trousers
    "trousers": {"hand": 0.05, "sleeveLower": 0.04, "sleeveUpper": 0.05},  # both trouser legs
}



def walk_clearances(parts, poses=WALK_POSES):
    """The least clearance of each arm part from each target, over standing and every sixteenth of the walk cycle."""
    worst = {}
    for phase in poses:
        mats = pose_matrices(0.0, 0.0, phase)
        for target, margins in WALK_CLEARANCE.items():
            trees = [world_bvh(parts[target], m) for m in mats[target]]
            for part in margins:
                near = min(clearance_of(tree, m @ v.co) for tree in trees for m in mats[part] for v in parts[part].data.vertices)
                worst[target, part] = min(worst.get((target, part), 1.0), near)
    return worst


def check_walk(parts):
    """Every point of the walk cycle: the thighs and the seat of the trousers stay inside the jacket (below its hem they show), the
    arms and hands stay clear of the head, the jacket, the seat and both trouser legs, nothing passes through its other half (the two
    trouser legs, a foot and the other leg, the two hands), and no foot dips below the ground."""
    worst = walk_clearances(parts)
    for (target, part), near in sorted(worst.items()):
        print("WALK %-12s clearance from the %s %.4f" % (part, target, near))
        assert near >= WALK_CLEARANCE[target][part], "walking, the %s comes within %.4f of the %s (it needs %.4f)" % (part, near, target, WALK_CLEARANCE[target][part])
    poke, ground, cuff_above = 0.0, 1.0, 1.0
    for phase in WALK_POSES:
        mats = pose_matrices(0.0, 0.0, phase)
        jacket = world_bvh(parts["jacket"], mats["jacket"][0])
        to_jacket = mats["jacket"][0].node.inverted()
        for part in ("pelvis", "trousers", "leg"):
            for m in mats[part]:
                for v in parts[part].data.vertices:
                    p = m @ v.co
                    if (to_jacket @ p).z > -JACKET_DROP + HEM_LIP:
                        poke = max(poke, clearance_of(jacket, p))
        legs = [world_bvh(parts["trousers"], m) for m in mats["trousers"]]
        feet = [world_bvh(parts["foot"], m) for m in mats["foot"]]
        hands = [world_bvh(parts["hand"], m) for m in mats["hand"]]
        label = "standing" if phase is None else "phase %.2f" % phase
        assert not legs[0].overlap(legs[1]), "walking (%s), the two trouser legs go through each other" % label
        assert not (feet[0].overlap(legs[1]) or feet[1].overlap(legs[0])), "walking (%s), a foot goes through the other leg" % label
        assert not any(foot.overlap(jacket) for foot in feet), "walking (%s), a foot goes through the jacket" % label
        for side in (0, 1):
            cuff = min((mats["trousers"][side] @ v.co).z for v in parts["trousers"].data.vertices)
            ankle = mats["foot"][side].translation.z
            cuff_above = min(cuff_above, cuff - ankle)
        assert not hands[0].overlap(hands[1]), "walking (%s), the two hands go through each other" % label
        ground = min(ground, min((m @ v.co).z for m in mats["foot"] for v in parts["foot"].data.vertices))
    print("WALK thighs reach %.4f outside the jacket above its hem, the lowest foot is %.4f above the ground, the lowest cuff %.4f above the ankle" % (poke, ground, cuff_above))
    assert cuff_above >= 0.0, "walking, the rim of a trouser cuff dips %.4f below the ankle" % -cuff_above
    assert poke <= 0.0, "walking, a thigh pokes %.4f through the jacket" % poke
    assert ground >= -0.0005, "walking, a foot sinks %.4f into the ground" % -ground


FISH_JERKS = (-1.0, 0.0, 1.0)  # the rod held steady, and pulled hardest down and up (a fish on the line plus the sway of the rod)
FISH_CLEARANCE = {  # what each arm part must stay clear of holding the rod, in metres (negative: it may sink that deep; about half of what the pose leaves today)
    "head": {"hand": 0.05, "sleeveLower": 0.025, "sleeveUpper": 0.001},
    "jacket": {"hand": 0.04, "sleeveLower": 0.002, "sleeveUpper": -0.03},  # the root of the sleeve sits inside the shoulder, and turning the arm up and forward sinks it a little deeper than standing does
    "pelvis": {"hand": 0.05, "sleeveLower": 0.015, "sleeveUpper": 0.015},  # the seat of the trousers
    "trousers": {"hand": 0.08, "sleeveLower": 0.06, "sleeveUpper": 0.07},  # both trouser legs
}
FISH_ARM_PARTS = ("sleeveUpper", "sleeveLower", "hand")
FISH_ARMS_GAP = 0.003  # what the two arms (the lead one and the rear one) must keep between them


def separation(mesh, tree, obj, matrix):
    """Signed gap between a posed part (its BVH `mesh`) and the surface in `tree`: how near any vertex of the part comes to it while
    their triangles do not cross, or minus the deepest a vertex lies below it when they do (a crossing with no vertex below counts as 0.1 mm)."""
    near, sunk = 1.0, 0.0
    for v in obj.data.vertices:
        p = matrix @ v.co
        hit, normal, _, dist = tree.find_nearest(p)
        near = min(near, dist)
        if (p - hit).dot(normal) < 0:
            sunk = max(sunk, dist)
    return -max(sunk, 0.0001) if mesh.overlap(tree) else near


def fish_clearances(parts, jerks=FISH_JERKS):
    """The least separation of each arm part from each target and from the other arm, over the jerks, holding the rod."""
    worst = {}

    def note(key, value):
        worst[key] = min(worst.get(key, 1.0), value)

    for jerk in jerks:
        mats = pose_matrices(0.0, 0.0, fish=1.0, jerk=jerk)
        for target, margins in FISH_CLEARANCE.items():
            trees = [world_bvh(parts[target], m) for m in mats[target]]
            for part in margins:
                for m in mats[part]:
                    mesh = world_bvh(parts[part], m)
                    note((target, part), min(separation(mesh, tree, parts[part], m) for tree in trees))
        for part_a in FISH_ARM_PARTS:
            lead = world_bvh(parts[part_a], mats[part_a][0])
            for part_b in FISH_ARM_PARTS:
                rear = world_bvh(parts[part_b], mats[part_b][1])
                note(("arms", part_a + "/" + part_b), separation(lead, rear, parts[part_a], mats[part_a][0]))
    return worst


def check_fish(parts):
    """Holding the rod, steady and at the hardest pull of a fish, up and down: the arms and hands stay clear of the head, the jacket,
    the seat and both trouser legs, and the lead arm (which grips the rod) stays clear of the rear arm (which steadies the butt)."""
    worst = fish_clearances(parts)
    for (target, part), near in sorted(worst.items()):
        print("FISH %-24s clearance from the %s %.4f" % (part, target, near))
        margin = FISH_ARMS_GAP if target == "arms" else FISH_CLEARANCE[target][part]
        assert near >= margin, "holding the rod, the %s comes within %.4f of the %s (it needs %.4f)" % (part, near, target, margin)


def check_sleeves_clear_head(parts):
    """The whole sleeves and the hands stay out of the head standing and kneeling in prayer (walking is in check_walk, the bow in
    check_bow). The shoulder is right under the jaw in this chibi, so this holds the root of the sleeve to it too."""
    cushion = RIG["seatTop"]
    for label, kneel in (("standing", 0.0), ("praying", 1.0)):
        mats = pose_matrices(kneel, cushion if kneel else 0.0)
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
        "footKneelX": RIG["footKneelX"],
        "footKneelZ": RIG["footKneelZ"],
        "footKneelY": RIG["footKneelY"],
        "footKneelTilt": round(RIG["footKneelTilt"], 5),
        "footKneelYaw": RIG["footKneelYaw"],
        "footOverTilt": RIG["footOverTilt"],
        "footOverLift": RIG["footOverLift"],
        "footOverShift": RIG["footOverShift"],
        "legKneelLift": RIG["legKneelLift"],
        "legTopDrop": RIG["legTopDrop"],
        "legKneelTopDrop": RIG["legKneelTopDrop"],
        "legKneelTopForward": RIG["legKneelTopForward"],
        "legKneelTopX": RIG["legKneelTopX"],
        "legKneelFlat": RIG["legKneelFlat"],
        "legLength": RIG["legLength"],
        "kneelPelvisGrow": RIG["kneelPelvisGrow"],
        "kneelPelvisScaleY": RIG["kneelPelvisScaleY"],
        "kneelPelvisLift": RIG["kneelPelvisLift"],
        "bendLength": RIG["bendLength"],
        "bendUpper": RIG["bendUpper"],
        "bendForward": RIG["bendForward"],
        "bowLean": POSE["bow_lean"],
        "bowHead": POSE["bow_head"],
        "kneelSkirtScale": RIG["kneelSkirtScale"],
        "seatTop": RIG["seatTop"],
        "robeTintSaturation": RIG["robeTintSaturation"],
        "robeTintLightness": RIG["robeTintLightness"],
    }


PROBE_PARTS = ("head", "pelvis", "jacket", "sleeveUpper", "sleeveLower", "hand", "foot", "trousers")
PROBE_RIGHT = ("sleeveUpper", "sleeveLower", "hand", "foot", "trousers")  # the second copy of these too, the right side (sign +1) of the arms and legs
PROBE_BOWS = (0.0, 0.25, 0.5, 0.75, 1.0)
PROBE_WALK_PARTS = ("head", "jacket", "sleeveUpper", "sleeveLower", "hand", "foot", "trousers")
PROBE_PHASES = tuple(k * pi / 4 for k in range(8))  # a copy walks the other half of the cycle half a turn on, so these cover both
PROBE_FISH_PARTS = ("head", "jacket", "sleeveUpper", "sleeveLower", "hand")


def probe_bounds(parts, part, matrix):
    """The world bounds of a part under a matrix, in three.js axes: min x, y, z then max x, y, z."""
    points = [matrix @ v.co for v in parts[part].data.vertices]
    low = (min(p.x for p in points), min(p.z for p in points), -max(p.y for p in points))
    high = (max(p.x for p in points), max(p.z for p in points), -min(p.y for p in points))
    return [round(c, 4) for c in low + high]


def pose_probe(parts):
    """The world bounds of the first copy of a few parts, kneeling at each bow depth and walking at each probed phase, and of every copy
    of the arm parts holding the rod, steady.
    The checks above run on pose_matrices, a copy of animate() in monk-model.ts; a test replays both there and holds it to these."""
    bow = {"bows": list(PROBE_BOWS)}
    for part in PROBE_PARTS:
        bow[part] = [probe_bounds(parts, part, pose_matrices(1.0, RIG["seatTop"], bow=b)[part][0]) for b in PROBE_BOWS]
    for part in PROBE_RIGHT:
        bow[part + "Right"] = [probe_bounds(parts, part, pose_matrices(1.0, RIG["seatTop"], bow=b)[part][1]) for b in PROBE_BOWS]
    walk = {"phases": [round(p, 5) for p in PROBE_PHASES]}
    for part in PROBE_WALK_PARTS:
        walk[part] = [probe_bounds(parts, part, pose_matrices(0.0, 0.0, p)[part][0]) for p in PROBE_PHASES]
    fish = {part: [probe_bounds(parts, part, m) for m in pose_matrices(0.0, 0.0, fish=1.0)[part]] for part in PROBE_FISH_PARTS}
    return {"bow": bow, "walk": walk, "fish": fish}


BEND_SAMPLE_HEIGHTS = (-0.28, -0.23, -0.15, -0.12, -0.10, -0.07, -0.05, -0.025, 0.0, 0.03, 0.10, 0.17, NECK_Y)  # the rings the sample points are taken from
BEND_SAMPLE_DEPTHS = (0.0, 0.25, 0.5, 0.75, 1.0)
BEND_SAMPLE_GATHERS = (1.0, RIG["kneelSkirtScale"], 0.72)  # standing, kneeling, and sitting on a bench (0.72: the client's, which the jacket has no part of)


def bend_samples(parts):
    """A dozen vertices of the upright jacket with their shading normals and where bend_vertex puts them at each depth of the bow,
    gathered and not: the numbers the TypeScript copy of the bend is held to. Axes are three.js's: x right, y up, z backward
    (a Blender point (x, f, h) is [x, h, -f]); positions are in the waist frame, before the waist's own matrix."""
    mesh = parts["jacket"].data
    first = {}
    for k, loop in enumerate(mesh.loops):
        first.setdefault(loop.vertex_index, k)
    levels = sorted({round(v.co.z, 6) for v in mesh.vertices})
    pick = []
    for i, height in enumerate(BEND_SAMPLE_HEIGHTS):
        level = min(levels, key=lambda z: abs(z - height))
        ring = [v for v in mesh.vertices if abs(v.co.z - level) < 1e-5]
        pick.append((max(ring, key=lambda v: v.co.y), min(ring, key=lambda v: v.co.y), max(ring, key=lambda v: v.co.x))[i % 3])  # the front, the back, the flank

    def three(v):
        return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]

    rest = [{"position": three(v.co), "normal": three(Vector(mesh.corner_normals[first[v.index]].vector))} for v in pick]
    posed = {}
    for gather in BEND_SAMPLE_GATHERS:
        for depth in BEND_SAMPLE_DEPTHS:
            out = []
            for v in pick:
                position, normal = bend_vertex(v.co, Vector(mesh.corner_normals[first[v.index]].vector), POSE["bow_lean"] * depth, gather)
                out.append({"position": three(position), "normal": three(normal)})
            posed["gather %.2f depth %.2f" % (gather, depth)] = out
    return {
        "_source": "packages/client/assets/monk/build_monk.py",
        "bendLength": RIG["bendLength"],
        "bendUpper": RIG["bendUpper"],
        "bendForward": RIG["bendForward"],
        "neckY": round(NECK_Y, 5),
        "bowLean": POSE["bow_lean"],
        "gathers": list(BEND_SAMPLE_GATHERS),
        "depths": list(BEND_SAMPLE_DEPTHS),
        "rest": rest,
        "posed": posed,
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
    slim_glb_json(path)


def shortest_float32(value):
    """The shortest decimal that reads back as the same 32-bit float as value."""
    for digits in range(1, 10):
        text = "%.*g" % (digits, value)
        if struct.unpack("<f", struct.pack("<f", float(text)))[0] == struct.unpack("<f", struct.pack("<f", value))[0]:
            return float(text)
    return value


def slim_glb_json(path):
    """Rewrites the glb's JSON chunk with every number as the shortest decimal of the same 32-bit float. The exporter prints
    them as 17-digit doubles (0.8999999761581421 for the float 0.9), which spends about 1.2 KB of the byte budget on digits
    no 32-bit float can tell apart; the binary chunk and every value the game reads are unchanged."""
    with open(path, "rb") as handle:
        data = handle.read()
    json_length, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A, "the first glb chunk is not JSON"
    document = json.loads(data[20 : 20 + json_length])

    def slim(node):
        if isinstance(node, float):
            return shortest_float32(node)
        if isinstance(node, list):
            return [slim(item) for item in node]
        if isinstance(node, dict):
            return {key: slim(item) for key, item in node.items()}
        return node

    text = json.dumps(slim(document), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    text += b" " * (-len(text) % 4)
    rest = data[20 + json_length :]
    total = 12 + 8 + len(text) + len(rest)
    with open(path, "wb") as handle:
        handle.write(data[:8] + struct.pack("<I", total) + struct.pack("<II", len(text), json_type) + text + rest)


# ---- poses (a copy of the three.js rig in monk-model.ts, only for previews) -----------------------------------------

C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three.js -> Blender


def tmat(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    three_euler = Euler(rot, "ZYX").to_matrix().to_4x4()  # three.js "XYZ" multiplies Rx @ Ry @ Rz, which is Blender's "ZYX"
    return Matrix.Translation(Vector(pos)) @ three_euler @ Matrix.Diagonal(Vector((*scale, 1.0)))


def pose_matrices(kneel, cushion, phase=None, bow=0.0, fish=0.0, jerk=0.0):
    """World matrices (Blender axes) for every part copy in the idle (kneel=0) or praying (kneel=1) rest pose.
    phase (radians, standing only) puts the monk at that point of the walk cycle: the swings, the foot lifts, the bob and the lean
    of animate() at sin(phase); bow (0 .. 1, kneeling only) bends the one jacket forward about the waist (bend_vertex: curving over
    the bendLength under the hip pivot, stiff above it) with the head and arms riding its upper end and the arms reaching out, like
    the bow animation: the seat stays on the heels and the jacket on the thighs while the waist swings forward; fish (0 .. 1,
    standing) holds the rod, and jerk (-1 .. 1) is how far the rod is swayed and tugged by a fish at that moment, up (+) or down (-).
    The jacket and its trim carry a BentMatrix, which the build bakes into their vertices, and the exported pose, which is the end
    frame of the bend, for the head, the face, the hair and the arms."""
    lift = cushion * kneel
    walking = phase is not None
    swing = sin(phase) if walking else 0.0
    theta = POSE["bow_lean"] * bow
    rest_y = lift + lerp(RIG["hipStand"], RIG["hipKneel"], kneel) + abs(swing) * POSE["walk_bob"]
    hips = tmat((0, rest_y, 0))
    grow = 1 + RIG["kneelPelvisGrow"] * kneel
    pelvis_y = lerp(1, RIG["kneelPelvisScaleY"], kneel)
    pelvis = hips @ tmat((0, RIG["kneelPelvisLift"] * kneel, 0), scale=(grow, pelvis_y, grow))
    fish_lean = POSE["fish_lean"] + jerk * POSE["fish_tug"] * POSE["fish_tug_lean"]
    lean = -POSE["walk_lean"] * walking + fish_lean * fish
    waist = hips @ tmat((0, 0, 0), (lean, 0, 0))
    jacket = BentMatrix(theta, lerp(1, RIG["kneelSkirtScale"], kneel), waist)  # the jacket is gathered when kneeling, then bent about the waist

    def frame_at(h):  # the frame the bend gives the upright height h, in the waist's
        return waist @ (C4.inverted() @ bend_frame_at(h, theta) @ C4)

    head = frame_at(NECK_Y) @ tmat((0, 0, 0), (POSE["walk_head_tilt"] * walking - POSE["bow_head"] * bow, 0, swing * POSE["walk_head_roll"]))  # the head rides the neck's frame
    out = {"head": [head], "face": [head], "hair": [head], "pelvis": [pelvis], "jacket": [jacket], "trim": [jacket]}
    for key in ("sleeveUpper", "sleeveLower", "hand", "foot", "leg", "trousers"):
        out[key] = []
    for side in (0, 1):
        sign = -1 if side == 0 else 1
        reach = 1 - (1 - bow) ** 2  # the arms get out of the prayer ahead of the chest, so the cuffs leave the chest as it starts to fold
        pray = kneel * (1 - reach)
        stride = swing if side == 0 else -swing  # the leg and the arm of a side swing together, opposite each other
        arm_swing = POSE["walk_swing"] * stride
        arm_x = lerp(POSE["idle_x"], POSE["pray_x"], kneel)
        arm_x = arm_x + (POSE["bow_x"] - arm_x) * reach + arm_swing
        arm_y = sign * (POSE["pray_y"] * pray + POSE["bow_y"] * reach * kneel)
        arm_z = -sign * (POSE["idle_z"] + (POSE["pray_z"] - POSE["idle_z"]) * pray + (POSE["bow_z"] - POSE["idle_z"]) * reach * kneel)
        hold = "fish_lead" if side == 0 else "fish_rear"  # the lead hand grips the rod, the rear hand steadies the butt
        lead_jerk = jerk * (POSE["fish_tug"] + POSE["fish_sway"]) if side == 0 else 0.0
        arm_x += (POSE[hold + "_x"] + lead_jerk - arm_x) * fish
        arm_z += (-sign * POSE["fish_roll"] - arm_z) * fish
        folded = reach * kneel  # the bowing arm's shoulders slide down the folded chest
        slid = SHOULDER_Y + POSE["bow_dy"] * folded
        shoulder = frame_at(slid) @ tmat((sign * (RIG["shoulderX"] + POSE["bow_dx"] * folded), 0, -POSE["bow_drop"] * folded), (arm_x, arm_y, arm_z))
        elbow_x = lerp(POSE["idle_elbow"], POSE["pray_elbow"], kneel)
        elbow_x = elbow_x + (POSE["bow_elbow"] - elbow_x) * reach + max(0.0, -arm_swing) * POSE["walk_elbow"]
        elbow_x += (POSE[hold + "_elbow"] - elbow_x) * fish
        elbow = shoulder @ tmat((0, -RIG["upperArm"], 0), (elbow_x, -sign * (POSE["pray_twist"] * pray + POSE["bow_twist"] * reach * kneel), 0))
        hand = elbow @ tmat((0, -RIG["foreArm"], 0))
        foot_up = max(0.0, cos(phase + (0 if side == 0 else pi))) * POSE["walk_lift"] if walking else 0.0
        over = kneel if side == 1 else 0.0  # the right foot's toes lie over the left's
        foot_y = lift + lerp(RIG["footY"], RIG["footKneelY"], kneel) + RIG["footOverLift"] * over + foot_up
        foot_z = lerp(-RIG["footForward"], RIG["footKneelZ"], kneel) + RIG["footOverShift"] * over + stride * POSE["walk_stride"]
        foot_x = sign * lerp(RIG["footX"], RIG["footKneelX"], kneel)
        foot = tmat((foot_x, foot_y, foot_z), (RIG["footKneelTilt"] * kneel - RIG["footOverTilt"] * over, sign * RIG["footKneelYaw"] * kneel, 0))
        top_y = rest_y - lerp(RIG["legTopDrop"], RIG["legKneelTopDrop"], kneel)
        top_z = lerp(-stride * POSE["walk_hip_shift"], -RIG["legKneelTopForward"], kneel)
        top_x = sign * lerp(RIG["footX"], RIG["legKneelTopX"], kneel)
        reach_x, reach_y, reach_z = foot_x - top_x, foot_y + RIG["legKneelLift"] * kneel - top_y, foot_z - top_z
        reach = sqrt(reach_x**2 + reach_y**2 + reach_z**2)
        leg = tmat(  # turned about the sideways axis to the ankle's height and depth, then leaned to its side
            (top_x, top_y, top_z),
            (atan2(-reach_z, -reach_y), 0, asin(reach_x / reach)),
            (1, reach / RIG["legLength"], lerp(1, RIG["legKneelFlat"], kneel)),
        )
        out["leg"].append(leg)
        out["trousers"].append(leg)
        out["sleeveUpper"].append(shoulder)
        out["sleeveLower"].append(elbow)
        out["hand"].append(hand)
        out["foot"].append(foot)
    return {k: [m.converted(C4) if isinstance(m, BentMatrix) else C4 @ m @ C4.inverted() for m in v] for k, v in out.items()}


def robe_tint(hue):
    """The colour monk-model.ts multiplies into the robe's vertex colours for a monk of this hue. three.js' setHSL reads the HSL as
    linear channel values (the working colour space), so no sRGB conversion here."""
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360.0, RIG["robeTintLightness"], RIG["robeTintSaturation"])
    return (r, g, b, 1.0)


def bent_data(data, bent):
    """A copy of the jacket's mesh bent the way `bent` (a BentMatrix) bends it, with the bent shading normals; the node carries it on."""
    data = data.copy()
    normals = [bend_vertex(data.vertices[loop.vertex_index].co, Vector(data.corner_normals[k].vector), bent.theta, bent.gather)[1] for k, loop in enumerate(data.loops)]
    for v in data.vertices:
        v.co = bend_point(v.co, bent.theta, bent.gather)
    data.normals_split_custom_set(normals)
    return data


def build_pose(name, parts, kneel, tint_hue=None, cushion=RIG["seatTop"], phase=None, bow=0.0, fish=0.0):
    coll = new_collection(name)
    mats = pose_matrices(kneel, cushion, phase, bow, fish)
    robe = {"jacket", "pelvis", "trousers", "sleeveUpper", "sleeveLower"}
    for part, matrices in mats.items():
        src = parts[part]
        data = src.data
        bent = matrices[0] if isinstance(matrices[0], BentMatrix) else None
        if bent is not None:
            data = bent_data(data, bent)
            matrices = [bent.node]
        elif tint_hue is not None and part in robe:
            data = src.data.copy()
        if tint_hue is not None and part in robe:
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


def render_view(cam, name, azimuth_deg, target, scale, rise=0.12):
    az = radians(azimuth_deg)
    direction = Vector((sin(az), cos(az), rise)).normalized()  # azimuth 0 = from the front (+Y)
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
    walking = build_pose("preview_walking", parts, 0.0, PREVIEW_HUE, phase=-1.0)
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
    for name, az in (("monk_kneel_front", 0), ("monk_kneel_three_quarter", 38), ("monk_kneel_side", 90), ("monk_kneel_back", 180)):
        render_view(cam, name, az, kmid, 1.7)
    for name, az, rise in (("monk_kneel_feet_top", 0, 40.0), ("monk_kneel_feet_back", 180, 0.5)):  # the seat on the heels and the insteps under it
        render_view(cam, name, az, (0, 0, 0.16), 0.8, rise)
    kneeling.hide_render = True
    bowing.hide_render = False
    for name, az in (("monk_bow_front", 0), ("monk_bow_three_quarter", 38), ("monk_bow_side", 90), ("monk_bow_back", 160)):
        render_view(cam, name, az, (0, 0.3, 0.4), 1.7)
    render_view(cam, "monk_bow_top", 0, (0, 0.3, 0.2), 1.3, 40.0)
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
    shade_hem_normals(parts["jacket"])
    total = report_parts(parts)
    check_bend()
    check_proportions(parts)
    check_face_on_head(parts)
    check_kneel_clearance(parts)
    check_kneel_hands(parts)
    check_kneel_seat(parts)
    check_bow(parts)
    check_jacket_bend(parts)
    check_leg_skirt(parts)
    check_trousers_hidden(parts)
    check_bow_sweep(parts)
    check_walk(parts)
    check_fish(parts)
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
        json.dump({"_source": "packages/client/assets/monk/build_monk.py", **pose_probe(parts)}, fh, separators=(",", ":"))
        fh.write("\n")
    print("WROTE", poses_path)

    samples_path = os.path.join(HERE, "monk-bend-samples.json")
    with open(samples_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(bend_samples(parts), fh, indent=1)
        fh.write("\n")
    print("WROTE", samples_path)

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
