"""Render a raw mesh from six sides, to catch the open or hollow sides the mesher leaves (README: render every raw mesh
from all sides before finishing). Backface culling is on, so a missing side shows as a see-through hole.

    blender -b -P tools/rawsides.py -- assets/pilot/<asset>/raw_<img>.glb [out.png]

Views are named in the mesh's own glTF frame (up +y; +z faces the camera the concept image was painted from).
Writes <glb without extension>_sides.png: one row of six views, labelled.
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
src = Path(args[0]).resolve()
out = Path(args[1]).resolve() if len(args) > 1 else src.with_name(src.stem + "_sides.png")
S = 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
centre, radius = (lo + hi) / 2, (hi - lo).length / 2
tris = sum(len(o.data.polygons) for o in meshes)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_backface_culling = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = scene.render.resolution_y = S
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.75, 0.2, 0.6)  # magenta behind: holes stand out
scene.display_settings.display_device = "sRGB"
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = radius * 2.1
scene.collection.objects.link(cam)
scene.camera = cam

# glTF frame -> Blender frame: (x, y, z) -> (x, -z, y)
views = [("front +z", (0, -1, 0)), ("back -z", (0, 1, 0)), ("right +x", (1, 0, 0)), ("left -x", (-1, 0, 0)),
         ("top +y", (0, 0, 1)), ("under -y", (0, 0, -1))]
tiles = []
for name, d in views:
    d = Vector(d)
    cam.location = centre + d * radius * 3
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0)) * (1 if d.z > 0 else -1)
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler() if abs(d.z) < 0.9 else (
        (0, 0, 0) if d.z > 0 else (math.pi, 0, 0))
    f = out.with_name(f"_side_{len(tiles)}.png")
    scene.render.filepath = str(f)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(f))
    px = np.array(img.pixels[:], dtype=np.float32).reshape(S, S, 4)[::-1]
    tiles.append(px)
    bpy.data.images.remove(img)
    f.unlink()
row = np.concatenate(tiles, axis=1)
im = bpy.data.images.new("sheet", row.shape[1], S, alpha=True)
im.pixels = row[::-1].ravel()
im.filepath_raw = str(out)
im.file_format = "PNG"
im.save()
print("SIDES", out.name, "tris", tris, "views:", ", ".join(v[0] for v in views))
