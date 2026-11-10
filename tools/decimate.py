"""Cut a finished model (Blender finish, baked maps) down to its triangle budget, keeping its UV seams.

gltfpack can't simplify across UV seams (the Blender finish's smart-project UVs have many), so it stops around 6k
triangles; with -sa it does, but drags colour across the seams (a yellow hood came out camo). Blender's collapse
decimate keeps the seams, so the finish can bake at a size where its low-poly hugs the raw mesh (8k) and come down
here. Writes <asset>_clean.glb, which tools/props.mjs prefers.

    blender -b -P tools/decimate.py -- assets/pilot/<asset> <triangles>
"""
import sys
from pathlib import Path

import bpy

folder, budget = sys.argv[sys.argv.index("--") + 1:][:2]
folder, budget = Path(folder).resolve(), int(budget)
name = folder.name
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(folder / f"{name}.glb"))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
before = sum(len(o.data.polygons) for o in meshes)
for o in meshes:
    m = o.modifiers.new("decimate", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = min(1.0, budget / before)
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)
after = sum(len(o.data.polygons) for o in meshes)
bpy.ops.export_scene.gltf(filepath=str(folder / f"{name}_clean.glb"), export_format="GLB", export_yup=True)
print("DECIMATED", name, before, "->", after)
