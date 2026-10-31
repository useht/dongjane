"""venues/<id>.glb: one model per venue built from a kit spec, so a new venue is data and no new script.

The spec (inputs["venues"][id]) lists, per mesh name, the pieces to draw in the world's own coordinates:
boxes, cylinders (cones, logs), ellipsoids, flat floors with a pattern, and gabled roofs. Every colour arrives as a
'#rrggbb' string; a pair of colours is a gradient from bottom to top (a floor's pair is its pattern's two colours).
The meshes a spec may name, and the ones authored at the origin to be instanced, come from inputs["names"].
"""

import os

from mathutils import Vector

import common
from common import GAME, Part, hash01, mix, rgb, smoothstep


def paint_of(paint, low, high):
    """A colour for a piece: one colour, or a function of the vertex that blends the pair from y = low (first) to y = high (second)."""
    if isinstance(paint, str):
        return rgb(paint)
    bottom, top = rgb(paint[0]), rgb(paint[1])
    return lambda co: mix(bottom, top, smoothstep(low, high, co.y))


def box(part, piece):
    lo, hi = piece["min"], piece["max"]
    size = [b - a for a, b in zip(lo, hi)]
    center = [(a + b) / 2.0 for a, b in zip(lo, hi)]
    cuts = (1, max(1, round(size[1] / 0.7)) if not isinstance(piece["paint"], str) else 1, 1)
    part.box(center, size, paint_of(piece["paint"], lo[1], hi[1]), skip=tuple(piece.get("skip", ())), cuts=cuts)


def cylinder(part, piece):
    a, b = piece["from"], piece["to"]
    low, high = min(a[1], b[1]), max(a[1], b[1])
    radius = piece["radius"]
    part.tube([a, b], [radius, piece.get("radiusTo", radius)], piece["sides"], paint_of(piece["paint"], low, high), smooth=not piece.get("flat", False))


def sphere(part, piece):
    at, radii = piece["at"], piece["radii"]
    part.ellipsoid(at, radii, piece["sides"], max(3, piece["sides"] // 2), paint_of(piece["paint"], at[1] - radii[1], at[1] + radii[1]))


def floor(part, piece):
    area, y, step, pattern = piece["area"], piece["y"], piece["step"], piece["pattern"]
    x0, x1, z0, z1 = area["minX"], area["maxX"], area["minZ"], area["maxZ"]
    paint = piece["paint"]
    # Seen from above: across runs along +z and along runs along +x, so that across x along faces up.
    if pattern == "plain":
        part.grid((x0, y, z0), (0.0, 0.0, z1 - z0), (x1 - x0, 0.0, 0.0), 1, 1, rgb(paint))
        return
    if pattern == "fade":
        low, high = rgb(paint[0]), rgb(paint[1])
        axis, start, end = ("z", z0, z1) if piece.get("along", "z") == "z" else ("x", x0, x1)
        cells = max(1, round((end - start) / step))
        # grid(columns, rows): columns are cells along `across` (z), rows along `along` (x)
        columns, rows = (cells, 1) if axis == "z" else (1, cells)
        part.grid((x0, y, z0), (0.0, 0.0, z1 - z0), (x1 - x0, 0.0, 0.0), columns, rows, lambda co: mix(low, high, smoothstep(start, end, co.z if axis == "z" else co.x)))
        return
    nx, nz = max(1, round((x1 - x0) / step)), max(1, round((z1 - z0) / step))
    sx, sz = (x1 - x0) / nx, (z1 - z0) / nz
    first, second = rgb(paint[0]), rgb(paint[1])
    if pattern == "checker":
        for i in range(nx):
            for j in range(nz):
                part.grid((x0 + i * sx, y, z0 + j * sz), (0.0, 0.0, sz), (sx, 0.0, 0.0), 1, 1, first if (i + j) % 2 == 0 else second)
        return
    if pattern == "boards":
        # Planks of width `step` side by side, each running the length of the area along `along`; neighbours alternate tone and vary a little.
        lengthwise_x = piece.get("along", "x") == "x"
        count = nz if lengthwise_x else nx
        for k in range(count):
            tone = mix(first, second, 1.0 if k % 2 else 0.0)
            tone = tuple(min(1.0, c * (0.95 + 0.1 * hash01(k, 0.0, y))) for c in tone)
            if lengthwise_x:
                part.grid((x0, y, z0 + k * sz), (0.0, 0.0, sz), (x1 - x0, 0.0, 0.0), 1, 1, tone)
            else:
                part.grid((x0 + k * sx, y, z0), (0.0, 0.0, z1 - z0), (sx, 0.0, 0.0), 1, 1, tone)
        return
    raise RuntimeError(f"unknown floor pattern {pattern!r}")


def gable(part, piece):
    """A closed roof: two slopes, two triangular ends and an underside. `from`/`to` are the corners at the eaves' height; `ridge` is its y."""
    (x0, eave, z0), (x1, _, z1) = piece["from"], piece["to"]
    ridge = piece["ridge"]
    color = paint_of(piece["paint"], eave, ridge)
    if piece["along"] == "z":
        xm = (x0 + x1) / 2.0
        slopes = [([(x0, eave, z0), (xm, ridge, z0), (xm, ridge, z1), (x0, eave, z1)], (-(ridge - eave), xm - x0, 0.0)),
                  ([(x1, eave, z1), (xm, ridge, z1), (xm, ridge, z0), (x1, eave, z0)], ((ridge - eave), x1 - xm, 0.0))]
        ends = [([(x0, eave, z0), (x1, eave, z0), (xm, ridge, z0)], (0.0, 0.0, -1.0)),
                ([(x0, eave, z1), (x1, eave, z1), (xm, ridge, z1)], (0.0, 0.0, 1.0))]
    else:
        zm = (z0 + z1) / 2.0
        slopes = [([(x0, eave, z0), (x0, ridge, zm), (x1, ridge, zm), (x1, eave, z0)], (0.0, zm - z0, -(ridge - eave))),
                  ([(x1, eave, z1), (x1, ridge, zm), (x0, ridge, zm), (x0, eave, z1)], (0.0, z1 - zm, (ridge - eave)))]
        ends = [([(x0, eave, z0), (x0, eave, z1), (x0, ridge, zm)], (-1.0, 0.0, 0.0)),
                ([(x1, eave, z0), (x1, eave, z1), (x1, ridge, zm)], (1.0, 0.0, 0.0))]
    faces = slopes + ends + [([(x0, eave, z0), (x1, eave, z0), (x1, eave, z1), (x0, eave, z1)], (0.0, -1.0, 0.0))]
    for points, outward in faces:
        made = part.polygon(points, color)
        direction = Vector(outward)
        part.orient(made, lambda centre, direction=direction: centre + direction)


SHAPES = {"box": box, "cylinder": cylinder, "sphere": sphere, "floor": floor, "gable": gable}


def draw(part, pieces):
    for piece in pieces:
        shape = SHAPES.get(piece["shape"])
        if shape is None:
            raise RuntimeError(f"unknown piece shape {piece['shape']!r}")
        shape(part, piece)


def build_kit(venue_id, spec, names, out_dir):
    unknown = sorted(set(spec["meshes"]) - set(names))
    if unknown:
        raise RuntimeError(f"venue {venue_id} names meshes {unknown} that the contract does not know {sorted(names)}")
    material = common.vertex_color_material(venue_id)
    parts = {}
    for name in names:
        pieces = spec["meshes"].get(name)
        if not pieces:
            continue
        part = Part(name, frame=GAME)
        draw(part, pieces)
        parts[name] = part
    if not parts:
        raise RuntimeError(f"venue {venue_id} has no pieces")
    triangles = {name: part.triangles() for name, part in parts.items()}
    objects = [part.build(material) for part in parts.values()]
    path = os.path.join(out_dir, "venues", f"{venue_id}.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    common.export_glb(objects, path)
    print(f"venue {venue_id} triangles:", triangles)


def build(inputs, out_dir):
    names = inputs["names"]["KIT_MESHES"]
    for index, (venue_id, spec) in enumerate(inputs["venues"].items()):
        if index:
            common.reset_scene()
        build_kit(venue_id, spec, names, out_dir)
