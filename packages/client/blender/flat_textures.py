"""The five flat textures of the hall, painted in Blender and handed to hall.py as PNG files.

floor, sky and sunbeams are Cycles bakes of procedural node trees; backdrop (the mural) and
cushionTop are flat Workbench renders of vertex-coloured 2D geometry. Everything is deterministic:
fixed seeds, no clock, no random module. The exporter turns the PNGs into JPEG once, inside the glb.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

import common
from common import Part, mix, rgb, scaled

FLOOR_BOARDS = 28
FLOOR_PIXELS = 1024
FLOOR_METERS = 7.0
SKY_SIZE = (1024, 256)
SKY_METERS = (70.0, 16.0)
BEAM_SIZE = (64, 256)
MURAL_SIZE = (2048, 1024)
MURAL_METERS = (14.0, 6.0)
CUSHION_PIXELS = 256
CUSHION_METERS = 0.8


class Nodes:
    """Terse access to a material node tree: every method returns an output socket."""

    def __init__(self, tree):
        self.tree = tree
        for node in list(tree.nodes):
            tree.nodes.remove(node)

    def node(self, kind, **props):
        node = self.tree.nodes.new(kind)
        for key, value in props.items():
            setattr(node, key, value)
        return node

    def feed(self, socket, value):
        if isinstance(value, (int, float)):
            socket.default_value = value
        elif isinstance(value, (tuple, list)):
            socket.default_value = (*value, 1.0) if len(socket.default_value) == 4 and len(value) == 3 else tuple(value)
        else:
            self.tree.links.new(value, socket)

    def math(self, operation, a, b=None, c=None, clamp=False):
        node = self.node("ShaderNodeMath", operation=operation, use_clamp=clamp)
        for index, value in enumerate((a, b, c)):
            if value is not None:
                self.feed(node.inputs[index], value)
        return node.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b)

    def sub(self, a, b):
        return self.math("SUBTRACT", a, b)

    def mul(self, a, b):
        return self.math("MULTIPLY", a, b)

    def div(self, a, b):
        return self.math("DIVIDE", a, b)

    def minimum(self, a, b):
        return self.math("MINIMUM", a, b)

    def floor(self, a):
        return self.math("FLOOR", a)

    def fract(self, a):
        return self.math("FRACT", a)

    def sine(self, a):
        return self.math("SINE", a)

    def cosine(self, a):
        return self.math("COSINE", a)

    def power(self, a, b):
        return self.math("POWER", a, b)

    def absolute(self, a):
        return self.math("ABSOLUTE", a)

    def wrap_mod(self, a, b):
        return self.math("FLOORED_MODULO", a, b)

    def map_range(self, value, low, high, out_low=0.0, out_high=1.0, smooth=False, clamp=True):
        node = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR", clamp=clamp)
        for name, entry in (("Value", value), ("From Min", low), ("From Max", high), ("To Min", out_low), ("To Max", out_high)):
            self.feed(node.inputs[name], entry)
        return node.outputs["Result"]

    def uv(self):
        coords = self.node("ShaderNodeTexCoord").outputs["UV"]
        separate = self.node("ShaderNodeSeparateXYZ")
        self.tree.links.new(coords, separate.inputs["Vector"])
        return separate.outputs["X"], separate.outputs["Y"]

    def combine(self, x, y, z=0.0):
        node = self.node("ShaderNodeCombineXYZ")
        for name, value in (("X", x), ("Y", y), ("Z", z)):
            self.feed(node.inputs[name], value)
        return node.outputs["Vector"]

    def length(self, vector):
        node = self.node("ShaderNodeVectorMath", operation="LENGTH")
        self.feed(node.inputs[0], vector)
        return node.outputs["Value"]

    def white(self, w):
        node = self.node("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
        self.feed(node.inputs["W"], w)
        return node.outputs["Value"]

    def noise(self, vector, w=None, scale=1.0, detail=3.0, roughness=0.55, dimensions="3D"):
        node = self.node("ShaderNodeTexNoise", noise_dimensions=dimensions)
        self.feed(node.inputs["Vector"], vector)
        if w is not None:
            self.feed(node.inputs["W"], w)
        self.feed(node.inputs["Scale"], scale)
        self.feed(node.inputs["Detail"], detail)
        self.feed(node.inputs["Roughness"], roughness)
        return node.outputs["Fac"]

    def blend(self, factor, a, b):
        node = self.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        self.feed(node.inputs[0], factor)
        self.feed(node.inputs[6], a)
        self.feed(node.inputs[7], b)
        return node.outputs[2]

    def tint(self, color, factor):
        node = self.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        self.feed(node.inputs[0], 1.0)
        self.feed(node.inputs[6], color)
        self.feed(node.inputs[7], self.combine(factor, factor, factor))
        return node.outputs[2]

    def ramp(self, value, stops):
        node = self.node("ShaderNodeValToRGB")
        elements = node.color_ramp.elements
        while len(elements) < len(stops):
            elements.new(0.5)
        for element, (position, color) in zip(elements, stops):
            element.position = position
            element.color = (*color, 1.0)
        self.feed(node.inputs["Fac"], value)
        return node.outputs["Color"]


def bake_emission(name, size, paint, path):
    """Bakes what `paint(nodes)` returns (a colour socket) onto a UV square and saves it as PNG."""
    width, height = size
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 2
    scene.render.bake.use_clear = True

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new(p) for p in ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0))])
    layer = bm.loops.layers.uv.new("UVMap")
    for loop, uv in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[layer].uv = uv
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)

    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    nodes = Nodes(material.node_tree)
    emission = nodes.node("ShaderNodeEmission")
    nodes.feed(emission.inputs["Color"], paint(nodes))
    output = nodes.node("ShaderNodeOutputMaterial")
    nodes.tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    image = bpy.data.images.new(name, width, height, alpha=False)
    target = nodes.node("ShaderNodeTexImage")
    target.image = image
    nodes.tree.nodes.active = target
    target.select = True
    mesh.materials.append(material)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="EMIT")
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.objects.remove(obj)


def floor_paint(mat):
    wood, groove = rgb(mat["floorWood"]), rgb(mat["floorGroove"])
    dark, light = scaled(wood, 0.8), scaled(wood, 1.16)

    def paint(n):
        u, v = n.uv()
        across = n.mul(u, FLOOR_BOARDS)
        column, within = n.floor(across), n.fract(across)
        count = n.add(2.0, n.floor(n.mul(n.white(n.add(column, 0.37)), 3.0)))
        along = n.add(n.mul(v, count), n.white(n.add(column, 100.1)))
        board, ahead = n.floor(along), n.fract(along)
        key = n.add(n.mul(column, 4.0), n.wrap_mod(board, count))
        tone = n.white(n.add(key, 300.3))
        phase = n.white(n.add(key, 500.7))

        turn_u, turn_v = n.mul(u, math.tau), n.mul(v, math.tau)
        grain = n.noise(
            n.combine(
                n.add(n.mul(n.cosine(turn_u), 27.0), n.mul(phase, 31.0)),
                n.mul(n.sine(turn_u), 27.0),
                n.mul(n.cosine(turn_v), 1.5),
            ),
            w=n.add(n.mul(n.sine(turn_v), 1.5), n.mul(phase, 7.0)),
            detail=3.0,
            roughness=0.6,
            dimensions="4D",
        )
        plank = n.tint(n.blend(tone, dark, light), n.map_range(grain, 0.3, 0.7, 0.8, 1.14))

        side = n.mul(n.minimum(within, n.sub(1.0, within)), FLOOR_PIXELS / FLOOR_BOARDS)
        end = n.mul(n.minimum(ahead, n.sub(1.0, ahead)), n.div(float(FLOOR_PIXELS), count))
        edge = n.map_range(n.minimum(side, end), 0.6, 1.9, 0.0, 1.0, smooth=True)
        return n.blend(edge, groove, plank)

    return paint


def sky_paint(scene_tokens):
    top, mid, low, horizon = (rgb(scene_tokens[k]) for k in ("skyTop", "skyMid", "skyLow", "skyHorizon"))
    cloud, disc, halo = rgb(scene_tokens["skyCloud"]), rgb(scene_tokens["sunDisc"]), rgb(scene_tokens["sunHalo"])
    meters_u, meters_v = SKY_METERS
    sun_u, sun_v = 0.59, 0.18

    def paint(n):
        u, v = n.uv()
        color = n.ramp(v, ((0.0, horizon), (0.25, low), (0.55, mid), (1.0, top)))
        away = n.length(n.combine(n.mul(n.sub(u, sun_u), meters_u), n.mul(n.sub(v, sun_v), meters_v)))
        glow = n.power(n.sub(1.0, n.map_range(away, 0.0, 17.0, 0.0, 1.0, smooth=True)), 2.0)
        color = n.blend(n.mul(glow, 0.85), color, halo)
        color = n.blend(n.sub(1.0, n.map_range(away, 1.6, 2.8, 0.0, 1.0, smooth=True)), color, disc)

        wisps = n.noise(n.combine(n.mul(u, 6.0), n.mul(v, 38.0), 3.7), detail=4.0, roughness=0.6)
        body = n.map_range(wisps, 0.47, 0.72, 0.0, 1.0, smooth=True)
        band = n.mul(
            n.map_range(v, 0.06, 0.2, 0.0, 1.0, smooth=True),
            n.sub(1.0, n.map_range(v, 0.34, 0.58, 0.0, 1.0, smooth=True)),
        )
        return n.blend(n.mul(n.mul(body, band), 0.5), color, cloud)

    return paint


def beam_paint(scene_tokens):
    beam = rgb(scene_tokens["beam"])

    def paint(n):
        u, v = n.uv()
        edge = n.power(n.sub(1.0, n.absolute(n.sub(n.mul(u, 2.0), 1.0))), 1.2)
        return n.tint(beam, n.mul(n.mul(edge, v), 0.55))

    return paint


class Canvas:
    """Flat 2D painting as vertex-coloured geometry in the XZ plane, later layers nearer the camera."""

    LAYER = 0.0008

    def __init__(self, name):
        self.part = Part(name)
        self.layers = 0

    def _y(self):
        self.layers += 1
        return -self.LAYER * self.layers

    def _color(self, color):
        return (lambda co: color(co.x, co.z)) if callable(color) else color

    def fill(self, points, color):
        y = self._y()
        self.part.polygon([(x, y, z) for x, z in points], self._color(color))

    def rect(self, x0, z0, x1, z1, color):
        self.fill(((x0, z0), (x1, z0), (x1, z1), (x0, z1)), color)

    def stroke(self, points, width, color, closed=False):
        y = self._y()
        pts = [Vector(p) for p in points]
        count = len(pts)
        left, right = [], []
        for i, p in enumerate(pts):
            if closed:
                before, after = pts[i - 1], pts[(i + 1) % count]
            else:
                before, after = pts[max(i - 1, 0)], pts[min(i + 1, count - 1)]
            tangent = (after - before).normalized()
            normal = Vector((-tangent.y, tangent.x))
            left.append((p.x + normal.x * width / 2, y, p.y + normal.y * width / 2))
            right.append((p.x - normal.x * width / 2, y, p.y - normal.y * width / 2))
        if closed:
            left.append(left[0])
            right.append(right[0])
        self.part.ribbon(left, right, self._color(color))

    def radial(self, cx, cz, radius, color, rings=14, segments=72):
        y = self._y()
        previous = None
        for i in range(rings + 1):
            r = max(radius * i / rings, 1e-4)
            loop = [(cx + r * math.cos(math.tau * j / segments), y, cz + r * math.sin(math.tau * j / segments)) for j in range(segments + 1)]
            if previous is not None:
                self.part.ribbon(previous, loop, self._color(color))
            previous = loop

    def disc(self, cx, cz, radius, color, segments=48):
        self.fill([(cx + radius * math.cos(math.tau * j / segments), cz + radius * math.sin(math.tau * j / segments)) for j in range(segments)], color)

    def circle(self, cx, cz, radius, width, color, segments=72):
        self.stroke([(cx + radius * math.cos(math.tau * j / segments), cz + radius * math.sin(math.tau * j / segments)) for j in range(segments)], width, color, closed=True)

    def build(self):
        self.part.build(common.vertex_color_material(self.part.name), crease=False)


def petal_outline(radius, steps=10):
    """A lotus petal pointing along +z, from its base at the origin to the tip."""
    def curve(p0, p1, p2, p3):
        out = []
        for i in range(steps + 1):
            t = i / steps
            s = 1.0 - t
            out.append(
                (
                    s ** 3 * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t ** 3 * p3[0],
                    s ** 3 * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t ** 3 * p3[1],
                )
            )
        return out

    base, tip = (0.0, 0.18 * radius), (0.0, radius)
    right = curve(base, (0.32 * radius, 0.42 * radius), (0.3 * radius, 0.82 * radius), tip)
    left = curve(tip, (-0.3 * radius, 0.82 * radius), (-0.32 * radius, 0.42 * radius), base)
    return right + left[1:-1]


def turned(points, angle, cx, cz):
    c, s = math.cos(angle), math.sin(angle)
    return [(cx + x * c - z * s, cz + x * s + z * c) for x, z in points]


def lotus(canvas, cx, cz, radius, petals, fill, line, width, offset=0.0):
    outline = petal_outline(radius)
    for i in range(petals):
        shape = turned(outline, offset + math.tau * i / petals, cx, cz)
        canvas.fill(shape, fill)
        canvas.stroke(shape, width, line, closed=True)


def render_flat(canvas, size, meters, center, path):
    """Renders a Canvas straight on, one pixel per texel, with no lighting or colour management."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = path
    for flag in dir(scene.render):
        if flag.startswith("use_stamp_"):
            setattr(scene.render, flag, False)  # stamps leak the render time into the PNG, and from there into the glb
    scene.display.render_aa = "32"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.display_settings.display_device = "sRGB"
    scene.world = bpy.data.worlds.new("flat")
    scene.world.color = (0.0, 0.0, 0.0)

    camera = bpy.data.cameras.new("flat")
    camera.type = "ORTHO"
    camera.ortho_scale = meters
    camera.clip_start, camera.clip_end = 1.0, 40.0
    lens = bpy.data.objects.new("flat", camera)
    lens.location = (center[0], -10.0, center[1])
    lens.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.collection.objects.link(lens)
    scene.camera = lens
    canvas.build()
    bpy.ops.render.render(write_still=True)


def mural(mat, path):
    width_m, height_m = MURAL_METERS
    half = width_m / 2
    ground, line, ink = rgb(mat["muralGround"]), rgb(mat["muralLine"]), rgb(mat["muralInk"])
    halo_color = rgb(mat["muralHalo"])
    canvas = Canvas("mural")

    def wall(z):
        return scaled(ground, 0.78 + 0.22 * math.sin(math.pi * z / height_m))

    canvas.rect(-half, 0.0, half, height_m, lambda x, z: wall(z))

    cx, cz = 0.0, 3.1
    canvas.radial(cx, cz, 3.0, lambda x, z: mix(halo_color, wall(z), common.smoothstep(0.0, 3.0, math.hypot(x - cx, z - cz)) ** 0.7))
    for k in range(32):
        angle = math.tau * k / 32
        near, far = (1.9, 2.95) if k % 2 == 0 else (1.9, 2.5)
        tip = (cx + far * math.cos(angle), cz + far * math.sin(angle))
        canvas.fill(
            (
                (cx + near * math.cos(angle - 0.035), cz + near * math.sin(angle - 0.035)),
                tip,
                (cx + near * math.cos(angle + 0.035), cz + near * math.sin(angle + 0.035)),
            ),
            lambda x, z: mix(line, wall(z), common.smoothstep(1.9, 2.95, math.hypot(x - cx, z - cz))),
        )
    for radius, strength, thick in ((0.95, 1.0, 0.05), (1.3, 0.7, 0.03), (1.62, 1.0, 0.045), (1.88, 0.7, 0.03)):
        canvas.circle(cx, cz, radius, thick, mix(ground, line, strength))
    lotus(canvas, cx, cz, 1.55, 16, mix(ground, halo_color, 0.16), mix(ground, line, 0.9), 0.025, offset=math.pi / 16)
    canvas.disc(cx, cz, 0.5, mix(halo_color, line, 0.4))
    canvas.circle(cx, cz, 0.5, 0.03, line)

    cloud_fill = mix(ground, halo_color, 0.42)
    cloud_line = mix(ground, line, 0.85)
    for side in (-1.0, 1.0):
        for x0, z0, scale in ((3.3, 4.7, 0.8), (3.4, 1.5, 0.8)):
            x0 *= side
            puffs = [(x0 + side * 0.34 * k * scale, z0 + 0.1 * math.sin(k * 2.1) * scale, (0.26 - 0.03 * k) * scale) for k in range(4)]
            for px, pz, pr in puffs:
                canvas.disc(px, pz, pr, cloud_fill)
                canvas.circle(px, pz, pr, 0.022, cloud_line)
            spiral = [
                (puffs[0][0] + (0.02 + 0.045 * t) * math.cos(side * t * 2.2), puffs[0][1] + (0.02 + 0.045 * t) * math.sin(side * t * 2.2))
                for t in (i * 0.35 for i in range(14))
            ]
            canvas.stroke(spiral, 0.016, cloud_line)
            for drop in (0.34, 0.5):
                swoosh = [(x0 + side * (0.05 + 0.1 * i) * scale * 1.5, z0 - drop * scale + 0.05 * math.sin(i * 0.8) * scale) for i in range(10)]
                canvas.stroke(swoosh, 0.018, cloud_line)

    for side in (-1.0, 1.0):
        x0, x1 = (side * 4.55, side * 6.15) if side > 0 else (side * 6.15, side * 4.55)
        canvas.rect(x0, 0.55, x1, 5.35, rgb(mat["dancheongGreen"]))
        canvas.rect(x0 + 0.06, 0.61, x1 - 0.06, 5.29, rgb(mat["lacquerDeep"]))
        centre = (x0 + x1) / 2
        lotus(canvas, centre, 3.9, 0.55, 8, rgb(mat["dancheongWhite"]), rgb(mat["brass"]), 0.02)
        lotus(canvas, centre, 1.9, 0.55, 8, rgb(mat["dancheongWhite"]), rgb(mat["brass"]), 0.02)
        for z in (3.9, 1.9):
            canvas.disc(centre, z, 0.1, rgb(mat["dancheongYellow"]))

    bands = ("dancheongGreen", "dancheongRed", "dancheongBlue", "dancheongYellow")
    for i, name in enumerate(bands):
        canvas.rect(-half, height_m - (i + 1) * 0.1, half, height_m - i * 0.1, rgb(mat[name]))
    canvas.rect(-half, height_m - 0.62, half, height_m - 0.4, rgb(mat["plaster"]))
    for k in range(int(width_m / 0.33)):
        canvas.disc(-half + 0.2 + k * 0.33, height_m - 0.51, 0.055, rgb(mat["dancheongWhite"]), segments=16)
    canvas.rect(-half, height_m - 0.66, half, height_m - 0.62, rgb(mat["woodDark"]))

    canvas.rect(-half, 0.0, half, 0.5, rgb(mat["woodDark"]))
    canvas.rect(-half, 0.5, half, 0.55, rgb(mat["brass"]))
    for k in range(int(width_m / 1.4)):
        canvas.rect(-half + 0.7 + k * 1.4 - 0.02, 0.0, -half + 0.7 + k * 1.4 + 0.02, 0.5, ink)

    # The painting is authored in true metres; stretching z fills the camera's 14 x 7 m frame
    # exactly, and the quad's 0..1 UVs stretch it back.
    frame_height = width_m * MURAL_SIZE[1] / MURAL_SIZE[0]
    canvas.part.bm.transform(Matrix.Diagonal((1.0, 1.0, frame_height / height_m, 1.0)))
    render_flat(canvas, MURAL_SIZE, width_m, (0.0, frame_height / 2), path)


def cushion(mat, path):
    base, stitch, petal = rgb(mat["cushionTop"]), rgb(mat["cushionStitch"]), rgb(mat["cushionPetal"])
    half = CUSHION_METERS / 2
    canvas = Canvas("cushionTop")
    canvas.rect(-half, -half, half, half, base)
    step = 0.0125
    for k in range(int(CUSHION_METERS / step) + 1):
        offset = -half + k * step
        canvas.rect(-half, offset, half, offset + step * 0.45, scaled(base, 0.93 + 0.04 * ((k * 7) % 3) / 2))
        canvas.rect(offset, -half, offset + step * 0.45, half, scaled(base, 1.05 - 0.04 * ((k * 5) % 3) / 2))
    canvas.circle(0.0, 0.0, 0.336, 0.02, stitch)
    lotus(canvas, 0.0, 0.0, 0.272, 8, petal, stitch, 0.012)
    canvas.disc(0.0, 0.0, 0.03, stitch, segments=24)
    render_flat(canvas, (CUSHION_PIXELS, CUSHION_PIXELS), CUSHION_METERS, (0.0, 0.0), path)


def build(inputs, out_dir):
    """Paints every textured mesh's picture; returns {mesh name: png path}."""
    mat, scene_tokens = inputs["material"], inputs["scene"]
    painters = {
        "floor": lambda path: bake_emission("floor", (FLOOR_PIXELS, FLOOR_PIXELS), floor_paint(mat), path),
        "sky": lambda path: bake_emission("sky", SKY_SIZE, sky_paint(scene_tokens), path),
        "sunbeams": lambda path: bake_emission("sunbeams", BEAM_SIZE, beam_paint(scene_tokens), path),
        "backdrop": lambda path: mural(mat, path),
        "cushionTop": lambda path: cushion(mat, path),
    }
    names = inputs["names"]["TEXTURED"]
    if sorted(painters) != sorted(names):
        raise RuntimeError(f"textures {sorted(painters)} differ from the contract {sorted(names)}")
    paths = {}
    for name in names:
        common.reset_scene()
        paths[name] = os.path.join(out_dir, f"{name}.png")
        painters[name](paths[name])
    return paths
