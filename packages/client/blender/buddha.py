"""buddha.glb: the scanned seated Buddha as one light mesh carrying a baked picture of its own light and shade.

blender/sources/buddha holds the scan; source.json says where it came from and under which licence. Here it is
stood on the origin facing +Z and scaled to the contract's height, reduced to the contract's triangle count,
unwrapped, and baked: ambient occlusion and a little cavity measured on the full scan are painted onto the light
mesh as one grey picture. The game tints it - granite on the hill of 갓바위, gold in the 법당 - so the picture holds
light and shade only. The glTF node carries where the head is (`headTop`, `headRadius`, in the model's own metres),
which the game uses to put the hat stone on it and dharma.py the halo behind it.

The scan can be swapped for any model Blender imports (glTF, OBJ, PLY, STL, FBX): change source.json and nothing else.
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import common

BAKE_SAMPLES = 16
AO_SAMPLES = 8
AO_DISTANCE = 0.15  # how far, on a 1 m statue, a fold looks for what shades it
AO_POWER = 2.0  # occlusion is mild on a statue, so it is squared to show
CAVITY_SPAN = 0.05  # pointiness below flat that reaches the deepest cavity
CAVITY_SHARE = 0.5  # how much of the shade is cavity rather than occlusion
FLOOR = 0.25  # the darkest the picture gets
MARGIN = 8  # pixels of colour spread past each island's edge
CAGE = 0.01  # how far above the light mesh the bake looks for the scan, and how far past it
REACH = 0.03
ISLAND_GAP = 0.004
SMART_ANGLE = math.radians(66.0)
JPEG_QUALITY = 80
FOOT_BAND = 0.01  # the lowest share of the height that counts as the foot
CROWN_BAND = 0.02  # the highest share that counts as the crown
HEAD_BAND = 0.14  # the highest share that is head (the shoulders begin below it)


def front_name(axis):
    """The importer's forward axis for a statue facing `axis`: forward lands at +Y, behind the statue, which faces -Y."""
    sign, letter = axis[0], axis[1]
    return letter if sign == "-" else "NEGATIVE_" + letter


def import_source(path, up, front):
    """Imports by file extension; every importer is told which way is up and which way the statue faces."""
    extension = os.path.splitext(path)[1].lower()
    axes = {"up_axis": up, "forward_axis": front_name(front)}
    if extension == ".obj":
        bpy.ops.wm.obj_import(filepath=path, **axes)
    elif extension == ".ply":
        bpy.ops.wm.ply_import(filepath=path, **axes)
    elif extension == ".stl":
        bpy.ops.wm.stl_import(filepath=path, **axes)
    elif extension == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, axis_up=up, axis_forward=axes["forward_axis"])
    elif extension in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise RuntimeError(f"cannot import a {extension} file: {path}")
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{path} holds no mesh")
    return meshes


def select_only(*objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[-1]


def points(mesh):
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def joined(meshes):
    select_only(*meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = "buddha"
    return obj


def stand(obj, height):
    """Scales the statue to `height`, puts the middle of its foot on the origin and its soles on z = 0."""
    mesh = obj.data
    co = points(mesh)
    low, high = co[:, 2].min(), co[:, 2].max()
    foot = co[co[:, 2] < low + FOOT_BAND * (high - low)]
    middle = Vector(((foot[:, 0].min() + foot[:, 0].max()) / 2, (foot[:, 1].min() + foot[:, 1].max()) / 2, low))
    mesh.transform(Matrix.Scale(height / (high - low), 4) @ Matrix.Translation(-middle))
    mesh.update()


def smooth(obj):
    mesh = obj.data
    select_only(obj)
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for polygon in mesh.polygons:
        polygon.use_smooth = True


def triangles(obj):
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def reduce_to(obj, limit):
    """Collapse-decimates to at most `limit` triangles."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    ratio = limit / triangles(obj)
    while triangles(obj) > limit:
        modifier = obj.modifiers.new("collapse", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        select_only(obj)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        ratio *= 0.98


def unwrap(obj):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=SMART_ANGLE, island_margin=ISLAND_GAP)
    bpy.ops.object.mode_set(mode="OBJECT")


def shade_material():
    """The scan's material for the bake: emits ambient occlusion times a cavity term, so baking 'emit' paints the shade."""
    material = bpy.data.materials.new("scan")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    ao = tree.nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = AO_SAMPLES
    ao.inside = False
    ao.only_local = True
    ao.inputs["Distance"].default_value = AO_DISTANCE
    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    cavity = tree.nodes.new("ShaderNodeMapRange")
    cavity.clamp = True
    cavity.inputs["From Min"].default_value = 0.5 - CAVITY_SPAN
    cavity.inputs["From Max"].default_value = 0.5
    cavity.inputs["To Min"].default_value = 0.0
    cavity.inputs["To Max"].default_value = 1.0
    tree.links.new(geometry.outputs["Pointiness"], cavity.inputs["Value"])

    def math_node(operation, *values):
        node = tree.nodes.new("ShaderNodeMath")
        node.operation = operation
        for slot, value in zip(node.inputs, values):
            if isinstance(value, bpy.types.NodeSocket):
                tree.links.new(value, slot)
            else:
                slot.default_value = value
        return node.outputs[0]

    detail = math_node("MULTIPLY_ADD", cavity.outputs["Result"], CAVITY_SHARE, 1.0 - CAVITY_SHARE)
    shade = math_node("MULTIPLY", math_node("POWER", ao.outputs["AO"], AO_POWER), detail)
    level = math_node("MULTIPLY_ADD", shade, 1.0 - FLOOR, FLOOR)
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(level, emission.inputs["Color"])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def picture_material(size):
    """The light mesh's material: one grey picture as the base colour; the bake paints into that picture."""
    image = bpy.data.images.new("buddha", size, size, alpha=False)
    image.generated_color = (1.0, 1.0, 1.0, 1.0)
    material = bpy.data.materials.new("buddha")
    material.use_nodes = True
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    principled.inputs["Roughness"].default_value = 1.0
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Linear"
    tree.links.new(node.outputs["Color"], principled.inputs["Base Color"])
    tree.nodes.active = node
    return material


def bake(high, low):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    settings = scene.render.bake
    settings.target = "IMAGE_TEXTURES"
    settings.use_selected_to_active = True
    settings.cage_extrusion = CAGE
    settings.max_ray_distance = REACH
    settings.margin = MARGIN
    settings.margin_type = "EXTEND"
    settings.use_clear = False
    scene.world = bpy.data.worlds.new("none")
    select_only(high, low)
    bpy.ops.object.bake(type="EMIT")


def head_of(obj):
    """Where the head is, in three's axes: the middle of the crown, and the head's radius."""
    co = points(obj.data)
    top, bottom = co[:, 2].max(), co[:, 2].min()
    height = top - bottom
    crown = co[co[:, 2] > top - CROWN_BAND * height]
    head = co[co[:, 2] > top - HEAD_BAND * height]
    width = head[:, 0].max() - head[:, 0].min()
    depth = head[:, 1].max() - head[:, 1].min()
    centre = (float(crown[:, 0].mean()), float(top), float(-crown[:, 1].mean()))
    return {"headTop": centre, "headRadius": float((width + depth) / 4.0)}


def build(inputs, out_dir):
    spec = inputs["buddha"]
    high = joined(import_source(spec["path"], spec["upAxis"], spec["frontAxis"]))
    stand(high, spec["height"])
    smooth(high)
    high.data.materials.clear()
    high.data.materials.append(shade_material())

    high.name = "scan"
    low = high.copy()
    low.data = high.data.copy()
    low.name = low.data.name = "buddha"
    bpy.context.scene.collection.objects.link(low)
    reduce_to(low, spec["maxTriangles"])
    smooth(low)
    unwrap(low)
    low.data.materials.clear()
    low.data.materials.append(picture_material(spec["textureSize"]))
    bake(high, low)

    bpy.data.objects.remove(high)
    head = head_of(low)
    low["headTop"] = list(head["headTop"])
    low["headRadius"] = head["headRadius"]
    names = inputs["names"]["BUDDHA_MESHES"]
    if names != ["buddha"]:
        raise RuntimeError(f"buddha meshes {names} differ from what this script makes")
    common.export_glb([low], os.path.join(out_dir, "buddha.glb"), export_extras=True, export_jpeg_quality=JPEG_QUALITY)
    print("buddha triangles:", triangles(low), "head:", head)
    return head
