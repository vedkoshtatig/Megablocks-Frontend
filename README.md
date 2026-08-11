# Megablocks 3D

Three.js game shell for the Megablocks scene in `megablocks.blend`.

## Run locally

```bash
npm install
npm run export:blend
npm run dev
```

Open the Vite URL shown in the terminal. The game tries to load:

```text
public/assets/models/megablocks.glb
```

If that file is missing or fails to load, it falls back to placeholder blocks so the project still runs.

## Project layout

```text
src/main.ts                         app entry
src/world/MegablocksGame.ts         renderer, camera, lights, model loading, loop
src/world/PlayerController.ts       starter keyboard movement
src/world/placeholderBlocks.ts      fallback scene
scripts/export-blend-to-glb.py      Blender to GLB export script
public/assets/models/               exported game models
public/assets/textures/             texture assets
```

## Suggested game roadmap

1. Keep the Blender scene organized with useful object names, origins, and collections.
2. Export to GLB with `npm run export:blend` whenever the scene changes.
3. Mark gameplay objects in Blender using names like `Block_Red_01`, `Spawn_Player`, `Goal_01`, or `Collider_Wall_01`.
4. In Three.js, parse those names after loading the GLB and wire them to systems: spawning, collision, scoring, triggers, and cameras.
5. Add physics when movement and collision need to feel solid. `rapier3d` is a good next step for a block-based game.
6. Split large scenes into separate GLBs if loading becomes slow: level, characters, props, UI previews.

## Blender export notes

- Apply scale and rotation before export for objects that will collide or move.
- Use meters as units and keep the player roughly 1 to 2 units tall.
- Prefer simple collider meshes named `Collider_*` instead of using detailed visual geometry for collision.
- Keep material names descriptive; they can become gameplay tags later.
