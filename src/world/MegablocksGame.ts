import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlayerController } from './PlayerController';
import { createPlaceholderBlocks } from './placeholderBlocks';

const MODEL_URL = '/assets/models/megablocks.glb';
const HIDDEN_MODEL_OBJECTS = new Set(['Cube_Material_0.001']);
const STACK_DROP_HEIGHT = 7;
const STACK_DROP_SECONDS = 1.05;
const FALLBACK_STACK_ANCHOR = new THREE.Vector3(0, 0, 0);
const STACK_PARTS = [
  {
    label: 'Ground floor',
    url: '/assets/models/ground.glb'
  },
  {
    label: 'Lower first floor',
    url: '/assets/models/lowerFirst.glb'
  },
  {
    label: 'Upper first floor',
    url: '/assets/models/firstUpper.glb'
  },
  {
    label: 'Upper with roof',
    url: '/assets/models/upperWithRoof.glb'
  }
] as const;

type StackPart = {
  finalY: number;
  label: string;
  object: THREE.Object3D;
};

type StackAnchor = {
  center: THREE.Vector3;
  topY: number;
};

type ActiveDrop = {
  elapsed: number;
  part: StackPart;
  startY: number;
};

function getModelUrl(): string {
  return `${MODEL_URL}?updated=${Date.now()}`;
}

function getAssetUrl(url: string): string {
  return `${url}?updated=${Date.now()}`;
}

export class MegablocksGame {
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly player: PlayerController;
  private readonly statusElement = document.querySelector<HTMLElement>('#status');
  private readonly fpsElement = document.querySelector<HTMLElement>('#fps');
  private readonly stackButton = document.querySelector<HTMLButtonElement>('#stack-next');
  private readonly stackParts: StackPart[] = [];
  private activeDrop: ActiveDrop | null = null;
  private stackAnchor: StackAnchor = {
    center: FALLBACK_STACK_ANCHOR.clone(),
    topY: 0
  };
  private frameCount = 0;
  private fpsTimer = 0;
  private stackIndex = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(9, 8, 11);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1.2, 0);
    this.controls.maxPolarAngle = Math.PI * 0.48;

    this.player = new PlayerController();

    this.configureScene();
    this.stackButton?.addEventListener('click', this.dropNextFloor);
    window.addEventListener('resize', this.resize);
  }

  async start(): Promise<void> {
    await this.loadWorld();
    this.renderer.setAnimationLoop(this.tick);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x8fc4ff);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x324050, 1.2);
    this.scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(8, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    this.scene.add(sun);

    this.scene.add(this.player.object);
  }

  private async loadWorld(): Promise<void> {
    const loader = new GLTFLoader();

    try {
      const gltf = await loader.loadAsync(getModelUrl());
      const world = gltf.scene;

      this.prepareSceneObject(world);

      this.useImportedCamera(gltf.cameras);
      this.scene.add(world);
      this.stackAnchor = this.measureStackAnchor(world);
      await this.loadStackAssets(loader);
      this.updateStackButton();
      this.setStatus(this.stackParts.length ? 'Ready to stack floors' : 'Scene loaded');
    } catch (error) {
      console.warn(`Could not load ${MODEL_URL}. Using placeholder blocks.`, error);
      this.scene.add(createPlaceholderBlocks());
      this.setStatus('Placeholder scene');
    }
  }

  private async loadStackAssets(loader: GLTFLoader): Promise<void> {
    this.stackParts.length = 0;
    this.stackIndex = 0;
    this.activeDrop = null;

    let nextTopY = this.stackAnchor.topY;

    for (const part of STACK_PARTS) {
      const gltf = await loader.loadAsync(getAssetUrl(part.url));
      const object = gltf.scene;

      object.name = part.label;
      this.prepareSceneObject(object);
      this.scene.add(object);
      object.visible = false;

      const finalY = this.placePartOnStack(object, nextTopY);
      const finalBox = new THREE.Box3().setFromObject(object);
      nextTopY = finalBox.max.y;

      this.stackParts.push({
        finalY,
        label: part.label,
        object
      });
    }
  }

  private prepareSceneObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (HIDDEN_MODEL_OBJECTS.has(child.name)) {
        child.visible = false;
        return;
      }

      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private measureStackAnchor(world: THREE.Object3D): StackAnchor {
    const preciseBox = new THREE.Box3();
    const broadBox = new THREE.Box3().setFromObject(world);
    let hasPreciseBox = false;

    world.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.visible) {
        return;
      }

      const childBox = new THREE.Box3().setFromObject(child);
      const size = childBox.getSize(new THREE.Vector3());
      const center = childBox.getCenter(new THREE.Vector3());

      if (size.x > 18 || size.z > 18 || size.y > 8 || size.y < 0.08) {
        return;
      }

      if (Math.abs(center.x) > 12 || Math.abs(center.z) > 30) {
        return;
      }

      preciseBox.union(childBox);
      hasPreciseBox = true;
    });

    const box = hasPreciseBox ? preciseBox : broadBox;
    const center = box.getCenter(new THREE.Vector3());

    return {
      center,
      topY: box.max.y
    };
  }

  private placePartOnStack(object: THREE.Object3D, targetBottomY: number): number {
    object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());

    object.position.x += this.stackAnchor.center.x - center.x;
    object.position.z += this.stackAnchor.center.z - center.z;
    object.position.y += targetBottomY - box.min.y;
    object.updateMatrixWorld(true);

    return object.position.y;
  }

  private dropNextFloor = (): void => {
    if (this.activeDrop || this.stackIndex >= this.stackParts.length) {
      return;
    }

    const part = this.stackParts[this.stackIndex];
    part.object.visible = true;
    part.object.position.y = part.finalY + STACK_DROP_HEIGHT;
    this.activeDrop = {
      elapsed: 0,
      part,
      startY: part.object.position.y
    };
    this.stackIndex += 1;
    this.updateStackButton();
    this.setStatus(`Dropping ${part.label}`);
  };

  private updateStackButton(): void {
    if (!this.stackButton) {
      return;
    }

    const nextPart = this.stackParts[this.stackIndex];
    this.stackButton.disabled = Boolean(this.activeDrop) || !nextPart;
    this.stackButton.textContent = nextPart ? `Drop ${nextPart.label}` : 'Stack complete';
  }

  private updateStackAnimation(delta: number): void {
    if (!this.activeDrop) {
      return;
    }

    const drop = this.activeDrop;
    drop.elapsed += delta;

    const progress = Math.min(drop.elapsed / STACK_DROP_SECONDS, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    drop.part.object.position.y = THREE.MathUtils.lerp(drop.startY, drop.part.finalY, eased);

    if (progress >= 1) {
      drop.part.object.position.y = drop.part.finalY;
      this.activeDrop = null;
      this.updateStackButton();
      this.setStatus(this.stackIndex >= this.stackParts.length ? 'Building stacked' : 'Ready for next floor');
    }
  }

  private useImportedCamera(cameras: THREE.Camera[]): void {
    const importedCamera = cameras.find((camera): camera is THREE.PerspectiveCamera => {
      return camera instanceof THREE.PerspectiveCamera;
    });

    if (!importedCamera) {
      return;
    }

    this.camera = importedCamera;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.controls.object = this.camera;
    this.controls.target.set(0, 1.2, 0);
    this.controls.update();
  }

  private tick = (): void => {
    const delta = this.clock.getDelta();

    this.player.update(delta);
    this.updateStackAnimation(delta);
    this.controls.update();
    this.updateFps(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private updateFps(delta: number): void {
    this.frameCount += 1;
    this.fpsTimer += delta;

    if (this.fpsTimer >= 0.5 && this.fpsElement) {
      this.fpsElement.textContent = `${Math.round(this.frameCount / this.fpsTimer)} fps`;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
  }

  private setStatus(status: string): void {
    if (this.statusElement) {
      this.statusElement.textContent = status;
    }
  }

  private resize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
