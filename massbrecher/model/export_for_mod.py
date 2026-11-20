"""Writes the Masskrug hammer in the form the weapon mod reads at runtime. Run with Blender, without its window:

    blender.exe -b --python massbrecher/model/export_for_mod.py

Reads masskrug_hammer.glb beside this file and writes into massbrecher/data/:
    hammer.json           the mesh: points, normals, tangents, texture coordinates and triangles, TRIANGLES of them
    hammer_basecolor.png  its colour
    hammer_normal.png     its normals, with the green channel turned for Unreal
    hammer_rm.png         presence (red, full), roughness (green) and metal (blue), as the game's material reads them

The mesh is written for Unreal: in centimetres, X along the hammer from the grip to the head, the grip point at
0 0 0, left-handed (Blender's Y negated, the triangles turned round). The game builds it with a procedural mesh
component, so no Unreal editor and no pak file are needed.
"""
import json
import math
import shutil
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "data"
TRIANGLES = 30000
TEXTURE_SIZE = 2048
# The model as it comes is a one-handed hammer of 98 cm. The game's weapon it stands in for is a polearm held in
# two hands, so the shaft is drawn out: the leather grip and the wooden shaft get STRETCH times their length, the
# rings between them and the head keep their shape, and the whole hammer is made SCALE times as large.
SCALE = 1.3
STRETCH = 2.3
STRETCHED = [(-0.450, -0.230), (-0.190, 0.130)]    # metres along the model's X: the leather grip, the wooden shaft
HANDS = 0.85        # metres from the hammer's end to the point the hands hold it at, in the finished hammer
HEAD = 1.4          # the head (the Masskrug) is this much larger again, in every direction: a heavy two-hander
# The pictures: the colour's strength and brightness, the least roughness, and how much of the model's metal is kept.
COLOUR, BRIGHT, ROUGH, METAL = 1.25, 1.1, 0.6, 0.2
SHADE_SAMPLES = 32      # how finely the hammer's own shade is worked out
SHADE_FLOOR = 0.3       # how bright the deepest hollow stays (0: black)
# True: the hammer gets no relief from its normals picture, only its shape. A test: in the game the hammer shows
# black and white blotches, as wrongly read normals make them.
FLAT_NORMALS = False
HEAD_FROM, HEAD_FULL = 0.125, 0.170    # metres along the model's X: where the head begins to grow, and where it is fully grown


def drawn_out(x):
    """Where a point at x along the model lies along the finished hammer, measured in metres from the model's X = 0."""
    moved = x
    for start, end in STRETCHED:
        moved += (STRETCH - 1) * (min(max(x, start), end) - start)
    moved += (HEAD - 1) * max(0.0, x - HEAD_FROM)
    return moved * SCALE


def girth(x):
    """How much thicker the hammer is at x than the model: 1 along the shaft, HEAD at the head, growing smoothly between."""
    part = min(max((x - HEAD_FROM) / (HEAD_FULL - HEAD_FROM), 0.0), 1.0)
    return 1 + (HEAD - 1) * part * part * (3 - 2 * part)


def triangles(obj):
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(HERE / "masskrug_hammer.glb"))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
hammer = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
before = triangles(hammer)

# The shade the hammer casts on itself, as a picture in the model's own layout: in the game the hammer is drawn
# unlit (the game's lit materials take only its own kind of texture, game test), so the dark of its hollows and
# seams is put into its colour picture. Made with Cycles on the full model, before it is reduced.
shade = None
try:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SHADE_SAMPLES
    target = bpy.data.images.new("hammer_shade", TEXTURE_SIZE, TEXTURE_SIZE)
    nodes = hammer.data.materials[0].node_tree.nodes
    node = nodes.new("ShaderNodeTexImage")
    node.image = target
    nodes.active = node
    bpy.ops.object.bake(type="AO", margin=8)
    shade = np.empty(TEXTURE_SIZE * TEXTURE_SIZE * 4, dtype=np.float32)
    target.pixels.foreach_get(shade)
    shade = shade.reshape(-1, 4)[:, :1]
    nodes.remove(node)
    bpy.data.images.remove(target)
    print(f"EXPORT shade baked: mean {float(shade.mean()):.2f}")
except Exception as error:  # without the shade the hammer is flatter, but whole
    print(f"EXPORT no shade: {error}")
modifier = hammer.modifiers.new("Decimate", "DECIMATE")
modifier.ratio = min(1.0, TRIANGLES / before)
bpy.ops.object.modifier_apply(modifier="Decimate")
modifier = hammer.modifiers.new("Triangulate", "TRIANGULATE")
bpy.ops.object.modifier_apply(modifier="Triangulate")
bpy.ops.object.shade_smooth()

mesh = hammer.data
mesh.calc_tangents()
uv = mesh.uv_layers.active.data
low = [min(v.co[i] for v in mesh.vertices) for i in range(3)]
high = [max(v.co[i] for v in mesh.vertices) for i in range(3)]
middle_y, middle_z = (low[1] + high[1]) / 2, (low[2] + high[2]) / 2
GRIP = drawn_out(low[0]) + HANDS   # along the finished hammer
print(f"EXPORT model from {[round(v, 3) for v in low]} to {[round(v, 3) for v in high]} m, {triangles(hammer)} triangles; "
      f"finished hammer {drawn_out(high[0]) - drawn_out(low[0]):.2f} m long")

# One point of the mesh for each different corner (place, normal, tangent, texture coordinate).
index_of, points, normals, tangents, flips, coordinates, faces = {}, [], [], [], [], [], []
for polygon in mesh.polygons:
    corners = []
    for loop_index in polygon.loop_indices:
        loop = mesh.loops[loop_index]
        place = mesh.vertices[loop.vertex_index].co
        key = (loop.vertex_index, tuple(round(v, 4) for v in loop.normal), tuple(round(v, 4) for v in uv[loop_index].uv), loop.bitangent_sign)
        if key not in index_of:
            index_of[key] = len(index_of)
            points += [round((drawn_out(place.x) - GRIP) * 100, 3), round(-(place.y - middle_y) * SCALE * girth(place.x) * 100, 3), round((place.z - middle_z) * SCALE * girth(place.x) * 100, 3)]
            normals += [round(loop.normal.x, 4), round(-loop.normal.y, 4), round(loop.normal.z, 4)]
            tangents += [round(loop.tangent.x, 4), round(-loop.tangent.y, 4), round(loop.tangent.z, 4)]
            flips.append(1 if loop.bitangent_sign > 0 else 0)   # Unreal's Y runs the other way
            coordinates += [round(uv[loop_index].uv.x, 5), round(1 - uv[loop_index].uv.y, 5)]
        corners.append(index_of[key])
    faces += [corners[0], corners[2], corners[1]]   # turned round for the left-handed space

OUT.mkdir(exist_ok=True)
length = (drawn_out(high[0]) - GRIP) * 100
(OUT / "hammer.json").write_text(json.dumps({"length": round(length, 2), "points": points, "normals": normals, "tangents": tangents,
                                             "flips": flips, "coordinates": coordinates, "triangles": faces}, separators=(",", ":")))
print(f"EXPORT hammer.json: {len(index_of)} points, {len(faces) // 3} triangles, {length:.1f} cm from the grip to the head's end")

# Pictures of the finished hammer for the game's menus (massbrecher/icons/): the mesh in Blender takes the finished
# shape, and is rendered slanting from the lower left (the shaft's end) to the upper right (the head), as the
# game's own weapon pictures are, on a see-through ground.
for vertex in mesh.vertices:
    x, y, z = vertex.co
    vertex.co = (drawn_out(x), (y - middle_y) * SCALE * girth(x), (z - middle_z) * SCALE * girth(x))
mesh.update()
scene = bpy.context.scene
world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.78, 0.85, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.4
scene.world = world
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 4
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
scene.collection.objects.link(sun)
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
hammer.location = (0, 0, 0)
hammer.rotation_mode = "XYZ"    # the model comes with its turn written another way, which would win
hammer.rotation_euler = (0, math.radians(-45), 0)
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
camera.data.type = "ORTHO"
camera.data.ortho_scale = max(hammer.dimensions) * 0.88     # the slanting hammer fills the square
camera.location = (0, -6, 0)
camera.rotation_euler = (math.radians(90), 0, 0)
scene.collection.objects.link(camera)
scene.camera = camera
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
ICONS = HERE.parent / "icons"
ICONS.mkdir(exist_ok=True)
for name, size in (("render", 1024), ("icon", 256)):
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.filepath = str(ICONS / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    shutil.copyfile(ICONS / f"{name}.png", OUT / f"hammer_{name}.png")     # the mod shows them in the game's weapon slots
    print(f"EXPORT icons/{name}.png: {size} x {size}")

for image in list(bpy.data.images):
    if image.size[0] == 0 or image.name in ("Render Result", "Viewer Node"):
        continue
    name = image.name.lower()
    kind = "normal" if "normal" in name else "rm" if "_rm" in name or "rough" in name else "basecolor"
    image.scale(TEXTURE_SIZE, TEXTURE_SIZE)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(-1, 4)
    if kind == "basecolor":
        # Stronger colours: in the game's dark scenes the white and blue of the model sank into grey (game test).
        grey = pixels[:, :3].mean(axis=1, keepdims=True)
        pixels[:, :3] = np.clip((grey + (pixels[:, :3] - grey) * COLOUR) * BRIGHT, 0, 1)
        if shade is not None:
            pixels[:, :3] *= SHADE_FLOOR + (1 - SHADE_FLOOR) * shade
    else:
        if kind == "normal":
            pixels[:, 1] = 1 - pixels[:, 1]     # glTF's normals point up in green, Unreal's down
            if FLAT_NORMALS:
                pixels[:, :3] = (0.5, 0.5, 1.0)
        else:
            # The game's material reads this picture ("ARM") as: red, how much of the surface is there at all (with
            # little red the hammer was a see-through veil, game test); green, roughness; blue, metal. The model
            # has roughness in green and metal in blue already.
            pixels[:, 0] = 1.0                              # all there
            pixels[:, 1] = np.maximum(pixels[:, 1], ROUGH)  # dull enough to show its colour
            pixels[:, 2] *= METAL                           # metal mirrors the dark around it and has no colour of its own
        # The mod can load a picture only as a colour picture, which the game makes darker as it reads it: the
        # numbers of these two are written brighter by as much, so that they arrive as they are.
        values = pixels[:, :3]
        pixels[:, :3] = np.where(values <= 0.0031308, 12.92 * values, 1.055 * np.power(values, 1 / 2.4) - 0.055)
    pixels[:, 3] = 1.0  # fully opaque, written into the file: a material may take a picture's fourth channel for "how much is there"
    # Written as a new picture with four channels: saving the model's own picture leaves the fourth out.
    out = bpy.data.images.new(f"hammer_{kind}", TEXTURE_SIZE, TEXTURE_SIZE, alpha=True)
    out.pixels.foreach_set(pixels.reshape(-1))
    out.filepath_raw = str(OUT / f"hammer_{kind}.png")
    out.file_format = "PNG"
    out.save()
    print(f"EXPORT hammer_{kind}.png: {image.size[0]} x {image.size[1]}")
