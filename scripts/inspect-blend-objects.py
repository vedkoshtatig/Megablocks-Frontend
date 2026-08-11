import bpy


rows = []

for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue

    dims = tuple(float(value) for value in obj.dimensions)
    longest = max(dims)
    shortest = max(min(dims), 0.0001)
    materials = [material.name for material in obj.data.materials if material]
    colors = [
        tuple(round(channel, 3) for channel in material.diffuse_color)
        for material in obj.data.materials
        if material
    ]

    if longest > 30 or longest / shortest > 80:
        rows.append(
            (
                longest / shortest,
                longest,
                obj.name,
                tuple(round(value, 3) for value in obj.location),
                tuple(round(value, 3) for value in dims),
                materials,
                colors,
            )
        )

for row in sorted(rows, reverse=True)[:80]:
    print(row)
