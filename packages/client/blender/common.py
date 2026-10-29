"""Shared helpers for the Blender asset build.

Authoring axes: Z is up and +Y is forward (the way a monk faces). The glTF exporter turns that
into three's convention (Y up, forward -Z). Everything the models must agree with the game on
- dimensions, colours, names - arrives through --inputs; nothing here is a magic number about the
game. Run through build.py, never directly.
"""

import argparse
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


def interpolate(profile, height):
    """Radius of a (radius, height) profile, sorted by height, at the given height."""
    if height <= profile[0][1]:
        return profile[0][0]
    for (r0, h0), (r1, h1) in zip(profile, profile[1:]):
        if height <= h1:
            return r0 + (r1 - r0) * (height - h0) / (h1 - h0)
    return profile[-1][0]


class Part:
    """One exported mesh: primitives are merged into a single bmesh with a linear FLOAT_COLOR layer."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.colors = self.bm.loops.layers.float_color.new("Color")

    def paint(self, faces, color):
        for face in faces:
            for loop in face.loops:
                c = color(loop.vert.co) if callable(color) else color
                loop[self.colors] = (c[0], c[1], c[2], 1.0)

    def _faces(self, verts):
        return list(dict.fromkeys(face for vert in verts for face in vert.link_faces))

    def _finish(self, faces, color, smooth):
        for face in faces:
            face.smooth = smooth
        self.paint(faces, color)
        return faces

    def sphere(self, center, radii, segments, rings, color, smooth=True):
        matrix = Matrix.Translation(center) @ Matrix.Diagonal((*radii, 1.0))
        result = bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=rings, radius=1.0, matrix=matrix)
        return self._finish(self._faces(result["verts"]), color, smooth)

    def box(self, center, size, color, rotation=None, smooth=False):
        matrix = Matrix.Translation(center)
        if rotation is not None:
            matrix = matrix @ rotation
        matrix = matrix @ Matrix.Diagonal((*size, 1.0))
        result = bmesh.ops.create_cube(self.bm, size=1.0, matrix=matrix)
        return self._finish(self._faces(result["verts"]), color, smooth)

    def lathe(self, profile, segments, color, offset=(0.0, 0.0, 0.0), fold=None, cap_bottom=False, smooth=True):
        """Revolves a (radius, height) profile, listed bottom to top, around the local Z axis.

        A radius of zero collapses the ring into a single pole vertex. `fold(height, angle)` scales
        the radius, which is how robes get their pleats.
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
                ring.append(self.bm.verts.new(origin + Vector((r * math.cos(angle), r * math.sin(angle), height))))
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
        return self._finish(faces, color, smooth)

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
        return faces

    def orient(self, faces, toward):
        """Flips faces whose normal points away from `toward` (a point, or a function of the face centre)."""
        for face in faces:
            face.normal_update()
            centre = face.calc_center_median()
            target = toward(centre) if callable(toward) else Vector(toward)
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

    def build(self, material):
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


def surface_point(tree, x, z, lift=0.0):
    """Where a ray from far ahead (+Y) at (x, z) meets the mesh, lifted off the surface by `lift`."""
    hit = tree.ray_cast(Vector((x, 2.0, z)), Vector((0.0, -1.0, 0.0)))
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
