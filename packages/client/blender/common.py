"""Shared helpers for the Blender asset build.

Authoring axes: Z is up and +Y is forward (the way a monk faces). The glTF exporter turns that
into three's convention (Y up, forward -Z). Everything the models must agree with the game on
- dimensions, colours, names - arrives through --inputs; nothing here is a magic number about the
game. Run through build.py, never directly.
"""

import argparse
import contextlib
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def load_inputs(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgb(hex_color, scale=1.0):
    """'#rrggbb' as the linear colour three.js would make of it, optionally darkened or lightened."""
    value = int(hex_color[1:], 16)
    channels = ((value >> 16) & 255, (value >> 8) & 255, value & 255)
    return tuple(min(1.0, srgb_to_linear(c / 255.0) * scale) for c in channels)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def scaled(color, factor):
    return tuple(min(1.0, c * factor) for c in color)


def smoothstep(low, high, value):
    t = max(0.0, min(1.0, (value - low) / (high - low)))
    return t * t * (3.0 - 2.0 * t)


# The game is Y up with +Z toward the viewer; the authoring scenes are Z up. A Part created with
# frame=GAME takes game coordinates, and lathes (which revolve around local Z) go inside
# `part.placed(SPIN_Y)` to revolve around the game's Y instead.
GAME = Matrix(((1.0, 0.0, 0.0, 0.0), (0.0, 0.0, -1.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
SPIN_Y = Matrix.Rotation(-math.pi / 2, 4, "X")


# face name -> (normal axis, sign, across axis, along axis); across x along is the outward normal
BOX_FACES = {
    "+x": (0, 1, 1, 2),
    "-x": (0, -1, 2, 1),
    "+y": (1, 1, 2, 0),
    "-y": (1, -1, 0, 2),
    "+z": (2, 1, 0, 1),
    "-z": (2, -1, 1, 0),
}


def cells(size, step):
    """How many cells of about `step` fit along each side of a box, at least one."""
    return tuple(max(1, round(side / step)) for side in size)


def hidden(*shown):
    """The faces of a box to skip when only `shown` can be seen."""
    return tuple(name for name in BOX_FACES if name not in shown)


def hash01(x, y, z, seed=0.0):
    """A repeatable pseudo-random number in [0, 1) for a position, with no random state to carry around."""
    value = math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1414) * 43758.5453
    return value - math.floor(value)


def at(x, y, z):
    return Matrix.Translation((x, y, z))


def turned(angle):
    """A turn about the game's up axis, the way three.js rotation.y turns."""
    return Matrix.Rotation(angle, 4, "Y")


def spun(x, y, z):
    """Where to put a lathe whose axis stands up in game space, with its base at (x, y, z)."""
    return Matrix.Translation((x, y, z)) @ SPIN_Y


def smooth_profile(points, steps):
    """A (radius, height) profile resampled through a Catmull-Rom spline, `steps` points per span."""
    padded = [points[0], *points, points[-1]]
    result = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = (Vector(p) for p in padded[i - 1 : i + 3])
        for s in range(steps):
            t = s / steps
            point = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t**3)
            result.append((max(point.x, 0.0), point.y))
    result.append(tuple(points[-1]))
    return result


def interpolate(profile, height):
    """Radius of a (radius, height) profile, sorted by height, at the given height."""
    if height <= profile[0][1]:
        return profile[0][0]
    for (r0, h0), (r1, h1) in zip(profile, profile[1:]):
        if height <= h1:
            return r0 + (r1 - r0) * (height - h0) / (h1 - h0)
    return profile[-1][0]


class Part:
    """One exported mesh: primitives are merged into a single bmesh with a linear FLOAT_COLOR layer.

    Colours are a tuple or a function of the vertex position in the primitive's own frame. Inside
    `with part.placed(matrix):` every primitive is moved by `matrix` after it has been coloured.
    """

    def __init__(self, name, frame=None):
        self.name = name
        self.bm = bmesh.new()
        self.colors = self.bm.loops.layers.float_color.new("Color")
        self.xf = Matrix.Identity(4) if frame is None else frame.copy()

    @contextlib.contextmanager
    def placed(self, matrix):
        previous = self.xf
        self.xf = previous @ matrix
        try:
            yield self
        finally:
            self.xf = previous

    def world(self):
        """Inside this block primitives are given in the final authoring coordinates, frame ignored."""
        return self.placed(self.xf.inverted())

    def paint(self, faces, color):
        for face in faces:
            for loop in face.loops:
                c = color(loop.vert.co) if callable(color) else color
                loop[self.colors] = (c[0], c[1], c[2], 1.0)

    def map_uv(self, faces, uv):
        layer = self.bm.loops.layers.uv.verify()
        for face in faces:
            for loop in face.loops:
                loop[layer].uv = uv(loop.vert.co)

    def _faces(self, verts):
        return list(dict.fromkeys(face for vert in verts for face in vert.link_faces))

    def _move(self, faces):
        if self.xf == Matrix.Identity(4):
            return
        verts = list(dict.fromkeys(vert for face in faces for vert in face.verts))
        bmesh.ops.transform(self.bm, matrix=self.xf, verts=verts)

    def _finish(self, faces, color, smooth, uv=None):
        for face in faces:
            face.smooth = smooth
        self.paint(faces, color)
        if uv is not None:
            self.map_uv(faces, uv)
        self._move(faces)
        return faces

    def sphere(self, center, radii, segments, rings, color, smooth=True, lump=0.0, seed=0.0):
        """An ellipsoid from pole to pole; `lump` pushes each ring vertex in or out by up to that fraction.

        Built as a lathe because bmesh.ops.create_uvsphere orders its faces by memory address, which
        makes the exported index buffers differ from run to run.
        """
        profile = tuple((radii[0] * math.sin(math.pi * i / rings), radii[2] * -math.cos(math.pi * i / rings)) for i in range(rings + 1))
        fold = (lambda height, angle: 1.0 + lump * (2.0 * hash01(height, angle, 0.0, seed) - 1.0)) if lump else None
        return self.lathe(profile, segments, color, offset=center, fold=fold, smooth=smooth, squash=radii[1] / radii[0])

    def box(self, center, size, color, rotation=None, smooth=False, skip=(), cuts=(1, 1, 1)):
        """A cuboid built as one grid per face.

        `skip` names the faces nobody can see ('+x', '-x', '+y', '-y', '+z', '-z'); `cuts` is the
        number of cells along each axis, so big surfaces get vertices to hold baked occlusion.
        """
        half = [s / 2.0 for s in size]
        units = (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)))
        if rotation is None:
            origin, frame = Vector(center), contextlib.nullcontext()
        else:
            origin, frame = Vector((0.0, 0.0, 0.0)), self.placed(Matrix.Translation(center) @ rotation)
        faces = []
        with frame:
            for name, (axis, sign, a, b) in BOX_FACES.items():
                if name in skip:
                    continue
                corner = origin + units[axis] * (sign * half[axis]) - units[a] * half[a] - units[b] * half[b]
                faces += self.grid(corner, units[a] * size[a], units[b] * size[b], cuts[a], cuts[b], color, smooth)
        return faces

    def lathe(self, profile, segments, color, offset=(0.0, 0.0, 0.0), fold=None, cap_bottom=False, smooth=True, squash=1.0, uv=None):
        """Revolves a (radius, height) profile, listed bottom to top, around the local Z axis.

        A radius of zero collapses the ring into a single pole vertex. `fold(height, angle)` scales
        the radius, which is how robes get their pleats; `squash` flattens the Y direction.
        """
        origin = Vector(offset)
        rings = []
        for radius, height in profile:
            if radius < 1e-6:
                rings.append([self.bm.verts.new(origin + Vector((0.0, 0.0, height)))])
                continue
            ring = []
            for j in range(segments):
                angle = math.tau * j / segments
                r = radius * (fold(height, angle) if fold else 1.0)
                ring.append(self.bm.verts.new(origin + Vector((r * math.cos(angle), r * math.sin(angle) * squash, height))))
            rings.append(ring)
        faces = []
        for lower, upper in zip(rings, rings[1:]):
            for j in range(segments):
                k = (j + 1) % segments
                if len(lower) == 1:
                    faces.append(self.bm.faces.new((lower[0], upper[k], upper[j])))
                elif len(upper) == 1:
                    faces.append(self.bm.faces.new((lower[j], lower[k], upper[0])))
                else:
                    faces.append(self.bm.faces.new((lower[j], lower[k], upper[k], upper[j])))
        if cap_bottom and len(rings[0]) > 1:
            faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        return self._finish(faces, color, smooth, uv)

    def tube(self, path, radii, segments, color, up=(0.0, 0.0, 1.0), flat=1.0, closed=False, caps=True, smooth=True, uv=None):
        """Sweeps a round (or, with `flat` < 1, flattened) section along a polyline.

        `radii` is one radius per path point; a zero radius ends the tube in a point. The section is
        `radius` wide across `tangent x up` and `radius * flat` thick along `up`, so a leaf is a tube
        with a small `flat` and `up` pointing out of its face.
        """
        points = [Vector(p) for p in path]
        count = len(points)
        hint = Vector(up)
        rings = []
        for i, point in enumerate(points):
            if closed:
                tangent = points[(i + 1) % count] - points[i - 1]
            else:
                tangent = points[min(i + 1, count - 1)] - points[max(i - 1, 0)]
            tangent.normalize()
            side = tangent.cross(hint)
            if side.length < 1e-6:
                side = tangent.cross(Vector((1.0, 0.0, 0.0)))
            side.normalize()
            thick = tangent.cross(side)
            radius = radii[i]
            if radius < 1e-6:
                rings.append([self.bm.verts.new(point)])
                continue
            ring = []
            for j in range(segments):
                angle = math.tau * j / segments
                ring.append(self.bm.verts.new(point + side * (radius * math.cos(angle)) + thick * (radius * flat * math.sin(angle))))
            rings.append(ring)
        faces = []
        pairs = list(zip(rings, rings[1:]))
        if closed:
            pairs.append((rings[-1], rings[0]))
        for lower, upper in pairs:
            for j in range(segments):
                k = (j + 1) % segments
                if len(lower) == 1:
                    faces.append(self.bm.faces.new((lower[0], upper[k], upper[j])))
                elif len(upper) == 1:
                    faces.append(self.bm.faces.new((lower[j], lower[k], upper[0])))
                else:
                    faces.append(self.bm.faces.new((lower[j], lower[k], upper[k], upper[j])))
        if caps and not closed:
            if len(rings[0]) > 1:
                faces.append(self.bm.faces.new(list(reversed(rings[0]))))
            if len(rings[-1]) > 1:
                faces.append(self.bm.faces.new(rings[-1]))
        return self._finish(faces, color, smooth, uv)

    def grid(self, corner, across, along, columns, rows, color, smooth=False, uv=None):
        """A flat grid of columns x rows quads from `corner`; the visible side is `across` x `along`."""
        origin = Vector(corner)
        across, along = Vector(across), Vector(along)
        verts = [
            [self.bm.verts.new(origin + across * (i / columns) + along * (j / rows)) for j in range(rows + 1)]
            for i in range(columns + 1)
        ]
        faces = [
            self.bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
            for i in range(columns)
            for j in range(rows)
        ]
        return self._finish(faces, color, smooth, uv)

    def radial(self, center, across, along, radius, rings, segments, color, smooth=True, uv=None):
        """A disc in the plane of `across` x `along` (unit vectors), facing across x along.

        Colour is a function of the vertex position, so a radial gradient is `color = f(distance)`.
        """
        center, across, along = Vector(center), Vector(across), Vector(along)
        hub = self.bm.verts.new(center)
        previous = [hub]
        faces = []
        for i in range(1, rings + 1):
            r = radius * i / rings
            ring = [
                self.bm.verts.new(center + (across * math.cos(math.tau * j / segments) + along * math.sin(math.tau * j / segments)) * r)
                for j in range(segments)
            ]
            for j in range(segments):
                k = (j + 1) % segments
                if len(previous) == 1:
                    faces.append(self.bm.faces.new((hub, ring[j], ring[k])))
                else:
                    faces.append(self.bm.faces.new((previous[j], ring[j], ring[k], previous[k])))
            previous = ring
        return self._finish(faces, color, smooth, uv)

    def polygon(self, points, color, smooth=False, uv=None):
        """One flat face through `points`, listed counter-clockwise seen from the visible side."""
        face = self.bm.faces.new([self.bm.verts.new(p) for p in points])
        return self._finish([face], color, smooth, uv)

    def ribbon(self, left, right, color, toward=None, smooth=False):
        """A strip between two equally long polylines; `toward` picks the visible side."""
        left = [self.bm.verts.new(p) for p in left]
        right = [self.bm.verts.new(p) for p in right]
        faces = [
            self.bm.faces.new((left[i], right[i], right[i + 1], left[i + 1])) for i in range(len(left) - 1)
        ]
        self._finish(faces, color, smooth)
        if toward is not None:
            self.orient(faces, toward)
        return faces

    def fan(self, center, ring, center_color, ring_color):
        """A soft spot: a triangle fan whose colour fades from the middle to the edge."""
        hub = self.bm.verts.new(center)
        rim = [self.bm.verts.new(p) for p in ring]
        faces = [self.bm.faces.new((hub, rim[i], rim[(i + 1) % len(rim)])) for i in range(len(rim))]
        for face in faces:
            face.smooth = True
            for loop in face.loops:
                c = center_color if loop.vert == hub else ring_color
                loop[self.colors] = (c[0], c[1], c[2], 1.0)
        self._move(faces)
        return faces

    def orient(self, faces, toward):
        """Flips faces whose normal points away from `toward` (a point, or a function of the face centre).

        `toward` is in the coordinates the primitives were given in, whatever the frame.
        """
        to_local = self.xf.inverted()
        for face in faces:
            face.normal_update()
            centre = face.calc_center_median()
            local = to_local @ centre
            target = self.xf @ (toward(local) if callable(toward) else Vector(toward))
            if face.normal.dot(target - centre) < 0.0:
                face.normal_flip()

    def crease(self, degrees=50.0):
        """Edges sharper than `degrees` stay hard; everything else shades smooth."""
        limit = math.radians(degrees)
        for edge in self.bm.edges:
            if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > limit:
                edge.smooth = False

    def raycaster(self):
        return BVHTree.FromBMesh(self.bm)

    def triangles(self):
        return sum(len(face.verts) - 2 for face in self.bm.faces)

    def build(self, material, crease=True):
        if crease:
            self.crease()
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.update()
        mesh.color_attributes.active_color = mesh.color_attributes["Color"]
        mesh.materials.append(material)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def surface_point(tree, x, z, lift=0.0, side=1.0):
    """Where a ray from far ahead at (x, z) meets the mesh, lifted off the surface by `lift`.

    `side` is +1 when the face looks toward +Y and -1 when it looks toward -Y.
    """
    hit = tree.ray_cast(Vector((x, 2.0 * side, z)), Vector((0.0, -side, 0.0)))
    if hit[0] is None:
        raise RuntimeError(f"no surface at x={x} z={z}")
    return hit[0] + hit[1] * lift


def vertex_color_material(name):
    """A plain Principled material whose base colour is the 'Color' attribute, so COLOR_0 gets exported."""
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    attribute = tree.nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "Color"
    tree.links.new(attribute.outputs["Color"], principled.inputs["Base Color"])
    return material


def image_material(name, path, repeat=False):
    """A Principled material whose base colour is the image at `path` (exported as an embedded JPEG)."""
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(path)
    texture.image.name = name
    texture.extension = "REPEAT" if repeat else "EXTEND"
    texture.interpolation = "Linear"
    tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    return material


def bake_vertex_occlusion(objects, distance, samples, floor):
    """Multiplies each object's 'Color' by Cycles ambient occlusion baked per corner.

    Every object in the scene occludes; `floor` is the darkest a fully hidden corner gets.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.seed = 0
    scene.render.bake.target = "VERTEX_COLORS"
    scene.world = bpy.data.worlds.new("occlusion")
    scene.world.light_settings.distance = distance
    for obj in objects:
        mesh = obj.data
        mesh.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
        mesh.color_attributes.active_color = mesh.color_attributes["AO"]
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO")
        base, occlusion = mesh.color_attributes["Color"].data, mesh.color_attributes["AO"].data
        # The bake is noisy per corner; averaging it per vertex keeps neighbouring corners identical,
        # which lets the exporter share vertices instead of splitting every one of them.
        total, count = [0.0] * len(mesh.vertices), [0] * len(mesh.vertices)
        for loop in mesh.loops:
            total[loop.vertex_index] += occlusion[loop.index].color[0]
            count[loop.vertex_index] += 1
        for loop in mesh.loops:
            shade = floor + (1.0 - floor) * total[loop.vertex_index] / count[loop.vertex_index]
            r, g, b, a = base[loop.index].color
            base[loop.index].color = (r * shade, g * shade, b * shade, a)
        mesh.color_attributes.remove(mesh.color_attributes["AO"])
        mesh.color_attributes.active_color = mesh.color_attributes["Color"]


# Option names come from bpy.ops.export_scene.gltf.get_rna_type().properties in Blender 5.2.
GLTF_OPTIONS = {
    "export_format": "GLB",
    "use_selection": True,
    "export_yup": True,
    "export_apply": True,
    "export_materials": "EXPORT",
    "export_vertex_color": "MATERIAL",
    "export_all_vertex_colors": False,
    "export_active_vertex_color_when_no_material": False,
    "export_image_format": "JPEG",
    "export_jpeg_quality": 85,
    "export_texcoords": True,
    "export_normals": True,
    "export_tangents": False,
    "export_attributes": False,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
    "export_cameras": False,
    "export_lights": False,
    "export_extras": False,
    "export_draco_mesh_compression_enable": False,
    "export_meshopt_compression_enable": False,
    "export_use_gltfpack": False,
}


def export_glb(objects, path):
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties
    unknown = [key for key in GLTF_OPTIONS if key not in properties]
    if unknown:
        raise RuntimeError(f"glTF exporter in Blender {bpy.app.version_string} has no option(s): {unknown}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, **GLTF_OPTIONS)
