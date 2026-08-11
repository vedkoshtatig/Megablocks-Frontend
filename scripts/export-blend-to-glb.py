import sys
from pathlib import Path

import bpy


def get_output_path() -> Path:
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        if args:
            return Path(args[0]).resolve()

    return Path("public/assets/models/megablocks.glb").resolve()


output_path = get_output_path()
output_path.parent.mkdir(parents=True, exist_ok=True)

for obj in bpy.context.scene.objects:
    obj.select_set(obj.type in {"MESH", "ARMATURE", "EMPTY", "LIGHT", "CAMERA"})

bpy.ops.export_scene.gltf(
    filepath=str(output_path),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_cameras=True,
    export_lights=True,
    export_animations=True,
)

print(f"Exported {output_path}")
