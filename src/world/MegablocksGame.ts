import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlayerController } from './PlayerController';
import { createPlaceholderBlocks } from './placeholderBlocks';

const MODEL_URL = '/assets/models/megablocks.glb';
const HIDDEN_MODEL_OBJECTS = new Set(['Cube_Material_0.001']);
const ORBIT_TARGET_OBJECT = 'MOVABLE_Ground_Floor';
const MAX_ORBIT_DISTANCE = 38;
// Blender X/Y map to Three.js X/Z after GLB's Y-up conversion.
// Each value is the maximum random distance in either direction.
const STACK_RANDOM_X_RANGE = 1.4;
const STACK_RANDOM_BLENDER_Y_RANGE = 1.4;
// Blender Z rotation maps to Three.js Y rotation after export.
const STACK_RANDOM_Z_ROTATION_DEGREES = 12;
const TOTAL_STACK_BLOCKS = 25;
const CAMERA_TOP_PADDING = 3;
const CAMERA_VIEW_TOP_LIMIT = 0.72;
const LANDING_SHAKE_DURATION = 0.28;
const LANDING_SHAKE_STRENGTH = 0.16;
const STACK_DROP_HEIGHT = 7;
const STACK_DROP_SECONDS = 0.5;
const FALLBACK_STACK_ANCHOR = new THREE.Vector3(0, 0, 0);
const FIRST_FLOOR_PARTS = [
  {
    label: 'Lower first floor',
    url: '/assets/models/lowerFirst.glb'
  },
  {
    label: 'Upper first floor',
    url: '/assets/models/firstUpper.glb'
  }
] as const;
const ROOF_PART = {
  label: 'Upper with roof',
  url: '/assets/models/upperWithRoof.glb'
} as const;

type StackPart = {
  baseRotationY: number;
  baseX: number;
  baseZ: number;
  finalY: number;
  label: string;
  object: THREE.Object3D;
  topY: number;
};

type StackAnchor = {
  center: THREE.Vector3;
  halfWidthX: number;
  halfWidthZ: number;
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
    halfWidthX: STACK_RANDOM_X_RANGE,
    halfWidthZ: STACK_RANDOM_BLENDER_Y_RANGE,
    topY: 0
  };
  private frameCount = 0;
  private fpsTimer = 0;
  private stackIndex = 0;
  private cameraTargetMinY = 0;
  private currentStackTopY = 0;
  private landingShakeRemaining = 0;

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
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 1.2, 0);
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.maxDistance = MAX_ORBIT_DISTANCE;

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
      this.focusControlsOnObject(world, ORBIT_TARGET_OBJECT);
      this.stackAnchor = this.measureStackAnchor(world, ORBIT_TARGET_OBJECT);
      this.currentStackTopY = this.stackAnchor.topY;
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

    const templates = await Promise.all(
      [...FIRST_FLOOR_PARTS, ROOF_PART].map(async (part) => ({
        definition: part,
        object: (await loader.loadAsync(getAssetUrl(part.url))).scene
      }))
    );
    let nextTopY = this.stackAnchor.topY;

    for (let index = 0; index < TOTAL_STACK_BLOCKS; index += 1) {
      const isLastBlock = index === TOTAL_STACK_BLOCKS - 1;
      const template = isLastBlock
        ? templates[templates.length - 1]
        : templates[index % FIRST_FLOOR_PARTS.length];
      const object = template.object.clone(true);
      const label = `Block ${index + 1} (${template.definition.label})`;

      object.name = label;
      this.prepareSceneObject(object);
      this.scene.add(object);
      object.visible = false;

      const finalY = this.placePartOnStack(object, nextTopY);
      const finalBox = new THREE.Box3().setFromObject(object);
      nextTopY = finalBox.max.y;

      this.stackParts.push({
        baseRotationY: object.rotation.y,
        baseX: object.position.x,
        baseZ: object.position.z,
        finalY,
        label,
        object,
        topY: finalBox.max.y
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

  private focusControlsOnObject(root: THREE.Object3D, objectName: string): void {
    const targetObject = root.getObjectByName(objectName);

    if (!targetObject) {
      console.warn(`Orbit target "${objectName}" was not found in ${MODEL_URL}.`);
      return;
    }

    targetObject.updateWorldMatrix(true, true);
    const targetBox = new THREE.Box3().setFromObject(targetObject);

    if (targetBox.isEmpty()) {
      targetObject.getWorldPosition(this.controls.target);
    } else {
      targetBox.getCenter(this.controls.target);
    }

    this.cameraTargetMinY = this.controls.target.y;
    this.controls.update();
  }

  private measureStackAnchor(world: THREE.Object3D, anchorName: string): StackAnchor {
    const anchorObject = world.getObjectByName(anchorName);

    if (anchorObject) {
      anchorObject.updateWorldMatrix(true, true);
      const anchorBox = new THREE.Box3().setFromObject(anchorObject);

      if (!anchorBox.isEmpty()) {
        const size = anchorBox.getSize(new THREE.Vector3());

        return {
          center: anchorBox.getCenter(new THREE.Vector3()),
          halfWidthX: size.x / 2,
          halfWidthZ: size.z / 2,
          topY: anchorBox.max.y
        };
      }
    }

    console.warn(`Stack anchor "${anchorName}" was not found. Using the measured world bounds.`);
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
    const size = box.getSize(new THREE.Vector3());

    return {
      center,
      halfWidthX: size.x / 2,
      halfWidthZ: size.z / 2,
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
    const xRange = Math.min(STACK_RANDOM_X_RANGE, this.stackAnchor.halfWidthX);
    const zRange = Math.min(STACK_RANDOM_BLENDER_Y_RANGE, this.stackAnchor.halfWidthZ);

    part.object.visible = true;
    part.object.position.x = part.baseX + THREE.MathUtils.randFloatSpread(xRange * 2);
    part.object.position.z = part.baseZ + THREE.MathUtils.randFloatSpread(zRange * 2);
    part.object.position.y = part.finalY + STACK_DROP_HEIGHT;
    part.object.rotation.y =
      part.baseRotationY +
      THREE.MathUtils.degToRad(THREE.MathUtils.randFloatSpread(STACK_RANDOM_Z_ROTATION_DEGREES * 2));
    this.currentStackTopY = Math.max(this.currentStackTopY, part.topY);
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
    // Gravity-like acceleration: slow at release and fast immediately before impact.
    const eased = Math.pow(progress, 2.35);
    drop.part.object.position.y = THREE.MathUtils.lerp(drop.startY, drop.part.finalY, eased);

    if (progress >= 1) {
      drop.part.object.position.y = drop.part.finalY;
      this.activeDrop = null;
      this.landingShakeRemaining = LANDING_SHAKE_DURATION;
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
    this.updateCameraHeight(delta);
    this.updateFps(delta);
    const shakeOffset = this.getLandingShakeOffset(delta);
    this.camera.position.add(shakeOffset);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(shakeOffset);
  };

  private getLandingShakeOffset(delta: number): THREE.Vector3 {
    if (this.landingShakeRemaining <= 0) {
      return new THREE.Vector3();
    }

    this.landingShakeRemaining = Math.max(this.landingShakeRemaining - delta, 0);
    const strength =
      LANDING_SHAKE_STRENGTH * (this.landingShakeRemaining / LANDING_SHAKE_DURATION);

    return new THREE.Vector3(
      THREE.MathUtils.randFloatSpread(strength * 2),
      THREE.MathUtils.randFloatSpread(strength),
      THREE.MathUtils.randFloatSpread(strength * 0.7)
    );
  }

  private updateCameraHeight(delta: number): void {
    const maxTargetY = Math.max(this.cameraTargetMinY, this.currentStackTopY + CAMERA_TOP_PADDING);

    // Keep manual right-mouse panning between the original view and the stack top.
    const clampedTargetY = THREE.MathUtils.clamp(
      this.controls.target.y,
      this.cameraTargetMinY,
      maxTargetY
    );
    this.shiftCameraVertically(clampedTargetY - this.controls.target.y);

    const stackTop = new THREE.Vector3(
      this.stackAnchor.center.x,
      this.currentStackTopY,
      this.stackAnchor.center.z
    );
    this.camera.updateMatrixWorld();
    const projectedTop = stackTop.project(this.camera);

    if (projectedTop.y > CAMERA_VIEW_TOP_LIMIT && this.controls.target.y < maxTargetY) {
      const overflow = projectedTop.y - CAMERA_VIEW_TOP_LIMIT;
      const desiredShift = overflow * this.camera.position.distanceTo(this.controls.target) * 0.45;
      const smoothShift = desiredShift * Math.min(delta * 6, 1);
      const availableShift = maxTargetY - this.controls.target.y;
      this.shiftCameraVertically(Math.min(smoothShift, availableShift));
    }

    this.controls.update();
  }

  private shiftCameraVertically(amount: number): void {
    if (amount === 0) {
      return;
    }

    this.camera.position.y += amount;
    this.controls.target.y += amount;
  }

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
