"""Strip the floor the mesher copied from the photo: loose flat pieces lying at the base of a finished asset.

    blender -b --factory-startup -P tools/clean_floor.py -- <in.glb> <out.glb>

Every loose part whose top is within 4% of the asset's height of the ground (z = 0) is deleted; everything that
rises off the floor stays. Blender is Z-up after glTF import.
"""
import sys
import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
height = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o in meshes)
removed = 0
for ob in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    top = max((ob.matrix_world @ v.co).z for v in ob.data.vertices)
    if top < height * 0.04:
        bpy.data.objects.remove(ob, do_unlink=True)
        removed += 1
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True)
print("CLEAN removed", removed, "floor pieces", flush=True)
