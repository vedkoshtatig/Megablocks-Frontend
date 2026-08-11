import * as THREE from 'three';

const COLORS = [0xf24949, 0x3f7ee8, 0xf2c94c, 0x42b883, 0xffffff];

export function createPlaceholderBlocks(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Placeholder Megablocks';

  for (let x = -4; x <= 4; x += 2) {
    for (let z = -4; z <= 4; z += 2) {
      const height = 0.7 + ((x + z + 12) % 4) * 0.35;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, height, 1.25),
        new THREE.MeshStandardMaterial({
          color: COLORS[Math.abs(x + z) % COLORS.length],
          roughness: 0.6,
          metalness: 0.02
        })
      );

      block.position.set(x, height / 2, z);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
    }
  }

  return group;
}
