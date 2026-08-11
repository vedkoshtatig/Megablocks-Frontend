import * as THREE from 'three';

const MOVE_SPEED = 5.2;

export class PlayerController {
  readonly object = new THREE.Group();
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();

  constructor() {
    this.object.name = 'Player';
    this.object.position.set(0, 0.55, 0);
    this.object.add(this.createMesh());

    window.addEventListener('keydown', (event) => this.keys.add(event.code));
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
  }

  update(delta: number): void {
    const input = new THREE.Vector3(
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
        Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      0,
      Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) -
        Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'))
    );

    if (input.lengthSq() > 0) {
      input.normalize();
      this.velocity.copy(input.multiplyScalar(MOVE_SPEED));
      this.object.lookAt(this.object.position.x + input.x, this.object.position.y, this.object.position.z + input.z);
    } else {
      this.velocity.multiplyScalar(0.82);
    }

    this.object.position.addScaledVector(this.velocity, delta);
  }

  private createMesh(): THREE.Object3D {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffd84d, roughness: 0.55 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x2468d8, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), bodyMaterial);
    head.position.y = 0.7;
    head.castShadow = true;

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.04), accentMaterial);
    visor.position.set(0, 0.76, -0.25);

    const playerMesh = new THREE.Group();
    playerMesh.add(body, head, visor);
    return playerMesh;
  }
}
