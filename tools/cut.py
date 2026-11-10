"""Keep only the front slice of a raw mesh, capped: for a concept painted face-on (a lid seen from above) that the
mesher extruded into a whole drum behind it.

    blender -b -P tools/cut.py -- assets/pilot/<asset>/raw_<img>.glb <depth>

Keeps everything within <depth> (a fraction of the mesh's width) of its front (+z in glTF, the side facing the concept's
camera), fills the cut, and writes raw_<img>_cut.glb next to it (point the finish's "raw" at that).
"""
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
src, depth = Path(args[0]).resolve(), float(args[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    me = ob.data
    me.transform(ob.matrix_world)
    ob.matrix_world.identity()
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]          # glTF +z is Blender -y
    width = max(xs) - min(xs)
    front = min(ys)
    cut = front + depth * width
    bm = bmesh.new()
    bm.from_mesh(me)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, cut, 0)), plane_no=Vector((0, 1, 0)), clear_outer=True)
    edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bm.to_mesh(me)
    bm.free()
    print("CUT", ob.name, f"kept {depth:.2f} of the width from the front: {len(me.polygons)} faces")
out = src.with_name(src.stem + "_cut.glb")
bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_yup=True)
print("WROTE", out.name)
