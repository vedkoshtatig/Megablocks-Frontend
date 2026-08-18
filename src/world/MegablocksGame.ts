import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MegaBlockApiError } from '../services/megaBlockApi';
import { appEnv } from '../config/env';
import { getMegaBlockDataMode } from '../services/megaBlockClient';
import type {
  DropMegaBlockResponse,
  MegaBlockClient,
  MegaBlockDifficulty,
  MegaBlockSettings,
  PlaceMegaBlockBetResponse,
  UnfinishedMegaBlockBetResponse
} from '../services/megaBlockTypes';
import { PlayerController } from './PlayerController';
import { createPlaceholderBlocks } from './placeholderBlocks';

const MODEL_URL = '/assets/models/megablocks.glb';
const HIDDEN_MODEL_OBJECTS = new Set<string>();
const ENVIRONMENT_MODEL_OBJECTS = new Set(['cube_material_0.001', 'skybox']);
const ENVIRONMENT_VERTICAL_PARALLAX = 0.5;
const ENVIRONMENT_Y_ROTATION_DEGREES_PER_SECOND = 0.35;
const ORBIT_TARGET_OBJECT = 'MOVABLE_Ground_Floor';
const MAX_ORBIT_DISTANCE = 40;
const MIN_ORBIT_POLAR_ANGLE = Math.PI * 0.45;

// Blender X/Y map to Three.js X/Z after GLB's Y-up conversion.
// Each value is the maximum random distance in either direction.
const STACK_RANDOM_X_RANGE = 1.4;
const STACK_RANDOM_BLENDER_Y_RANGE = 1.4;
// Blender Z rotation maps to Three.js Y rotation after export.
const STACK_RANDOM_Z_ROTATION_DEGREES = 12;
const TOTAL_STACK_BLOCKS = 24;
const CAMERA_TOP_PADDING = 3;
const CAMERA_BASE_STACK_VIEW_Y = 0.4;
const CAMERA_TOP_CLEARANCE_FLOORS = 1;
const SLIDER_ORBIT_DEGREES_PER_HEIGHT_UNIT = 9;
const LANDING_SHAKE_DURATION = 0.28;
const LANDING_SHAKE_STRENGTH = 0.2;
const LANDING_SCREEN_EFFECT_DURATION = 0.34;
const LANDING_SCREEN_SHAKE_PIXELS = 9;
const LANDING_SCREEN_BLUR_PIXELS = 3.5;
const LANDING_SCREEN_SCALE = 1.008;
const DUST_PARTICLE_COUNT = 104;
const DUST_DURATION_RANGE = [0.7, 1.18] as const;
const DUST_GRAVITY = 1.85;
const DUST_DRAG = 1.4;
const DUST_EXPANSION = 2.35;
const COLLAPSE_GRAVITY = 18;
const BAD_LANDING_TILT_DEGREES = 14;
const COLLAPSE_CAMERA_FOLLOW_SPEED = 5;
const CAMERA_BASE_RETURN_SPEED = 2.8;
const DESTROY_BELOW_GROUND_DISTANCE = 4;
const STACK_DROP_HEIGHT = 7;
const STACK_DROP_SECONDS = 0.5;
const STACK_VERTICAL_OVERLAP = 0.05;
const STACK_CONTACT_PROGRESS = 0.82;
const STACK_SWING_DEGREES = 4.5;
const STACK_IMPACT_COMPRESSION = 0.045;
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
  baseRotationX: number;
  baseRotationY: number;
  baseRotationZ: number;
  baseScale: THREE.Vector3;
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
  baseRotationX: number;
  baseRotationZ: number;
  baseScale: THREE.Vector3;
  elapsed: number;
  hasImpacted: boolean;
  onSettled: () => void;
  part: StackPart;
  shouldCollapse: boolean;
  startY: number;
  swingDirection: number;
  swingPhase: number;
};

type CollapsingBlock = {
  angularVelocity: THREE.Vector3;
  delay: number;
  object: THREE.Object3D;
  startY: number;
  velocity: THREE.Vector3;
};

type EnvironmentObject = {
  baseRotationY: number;
  baseY: number;
  object: THREE.Object3D;
};

type DustParticle = {
  age: number;
  driftPhase: number;
  driftSpeed: number;
  driftStrength: number;
  initialOpacity: number;
  initialScale: number;
  lifetime: number;
  sprite: THREE.Sprite;
  spin: number;
  velocity: THREE.Vector3;
};

type GameStatus = 'idle' | 'placing' | 'active' | 'dropping' | 'cashingOut' | 'won' | 'lost' | 'error';

type MegaBlockUiState = {
  balance: number | null;
  betAmount: number;
  betId: string | null;
  clientSeed: string;
  completedFloorCount: number;
  crashFloor: number | null;
  currency: string;
  difficulty: MegaBlockDifficulty;
  error: string | null;
  maxFloor: number;
  nonce: number | null;
  payoutMultiplier: number;
  serverSeedHash: string | null;
  status: GameStatus;
  winningAmount: number;
};

const initialMegaBlockState: MegaBlockUiState = {
  balance: null,
  betAmount: 0,
  betId: null,
  clientSeed: '',
  completedFloorCount: 0,
  crashFloor: null,
  currency: 'SC',
  difficulty: 'easy',
  error: null,
  maxFloor: 24,
  nonce: null,
  payoutMultiplier: 1,
  serverSeedHash: null,
  status: 'idle',
  winningAmount: 0
};

function getModelUrl(): string {
  return `${MODEL_URL}?updated=${Date.now()}`;
}

function getAssetUrl(url: string): string {
  return `${url}?updated=${Date.now()}`;
}

function isEnvironmentObjectName(name: string): boolean {
  return ENVIRONMENT_MODEL_OBJECTS.has(name.trim().toLowerCase());
}

function isEnvironmentObject(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (isEnvironmentObjectName(current.name)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function createDustTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(226, 213, 184, 0.72)');
    gradient.addColorStop(0.45, 'rgba(199, 178, 137, 0.34)');
    gradient.addColorStop(1, 'rgba(199, 178, 137, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
  private readonly stackButton = document.querySelector<HTMLButtonElement>('#primary-action');
  private readonly cashOutButton = document.querySelector<HTMLButtonElement>('#cash-out');
  private readonly resetButton = document.querySelector<HTMLButtonElement>('#reset-round');
  private readonly cameraHeightElement = document.querySelector<HTMLInputElement>('#camera-height');
  private readonly amountElement = document.querySelector<HTMLInputElement>('#bet-amount');
  private readonly difficultyElement = document.querySelector<HTMLSelectElement>('#difficulty');
  private readonly clientSeedElement = document.querySelector<HTMLInputElement>('#client-seed');
  private readonly balanceElement = document.querySelector<HTMLElement>('#balance');
  private readonly roundDetailsElement = document.querySelector<HTMLElement>('#round-details');
  private readonly dataModeElement = document.querySelector<HTMLElement>('#data-mode');
  private readonly stackParts: StackPart[] = [];
  private readonly collapsingBlocks: CollapsingBlock[] = [];
  private readonly environmentObjects: EnvironmentObject[] = [];
  private readonly dustParticles: DustParticle[] = [];
  private readonly dustTexture = createDustTexture();
 
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
  private baseStackTopProjectedY: number | null = null;
  private currentStackTopY = 0;
  private collapseCameraStartTargetY = 0;
  private landingShakeRemaining = 0;
  private landingScreenEffectRemaining = 0;
  private awaitingRoundRestart = false;
  private returningCameraToBase = false;
  private resetInProgress = false;
  private collapseSettled: (() => void) | null = null;
  private settings: MegaBlockSettings | null = null;
  private state: MegaBlockUiState = { ...initialMegaBlockState };
  private unfinishedGatePending = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly client: MegaBlockClient
  ) {
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
    this.controls.minPolarAngle = MIN_ORBIT_POLAR_ANGLE;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.maxDistance = MAX_ORBIT_DISTANCE;

    this.player = new PlayerController();

    this.configureScene();
    this.stackButton?.addEventListener('click', this.handlePrimaryAction);
    this.cashOutButton?.addEventListener('click', this.cashOut);
    this.resetButton?.addEventListener('click', this.resetRound);
    this.cameraHeightElement?.addEventListener('input', this.moveCameraFromSlider);
    this.amountElement?.addEventListener('input', this.handleAmountInput);
    this.clientSeedElement?.addEventListener('input', this.updateControls);
    window.addEventListener('resize', this.resize);
    this.updateControls();
  }

  async start(): Promise<void> {
    this.renderer.setAnimationLoop(this.tick);

    await Promise.all([
      this.loadWorld(),
      this.initializeGameSession()
    ]);

    // Session restoration can finish before the large scene assets load.
    // Reapply the visual stack once both sides are ready.
    if (this.state.betId && this.state.completedFloorCount > 0) {
      this.restoreCompletedStack(this.state.completedFloorCount);
    }
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
      this.frameBaseStackAtViewPosition();
      this.updateControls();
      this.setStatus(this.stackParts.length ? 'Ready to stack floors' : 'Scene loaded');
    } catch (error) {
      console.warn(`Could not load ${MODEL_URL}. Using placeholder blocks.`, error);
      this.scene.add(createPlaceholderBlocks());
      this.setStatus('Placeholder scene');
    }
  }

  private async initializeGameSession(): Promise<void> {
    this.setDataMode();

    try {
      const launchRequest = this.getLaunchRequest();
      const launch = await this.client.launch(launchRequest);

      this.state.currency = launch.currency;
      this.removeCasinoSessionFromUrl();

      this.settings = await this.client.getSettings();
      this.applySettings(this.settings);

      const hasUnfinishedBet = await this.syncUnfinishedBet({
        resetStackWhenNone: true,
        preserveResolvedWhenNone: false
      });

      if (!hasUnfinishedBet) {
        this.setStatus('Ready to place bet');
      }
    } catch (error) {
      this.state.status = 'error';
      this.state.error = getDisplayError(error);
      this.setStatus(this.state.error);
    } finally {
      this.updateControls();
    }
  }

  private getLaunchRequest() {
    const params = new URLSearchParams(window.location.search);
    const casinoSessionId = params.get('casinoSessionId');
    const gameKey = params.get('gameKey') ?? 'mega-block';
    const isMockMode = getMegaBlockDataMode() === 'mock';
    const effectiveSessionId = casinoSessionId ?? appEnv.a1StubSessionId;

    if (gameKey !== 'mega-block') {
      throw new Error('MegaBlock must launch with gameKey=mega-block.');
    }

    if (!effectiveSessionId && !isMockMode) {
      throw new Error('Launch URL is missing casinoSessionId and no development stub session is configured.');
    }

    return {
      casinoSessionId: effectiveSessionId ?? 'mock-casino-session',
      device: window.innerWidth <= 768 ? 'MOBILE' as const : 'DESKTOP' as const,
      gameKey: 'mega-block' as const,
      lang: document.documentElement.lang || 'en'
    };
  }

  private removeCasinoSessionFromUrl(): void {
    const url = new URL(window.location.href);

    if (!url.searchParams.has('casinoSessionId')) {
      return;
    }

    url.searchParams.delete('casinoSessionId');
    window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  private applySettings(settings: MegaBlockSettings): void {
    this.state.difficulty = settings.defaultDifficulty;
    this.state.maxFloor = settings.difficulties[settings.defaultDifficulty].maxFloor;

    if (this.amountElement) {
      this.amountElement.min = String(settings.minBet);
      this.amountElement.max = String(settings.maxBet);
      this.amountElement.value = String(Math.max(settings.minBet, Number(this.amountElement.value) || 1));
    }

    if (this.difficultyElement) {
      this.difficultyElement.value = settings.defaultDifficulty;
    }
  }

  private restoreUnfinishedBet(response: UnfinishedMegaBlockBetResponse): void {
    const unfinishedBet = response.unfinishedBet;

    if (!response.hasUnfinishedBet || !unfinishedBet) {
      this.restoreCompletedStack(0);
      return;
    }

    this.state = {
      ...this.state,
      betAmount: Number(unfinishedBet.betAmount),
      betId: unfinishedBet.id,
      clientSeed: unfinishedBet.clientSeed,
      completedFloorCount: unfinishedBet.currentFloorCount,
      crashFloor: null,
      currency: unfinishedBet.currency,
      difficulty: unfinishedBet.gameDifficulty,
      error: null,
      maxFloor: unfinishedBet.maxFloor,
      nonce: unfinishedBet.nonce,
      payoutMultiplier: Number(unfinishedBet.payoutMultiplier),
      serverSeedHash: unfinishedBet.serverSeedHash,
      status: 'active',
      winningAmount: Number(unfinishedBet.winningAmount)
    };

    if (this.amountElement) {
      this.amountElement.value = String(Number(unfinishedBet.betAmount));
    }
    if (this.difficultyElement) {
      this.difficultyElement.value = unfinishedBet.gameDifficulty;
    }
    if (this.clientSeedElement) {
      this.clientSeedElement.value = unfinishedBet.clientSeed;
    }

    this.restoreCompletedStack(unfinishedBet.currentFloorCount);
    this.setStatus(`Restored round ${unfinishedBet.id}`);
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

      const finalY = this.placePartOnStack(object, nextTopY - STACK_VERTICAL_OVERLAP);
      const finalBox = new THREE.Box3().setFromObject(object);
      nextTopY = finalBox.max.y;

      this.stackParts.push({
        baseRotationX: object.rotation.x,
        baseRotationY: object.rotation.y,
        baseRotationZ: object.rotation.z,
        baseScale: object.scale.clone(),
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

      const isEnvironmentRoot = isEnvironmentObjectName(child.name);
      const isEnvironmentChild = isEnvironmentObject(child);

      if (isEnvironmentRoot) {
        this.registerEnvironmentObject(child);
      }

      if (child instanceof THREE.Mesh) {
        child.castShadow = !isEnvironmentChild;
        child.receiveShadow = !isEnvironmentChild;
      }
    });
  }

  private registerEnvironmentObject(object: THREE.Object3D): void {
    if (this.environmentObjects.some((environment) => environment.object === object)) {
      return;
    }

    object.traverse((child) => {
      child.frustumCulled = false;

      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    this.environmentObjects.push({
      baseRotationY: object.rotation.y,
      baseY: object.position.y,
      object
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

  private frameBaseStackAtViewPosition(): void {
    const focusPoint = this.getBaseStackFocusPoint();
    const desiredProjectedY = 1 - CAMERA_BASE_STACK_VIEW_Y * 2;
    const shiftAmount = this.getVerticalCameraShiftForProjectedY(focusPoint, desiredProjectedY);

    if (Math.abs(shiftAmount) >= 0.001) {
      this.shiftCameraVertically(shiftAmount);
      this.cameraTargetMinY = this.controls.target.y;
      this.controls.update();
    }

    this.baseStackTopProjectedY = this.getProjectedY(this.getStackTopPoint(this.stackParts[0]?.topY ?? this.stackAnchor.topY));
  }

  private getBaseStackFocusPoint(): THREE.Vector3 {
    const firstPart = this.stackParts[0];

    if (firstPart) {
      firstPart.object.updateMatrixWorld(true);
      const firstPartBox = new THREE.Box3().setFromObject(firstPart.object);

      if (!firstPartBox.isEmpty()) {
        return firstPartBox.getCenter(new THREE.Vector3());
      }
    }

    return new THREE.Vector3(
      this.stackAnchor.center.x,
      this.stackAnchor.topY,
      this.stackAnchor.center.z
    );
  }

  private getVerticalCameraShiftForProjectedY(point: THREE.Vector3, desiredProjectedY: number): number {
    const projectWithShift = (shiftY: number): number => {
      this.camera.position.y += shiftY;
      this.camera.updateMatrixWorld(true);
      const projectedY = point.clone().project(this.camera).y;
      this.camera.position.y -= shiftY;
      this.camera.updateMatrixWorld(true);
      return projectedY;
    };

    let lowerShift = -20;
    let upperShift = 20;
    let lowerDelta = projectWithShift(lowerShift) - desiredProjectedY;
    let upperDelta = projectWithShift(upperShift) - desiredProjectedY;

    for (let expand = 0; lowerDelta * upperDelta > 0 && expand < 4; expand += 1) {
      lowerShift *= 1.5;
      upperShift *= 1.5;
      lowerDelta = projectWithShift(lowerShift) - desiredProjectedY;
      upperDelta = projectWithShift(upperShift) - desiredProjectedY;
    }

    if (lowerDelta * upperDelta > 0) {
      return 0;
    }

    for (let iteration = 0; iteration < 24; iteration += 1) {
      const middleShift = (lowerShift + upperShift) / 2;
      const middleDelta = projectWithShift(middleShift) - desiredProjectedY;

      if (lowerDelta * middleDelta <= 0) {
        upperShift = middleShift;
        upperDelta = middleDelta;
      } else {
        lowerShift = middleShift;
        lowerDelta = middleDelta;
      }
    }

    return (lowerShift + upperShift) / 2;
  }

  private getStackTopPoint(topY: number): THREE.Vector3 {
    return new THREE.Vector3(
      this.stackAnchor.center.x,
      topY,
      this.stackAnchor.center.z
    );
  }

  private getCameraClearanceTopY(topY: number): number {
    return topY + this.getStackFloorHeight() * CAMERA_TOP_CLEARANCE_FLOORS;
  }

  private getStackFloorHeight(): number {
    const firstPart = this.stackParts[0];
    const secondPart = this.stackParts[1];

    if (firstPart && secondPart) {
      const measuredStep = secondPart.topY - firstPart.topY;

      if (measuredStep > 0) {
        return measuredStep;
      }
    }

    if (firstPart) {
      firstPart.object.updateMatrixWorld(true);
      const firstPartBox = new THREE.Box3().setFromObject(firstPart.object);

      if (!firstPartBox.isEmpty()) {
        return firstPartBox.max.y - firstPartBox.min.y;
      }
    }

    return CAMERA_TOP_PADDING;
  }

  private getProjectedY(point: THREE.Vector3): number {
    this.camera.updateMatrixWorld(true);
    return point.clone().project(this.camera).y;
  }

  private placeBet = async (): Promise<void> => {
    if (!this.settings || this.unfinishedGatePending || this.state.status === 'placing' || this.state.betId) {
      return;
    }

    const amountInput = this.amountElement?.value.trim() ?? '';
    const amount = Number(amountInput);
    const difficulty = this.getSelectedDifficulty();
    const clientSeed = this.clientSeedElement?.value.trim() ?? '';

    if (!Number.isFinite(amount) || amount <= 0) {
      this.highlightAmountInput();
      this.showError('Enter a valid bet amount.');
      return;
    }

    if (!hasAtMostTwoDecimalPlaces(amountInput)) {
      this.highlightAmountInput();
      this.showError('Bet amount can use at most two decimal places.');
      return;
    }

    if (amount < this.settings.minBet || amount > this.settings.maxBet) {
      this.highlightAmountInput();
      this.showError(
        `Bet amount must be ${formatAmount(this.settings.minBet, this.state.currency)}-${formatAmount(
          this.settings.maxBet,
          this.state.currency
        )}.`
      );
      return;
    }

    if (clientSeed.length < 1 || clientSeed.length > 32) {
      this.showError('Client seed must be 1-32 characters.');
      return;
    }

    this.state = {
      ...this.state,
      betAmount: amount,
      clientSeed,
      crashFloor: null,
      difficulty,
      error: null,
      maxFloor: this.settings.difficulties[difficulty].maxFloor,
      status: 'placing',
      winningAmount: 0
    };
    this.updateControls();
    this.setStatus('Placing bet');

    try {
      const bet = await this.client.placeBet({ amount, clientSeed, difficulty });
      this.applyPlacedBet(bet);
      this.restoreCompletedStack(0);
      this.setStatus(`Bet ${bet.betId} placed`);
    } catch (error) {
      const backendErrorType = getBackendErrorType(error);

      if (backendErrorType === 'BetAmountOutOfRangeErrorType') {
        this.highlightAmountInput();
        await this.refreshSettings();
      }

      if (backendErrorType === 'OpenBetExistsErrorType') {
        this.setStatus('Restoring open round');
        const restoredRound = await this.syncUnfinishedBet({
          resetStackWhenNone: false,
          preserveResolvedWhenNone: false
        });

        if (!restoredRound) {
          this.showError('Open round exists, but it could not be restored.');
        }
        return;
      }

      const hasUnfinishedBet = await this.syncUnfinishedBet({
        resetStackWhenNone: false,
        preserveResolvedWhenNone: false
      });
      if (!hasUnfinishedBet) {
        this.showError(getDisplayError(error));
      }
    } finally {
      this.updateControls();
    }
  };

  private handlePrimaryAction = (): void => {
    if (this.state.betId) {
      void this.dropBlock();
      return;
    }

    void this.placeBet();
  };

  private dropBlock = async (): Promise<void> => {
    if (this.unfinishedGatePending || !this.state.betId || this.state.status !== 'active' || this.activeDrop) {
      return;
    }

    this.state.status = 'dropping';
    this.state.error = null;
    this.updateControls();
    this.setStatus('Block in motion');

    try {
      const response = await this.client.dropBlock(this.state.betId);
      const shouldCollapse = response.result === 'lost';

      await this.animateNextFloor(shouldCollapse);
      this.applyDropResponse(response);
      if (response.result === 'won' || response.result === 'lost') {
        await this.confirmResolvedRound();
      }
    } catch (error) {
      const hasUnfinishedBet = await this.syncUnfinishedBet({
        resetStackWhenNone: false,
        preserveResolvedWhenNone: false
      });

      if (hasUnfinishedBet) {
        this.showError(getDisplayError(error));
      } else if (getBackendErrorType(error) !== 'NoOpenBetErrorType') {
        this.showError(getDisplayError(error));
      }
    } finally {
      this.updateControls();
    }
  };

  private cashOut = async (): Promise<void> => {
    if (
      this.unfinishedGatePending ||
      !this.state.betId ||
      this.state.status !== 'active' ||
      this.state.completedFloorCount === 0
    ) {
      return;
    }

    this.state.status = 'cashingOut';
    this.state.error = null;
    this.updateControls();
    this.setStatus('Cashing out');

    try {
      const response = await this.client.cashOut(this.state.betId);
      this.state = {
        ...this.state,
        balance: response.balance ?? this.state.balance,
        betId: null,
        completedFloorCount: response.completedFloorCount,
        crashFloor: response.crashFloor,
        maxFloor: response.maxFloor,
        payoutMultiplier: Number(response.payoutMultiplier),
        status: 'won',
        winningAmount: Number(response.winningAmount)
      };
      this.resetStackPool();
      this.returningCameraToBase = true;
      this.setStatus(`Cashed out ${formatAmount(response.winningAmount, response.currency)}`);
      await this.confirmResolvedRound();
    } catch (error) {
      const hasUnfinishedBet = await this.syncUnfinishedBet({
        resetStackWhenNone: false,
        preserveResolvedWhenNone: false
      });

      if (hasUnfinishedBet) {
        this.showError(getDisplayError(error));
      } else if (getBackendErrorType(error) !== 'NoOpenBetErrorType') {
        this.showError(getDisplayError(error));
      }
    } finally {
      this.updateControls();
    }
  };

  private animateNextFloor(shouldCollapse: boolean): Promise<void> {
    if (this.activeDrop || this.stackIndex >= this.stackParts.length || this.stackIndex >= this.state.maxFloor) {
      return Promise.resolve();
    }

    const part = this.stackParts[this.stackIndex];
    const xRange = Math.min(STACK_RANDOM_X_RANGE, this.stackAnchor.halfWidthX);
    const zRange = Math.min(STACK_RANDOM_BLENDER_Y_RANGE, this.stackAnchor.halfWidthZ);

    return new Promise((resolve) => {
      part.object.visible = true;
      part.object.position.x = part.baseX + THREE.MathUtils.randFloatSpread(xRange * 2);
      part.object.position.z = part.baseZ + THREE.MathUtils.randFloatSpread(zRange * 2);
      part.object.position.y = part.finalY + STACK_DROP_HEIGHT;
      part.object.rotation.y =
        part.baseRotationY +
        THREE.MathUtils.degToRad(THREE.MathUtils.randFloatSpread(STACK_RANDOM_Z_ROTATION_DEGREES * 2));
      this.currentStackTopY = Math.max(this.currentStackTopY, part.topY);
      this.activeDrop = {
        baseRotationX: part.object.rotation.x,
        baseRotationZ: part.object.rotation.z,
        baseScale: part.object.scale.clone(),
        elapsed: 0,
        hasImpacted: false,
        onSettled: resolve,
        part,
        shouldCollapse,
        startY: part.object.position.y,
        swingDirection: Math.random() < 0.5 ? -1 : 1,
        swingPhase: Math.random() * Math.PI * 2
      };
      this.stackIndex += 1;
      this.updateControls();
      this.setStatus('Block in motion');
    });
  }

  private updateStackButton(): void {
    this.updateControls();
  }

  private applyPlacedBet(bet: PlaceMegaBlockBetResponse): void {
    this.state = {
      ...this.state,
      betAmount: Number(bet.betAmount),
      betId: bet.betId,
      clientSeed: bet.clientSeed,
      completedFloorCount: bet.currentFloorCount,
      crashFloor: null,
      currency: bet.currency,
      difficulty: bet.difficulty,
      error: null,
      maxFloor: bet.maxFloor,
      nonce: bet.nonce,
      payoutMultiplier: 1,
      serverSeedHash: bet.serverSeedHash,
      status: 'active',
      winningAmount: 0
    };
  }

  private applyDropResponse(response: DropMegaBlockResponse): void {
    if (response.result === 'lost') {
      this.state = {
        ...this.state,
        betId: null,
        completedFloorCount: response.completedFloorCount,
        crashFloor: response.crashFloor ?? response.attemptedFloor ?? null,
        maxFloor: response.maxFloor,
        payoutMultiplier: Number(response.payoutMultiplier),
        status: 'lost',
        winningAmount: Number(response.winningAmount ?? 0)
      };
      this.setStatus(`Crashed on floor ${response.attemptedFloor ?? response.crashFloor ?? '?'}`);
      return;
    }

    if (response.result === 'won') {
      this.state = {
        ...this.state,
        balance: response.balance ?? this.state.balance,
        betId: null,
        completedFloorCount: response.completedFloorCount,
        crashFloor: response.crashFloor ?? null,
        maxFloor: response.maxFloor,
        payoutMultiplier: Number(response.payoutMultiplier),
        status: 'won',
        winningAmount: Number(response.winningAmount ?? 0)
      };
      this.setStatus(`Auto won ${formatAmount(this.state.winningAmount, this.state.currency)}`);
      return;
    }

    this.state = {
      ...this.state,
      completedFloorCount: response.completedFloorCount,
      maxFloor: response.maxFloor,
      payoutMultiplier: Number(response.payoutMultiplier),
      status: 'active'
    };
    this.setStatus(`Floor ${response.completedFloorCount} safe`);
  }

  private restoreCompletedStack(completedFloorCount: number): void {
    this.resetStackPool();
    const visibleCount = THREE.MathUtils.clamp(
      completedFloorCount,
      0,
      Math.min(this.state.maxFloor, this.stackParts.length)
    );

    for (let index = 0; index < visibleCount; index += 1) {
      const part = this.stackParts[index];
      part.object.visible = true;
      part.object.position.set(part.baseX, part.finalY, part.baseZ);
      part.object.rotation.set(part.baseRotationX, part.baseRotationY, part.baseRotationZ);
      part.object.scale.copy(part.baseScale);
      this.currentStackTopY = Math.max(this.currentStackTopY, part.topY);
    }

    this.stackIndex = visibleCount;
    this.updateControls();
  }

  private async syncUnfinishedBet(options: {
    preserveResolvedWhenNone: boolean;
    resetStackWhenNone: boolean;
  }): Promise<boolean> {
    this.unfinishedGatePending = true;
    this.updateControls();

    try {
      const unfinishedBet = await this.client.getUnfinishedBet();

      if (unfinishedBet.hasUnfinishedBet) {
        this.restoreUnfinishedBet(unfinishedBet);
        this.unfinishedGatePending = false;
        return true;
      }

      if (options.resetStackWhenNone) {
        this.restoreCompletedStack(0);
      }

      this.state = {
        ...this.state,
        betId: null,
        completedFloorCount: options.preserveResolvedWhenNone ? this.state.completedFloorCount : 0,
        crashFloor: options.preserveResolvedWhenNone ? this.state.crashFloor : null,
        error: options.preserveResolvedWhenNone ? this.state.error : null,
        payoutMultiplier: options.preserveResolvedWhenNone ? this.state.payoutMultiplier : 1,
        status: options.preserveResolvedWhenNone ? this.state.status : 'idle',
        winningAmount: options.preserveResolvedWhenNone ? this.state.winningAmount : 0
      };
      this.unfinishedGatePending = false;
      return false;
    } catch (error) {
      this.state.error = getDisplayError(error);
      this.setStatus(this.state.error);
      return true;
    } finally {
      this.updateControls();
    }
  }

  private async refreshSettings(): Promise<void> {
    try {
      this.settings = await this.client.getSettings();
      this.applySettings(this.settings);
    } catch (error) {
      this.state.error = getDisplayError(error);
      this.setStatus(this.state.error);
    }
  }

  private async confirmResolvedRound(): Promise<void> {
    const statusBeforeConfirmation = this.state.status;
    const statusText = this.statusElement?.textContent ?? '';

    await this.syncUnfinishedBet({
      resetStackWhenNone: false,
      preserveResolvedWhenNone: true
    });

    if (!this.state.betId && (statusBeforeConfirmation === 'won' || statusBeforeConfirmation === 'lost')) {
      this.state.status = statusBeforeConfirmation;
      this.setStatus(statusText);
    }
  }

  private updateControls = (): void => {
    const hasActiveBet = Boolean(this.state.betId);
    const isResolvedRound =
      !hasActiveBet && (this.state.status === 'won' || this.state.status === 'lost');
    const isBusy =
      this.state.status === 'placing' ||
      this.state.status === 'dropping' ||
      this.state.status === 'cashingOut' ||
      this.unfinishedGatePending ||
      Boolean(this.activeDrop) ||
      this.collapsingBlocks.length > 0;
    const canPlace = Boolean(this.settings) && !hasActiveBet && !isBusy && this.state.status !== 'error';
    const canDrop =
      hasActiveBet &&
      this.state.status === 'active' &&
      !isBusy &&
      this.stackIndex < this.state.maxFloor &&
      this.stackIndex < this.stackParts.length;
    const canCashOut =
      hasActiveBet &&
      this.state.status === 'active' &&
      this.state.completedFloorCount > 0 &&
      !isBusy;

    if (this.stackButton) {
      this.stackButton.disabled = hasActiveBet ? !canDrop : !canPlace;
      const isDropAction =
        hasActiveBet && (this.state.status === 'active' || this.state.status === 'dropping');
      this.stackButton.textContent = isDropAction ? 'Go' : 'Play';
    }

    if (this.cashOutButton) {
      this.cashOutButton.disabled = !canCashOut;
      const cashOutAmount = this.state.betAmount * this.state.payoutMultiplier;

      if (this.state.status === 'cashingOut') {
        this.cashOutButton.textContent = 'Cashing Out';
      } else if (hasActiveBet && this.state.completedFloorCount) {
        const amount = document.createElement('span');
        amount.className = 'cashout-button__amount';
        amount.textContent = formatPanelAmount(cashOutAmount, this.state.currency);
        const multiplier = document.createElement('span');
        multiplier.className = 'cashout-button__multiplier';
        multiplier.textContent = `(${this.state.payoutMultiplier.toFixed(3)}x)`;
        this.cashOutButton.replaceChildren(document.createTextNode('Cash Out'), amount, multiplier);
      } else {
        this.cashOutButton.textContent = 'Cash Out';
      }
    }

    if (this.resetButton) {
      this.resetButton.disabled = this.returningCameraToBase && !isResolvedRound;
    }

    if (this.amountElement) {
      this.amountElement.disabled = hasActiveBet || isBusy;
    }

    if (this.difficultyElement) {
      this.difficultyElement.disabled = hasActiveBet || isBusy;
    }

    if (this.clientSeedElement) {
      this.clientSeedElement.disabled = hasActiveBet || isBusy;
    }

    if (this.balanceElement) {
      this.balanceElement.textContent =
        this.state.balance === null
          ? `${this.state.currency} --`
          : formatPanelAmount(this.state.balance, this.state.currency);
    }

    if (this.roundDetailsElement) {
      this.roundDetailsElement.textContent = this.getRoundDetailsText();
    }

  };

  private getRoundDetailsText(): string {
    if (this.state.error) {
      return this.state.error;
    }

    if (!this.state.betId && this.state.status !== 'won' && this.state.status !== 'lost') {
      return `Limits ${this.settings?.minBet ?? 0.1}-${this.settings?.maxBet ?? 100} ${this.state.currency}`;
    }

    const floorText = `${this.state.completedFloorCount}/${this.state.maxFloor} floors`;

    if (this.state.status === 'lost') {
      return `${floorText} | Lost on floor ${this.state.crashFloor ?? '?'} | ${this.state.currency}`;
    }

    if (this.state.status === 'won') {
      return `${floorText} | Won ${formatAmount(this.state.winningAmount, this.state.currency)}`;
    }

    return `${floorText} | ${this.state.payoutMultiplier.toFixed(3)}x | Bet ${formatAmount(
      this.state.betAmount,
      this.state.currency
    )}`;
  }

  private getSelectedDifficulty(): MegaBlockDifficulty {
    const value = this.difficultyElement?.value;

    if (value === 'medium' || value === 'hard' || value === 'hardcore') {
      return value;
    }

    return 'easy';
  }

  private showError(message: string): void {
    this.state = {
      ...this.state,
      error: message,
      status: this.state.betId ? 'active' : 'idle'
    };
    this.setStatus(message);
    this.updateControls();
  }

  private handleAmountInput = (): void => {
    this.amountElement?.classList.remove('field__input--error');
    this.updateControls();
  };

  private highlightAmountInput(): void {
    this.amountElement?.classList.add('field__input--error');
  }

  private setDataMode(): void {
    if (!this.dataModeElement) {
      return;
    }

    this.dataModeElement.textContent = getMegaBlockDataMode() === 'mock' ? 'Mock data' : 'API data';
  }

  private updateStackAnimation(delta: number): void {
    if (!this.activeDrop) {
      return;
    }

    const drop = this.activeDrop;
    drop.elapsed += delta;

    const progress = Math.min(drop.elapsed / STACK_DROP_SECONDS, 1);
    const fallProgress = Math.min(progress / STACK_CONTACT_PROGRESS, 1);
    const gravityProgress = fallProgress * fallProgress;
    drop.part.object.position.y = THREE.MathUtils.lerp(
      drop.startY,
      drop.part.finalY,
      gravityProgress
    );

    const swing =
      THREE.MathUtils.degToRad(STACK_SWING_DEGREES) *
      Math.sin(drop.swingPhase + fallProgress * Math.PI * 2.2) *
      Math.pow(1 - fallProgress, 0.7);
    drop.part.object.rotation.x = drop.baseRotationX + swing;
    drop.part.object.rotation.z = drop.baseRotationZ + swing * 0.55 * drop.swingDirection;

    if (progress >= STACK_CONTACT_PROGRESS) {
      if (!drop.hasImpacted) {
        drop.hasImpacted = true;
        this.triggerLandingImpact(drop.part, drop.shouldCollapse);
      }

      const impactProgress =
        (progress - STACK_CONTACT_PROGRESS) / (1 - STACK_CONTACT_PROGRESS);
      const compression = Math.sin(impactProgress * Math.PI) * STACK_IMPACT_COMPRESSION;
      drop.part.object.scale.set(
        drop.baseScale.x * (1 + compression * 0.45),
        drop.baseScale.y * (1 - compression),
        drop.baseScale.z * (1 + compression * 0.45)
      );
    }

    if (progress >= 1) {
      drop.part.object.position.y = drop.part.finalY;
      drop.part.object.rotation.x = drop.baseRotationX;
      drop.part.object.rotation.z = drop.baseRotationZ;
      drop.part.object.scale.copy(drop.baseScale);
      this.activeDrop = null;

      if (drop.shouldCollapse) {
        drop.part.object.rotation.z += THREE.MathUtils.degToRad(
          BAD_LANDING_TILT_DEGREES * (Math.random() < 0.5 ? -1 : 1)
        );
        this.collapseSettled = drop.onSettled;
        this.startTowerCollapse();
        return;
      }

      drop.onSettled();
      this.updateControls();
      this.setStatus(this.stackIndex >= this.stackParts.length ? 'Building stacked' : 'Ready for next floor');
    }
  }

  private startTowerCollapse(): void {
    this.collapsingBlocks.length = 0;
    this.collapseCameraStartTargetY = this.controls.target.y;

    for (const [index, part] of this.stackParts.slice(0, this.stackIndex).entries()) {
      if (!part.object.visible) {
        continue;
      }

      this.collapsingBlocks.push({
        angularVelocity: new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(2.4),
          THREE.MathUtils.randFloatSpread(1.4),
          THREE.MathUtils.randFloatSpread(2.4)
        ),
        delay: (this.stackIndex - index - 1) * 0.025 + Math.random() * 0.08,
        object: part.object,
        startY: part.object.position.y,
        velocity: new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(3.5),
          Math.random() * 1.5,
          THREE.MathUtils.randFloatSpread(3.5)
        )
      });
    }

    if (this.stackButton) {
      this.stackButton.disabled = true;
    }
    this.setStatus(`Floor ${this.stackIndex} landed badly!`);
  }

  private updateTowerCollapse(delta: number): void {
    if (!this.collapsingBlocks.length) {
      return;
    }

    let visibleBlocks = 0;
    let totalFallDistance = 0;

    for (const block of this.collapsingBlocks) {
      if (!block.object.visible) {
        continue;
      }

      visibleBlocks += 1;
      block.delay -= delta;

      if (block.delay > 0) {
        totalFallDistance += Math.max(block.startY - block.object.position.y, 0);
        continue;
      }

      block.velocity.y -= COLLAPSE_GRAVITY * delta;
      block.object.position.addScaledVector(block.velocity, delta);
      block.object.rotation.x += block.angularVelocity.x * delta;
      block.object.rotation.y += block.angularVelocity.y * delta;
      block.object.rotation.z += block.angularVelocity.z * delta;
      totalFallDistance += Math.max(block.startY - block.object.position.y, 0);

      if (block.object.position.y < this.stackAnchor.topY - DESTROY_BELOW_GROUND_DISTANCE) {
        block.object.visible = false;
        block.object.removeFromParent();
      }
    }

    if (visibleBlocks > 0) {
      const averageFallDistance = totalFallDistance / visibleBlocks;
      const desiredCameraY = Math.max(
        this.cameraTargetMinY,
        this.collapseCameraStartTargetY - averageFallDistance
      );
      const smoothing = 1 - Math.exp(-delta * COLLAPSE_CAMERA_FOLLOW_SPEED);
      this.shiftCameraVertically((desiredCameraY - this.controls.target.y) * smoothing);
    }

    if (visibleBlocks === 0) {
      this.collapsingBlocks.length = 0;
      this.returningCameraToBase = true;
      this.resetStackPool();
      this.awaitingRoundRestart = false;
      this.setStatus('Tower collapsed');
      if (this.stackButton) {
        this.stackButton.disabled = true;
        this.stackButton.textContent = 'Resetting view';
      }
      this.collapseSettled?.();
      this.collapseSettled = null;
    }
  }

  private resetStackPool(): void {
    for (const part of this.stackParts) {
      if (!part.object.parent) {
        this.scene.add(part.object);
      }

      part.object.visible = false;
      part.object.position.set(part.baseX, part.finalY, part.baseZ);
      part.object.rotation.set(part.baseRotationX, part.baseRotationY, part.baseRotationZ);
      part.object.scale.copy(part.baseScale);
      part.object.updateMatrixWorld(true);
    }

    this.stackIndex = 0;
    this.activeDrop = null;
    this.currentStackTopY = this.stackAnchor.topY;
    this.clearLandingImpact();
    this.clearDustParticles();
  }

  private resetRound = (): void => {
    this.collapsingBlocks.length = 0;
    this.awaitingRoundRestart = false;
    this.resetInProgress = true;
    this.returningCameraToBase = true;
    this.restoreCompletedStack(this.state.completedFloorCount);

    if (this.stackButton) {
      this.stackButton.disabled = true;
      this.stackButton.textContent = 'Resetting view';
    }
    if (this.resetButton) {
      this.resetButton.disabled = true;
    }
    this.setStatus('Resetting round');
  };

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
    this.updateTowerCollapse(delta);
    this.updateCameraBaseReturn(delta);
    this.controls.update();
    this.updateCameraHeight(delta);
    this.updateEnvironmentPosition();
    this.updateDustParticles(delta);
    this.updateCameraSlider();
    this.updateFps(delta);
    this.updateLandingScreenEffect(delta);
    const shakeOffset = this.getLandingShakeOffset(delta);
    this.camera.position.add(shakeOffset);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(shakeOffset);
  };

  private triggerLandingImpact(part: StackPart, isHeavyImpact: boolean): void {
    this.landingShakeRemaining = LANDING_SHAKE_DURATION;
    this.landingScreenEffectRemaining = LANDING_SCREEN_EFFECT_DURATION;
    document.body.classList.add('screen-impact-active');
    this.spawnLandingDust(part, isHeavyImpact);
  }

  private spawnLandingDust(part: StackPart, isHeavyImpact: boolean): void {
    const box = new THREE.Box3().setFromObject(part.object);
    const center = box.getCenter(new THREE.Vector3());
    const width = Math.max(box.max.x - box.min.x, this.stackAnchor.halfWidthX * 2, 1);
    const depth = Math.max(box.max.z - box.min.z, this.stackAnchor.halfWidthZ * 2, 1);
    const count = Math.round(DUST_PARTICLE_COUNT * (isHeavyImpact ? 1.6 : 1));

    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const angleJitter = THREE.MathUtils.randFloatSpread(0.75);
      const travelAngle = angle + angleJitter;
      const edgeSpread = THREE.MathUtils.randFloat(0.2, 0.92);
      const opacity = THREE.MathUtils.randFloat(0.38, isHeavyImpact ? 0.82 : 0.7);
      const initialScale = THREE.MathUtils.randFloat(0.2, isHeavyImpact ? 0.58 : 0.5);
      const fallsDownward = Math.random() < 0.36;
      const material = new THREE.SpriteMaterial({
        color: 0xd8c39c,
        depthWrite: false,
        map: this.dustTexture,
        opacity,
        transparent: true
      });
      const sprite = new THREE.Sprite(material);

      sprite.position.set(
        center.x + Math.cos(angle) * width * edgeSpread,
        box.min.y + THREE.MathUtils.randFloat(0.02, isHeavyImpact ? 0.62 : 0.46),
        center.z + Math.sin(angle) * depth * edgeSpread
      );
      sprite.scale.setScalar(initialScale);
      this.scene.add(sprite);

      this.dustParticles.push({
        age: 0,
        driftPhase: Math.random() * Math.PI * 2,
        driftSpeed: THREE.MathUtils.randFloat(4, 8),
        driftStrength: THREE.MathUtils.randFloat(0.025, isHeavyImpact ? 0.075 : 0.06),
        initialOpacity: opacity,
        initialScale,
        lifetime: THREE.MathUtils.randFloat(DUST_DURATION_RANGE[0], DUST_DURATION_RANGE[1]),
        sprite,
        spin: THREE.MathUtils.randFloatSpread(2.8),
        velocity: new THREE.Vector3(
          Math.cos(travelAngle) * THREE.MathUtils.randFloat(0.75, isHeavyImpact ? 2.25 : 1.75),
          fallsDownward
            ? THREE.MathUtils.randFloat(-0.65, -0.15)
            : THREE.MathUtils.randFloat(0.35, isHeavyImpact ? 1.65 : 1.25),
          Math.sin(travelAngle) * THREE.MathUtils.randFloat(0.75, isHeavyImpact ? 2.25 : 1.75)
        )
      });
    }
  }

  private updateDustParticles(delta: number): void {
    for (let index = this.dustParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.dustParticles[index];
      particle.age += delta;

      if (particle.age >= particle.lifetime) {
        this.removeDustParticle(index);
        continue;
      }

      const progress = particle.age / particle.lifetime;
      const material = particle.sprite.material;
      particle.velocity.y -= DUST_GRAVITY * delta;
      particle.velocity.multiplyScalar(Math.max(1 - DUST_DRAG * delta, 0.2));
      particle.sprite.position.addScaledVector(particle.velocity, delta);
      particle.sprite.position.x +=
        Math.sin(particle.driftPhase + particle.age * particle.driftSpeed) *
        particle.driftStrength *
        (1 - progress);
      particle.sprite.position.z +=
        Math.cos(particle.driftPhase + particle.age * particle.driftSpeed * 0.82) *
        particle.driftStrength *
        (1 - progress);
      particle.sprite.scale.setScalar(particle.initialScale * (1 + progress * DUST_EXPANSION));
      material.opacity = particle.initialOpacity * Math.pow(1 - progress, 1.35);
      material.rotation += particle.spin * delta;
    }
  }

  private clearDustParticles(): void {
    for (let index = this.dustParticles.length - 1; index >= 0; index -= 1) {
      this.removeDustParticle(index);
    }
  }

  private removeDustParticle(index: number): void {
    const [particle] = this.dustParticles.splice(index, 1);
    particle.sprite.removeFromParent();
    particle.sprite.material.dispose();
  }

  private updateLandingScreenEffect(delta: number): void {
    if (this.landingScreenEffectRemaining <= 0) {
      if (document.body.classList.contains('screen-impact-active')) {
        this.clearLandingImpact();
      }
      return;
    }

    this.landingScreenEffectRemaining = Math.max(this.landingScreenEffectRemaining - delta, 0);
    const progress = this.landingScreenEffectRemaining / LANDING_SCREEN_EFFECT_DURATION;
    const easedProgress = progress * progress;
    const shakePixels = LANDING_SCREEN_SHAKE_PIXELS * easedProgress;
    const blurPixels = LANDING_SCREEN_BLUR_PIXELS * Math.min(progress * 1.2, 1);

    document.body.style.setProperty(
      '--impact-shake-x',
      `${THREE.MathUtils.randFloatSpread(shakePixels * 2).toFixed(2)}px`
    );
    document.body.style.setProperty(
      '--impact-shake-y',
      `${THREE.MathUtils.randFloatSpread(shakePixels).toFixed(2)}px`
    );
    document.body.style.setProperty('--impact-blur', `${blurPixels.toFixed(2)}px`);
    document.body.style.setProperty(
      '--impact-scale',
      String(1 + (LANDING_SCREEN_SCALE - 1) * easedProgress)
    );
  }

  private clearLandingImpact(): void {
    this.landingShakeRemaining = 0;
    this.landingScreenEffectRemaining = 0;
    document.body.classList.remove('screen-impact-active');
    document.body.style.setProperty('--impact-shake-x', '0px');
    document.body.style.setProperty('--impact-shake-y', '0px');
    document.body.style.setProperty('--impact-blur', '0px');
    document.body.style.setProperty('--impact-scale', '1');
  }

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
    const clearanceTopY = this.getCameraClearanceTopY(this.currentStackTopY);
    const maxTargetY = Math.max(this.cameraTargetMinY, clearanceTopY + CAMERA_TOP_PADDING);

    // Keep manual right-mouse panning between the original view and the stack top.
    const clampedTargetY = THREE.MathUtils.clamp(
      this.controls.target.y,
      this.cameraTargetMinY,
      maxTargetY
    );
    this.shiftCameraVertically(clampedTargetY - this.controls.target.y);

    const stackTop = this.getStackTopPoint(clearanceTopY);

    if (this.activeDrop && this.baseStackTopProjectedY !== null) {
      const desiredShift = this.getVerticalCameraShiftForProjectedY(stackTop, this.baseStackTopProjectedY);
      const desiredTargetY = THREE.MathUtils.clamp(
        this.controls.target.y + desiredShift,
        this.cameraTargetMinY,
        maxTargetY
      );
      const smoothShift = (desiredTargetY - this.controls.target.y) * Math.min(delta * 6, 1);
      this.shiftCameraVertically(smoothShift);
    }

    this.controls.update();
  }

  private shiftCameraVertically(amount: number): void {
    if (amount === 0) {
      return;
    }

    this.camera.position.y += amount;
    this.controls.target.y += amount;
    this.updateEnvironmentPosition();
  }

  private updateEnvironmentPosition(): void {
    if (!this.environmentObjects.length) {
      return;
    }

    const cameraHeightOffset = (this.controls.target.y - this.cameraTargetMinY) * ENVIRONMENT_VERTICAL_PARALLAX;
    const rotationOffset = THREE.MathUtils.degToRad(
      this.clock.elapsedTime * ENVIRONMENT_Y_ROTATION_DEGREES_PER_SECOND
    );

    for (const environment of this.environmentObjects) {
      environment.object.position.y = environment.baseY + cameraHeightOffset;
      environment.object.rotation.y = environment.baseRotationY + rotationOffset;
    }
  }

  private updateCameraBaseReturn(delta: number): void {
    if (!this.returningCameraToBase) {
      return;
    }

    const remainingDistance = this.cameraTargetMinY - this.controls.target.y;

    if (Math.abs(remainingDistance) < 0.01) {
      this.shiftCameraVertically(remainingDistance);
      this.returningCameraToBase = false;

      if (this.resetInProgress) {
        this.resetInProgress = false;
        this.updateControls();
        this.setStatus('Ready for next floor');
        if (this.resetButton) {
          this.resetButton.disabled = false;
        }
      } else if (this.stackButton && this.awaitingRoundRestart) {
        this.updateControls();
      }
      return;
    }

    const smoothing = 1 - Math.exp(-delta * CAMERA_BASE_RETURN_SPEED);
    this.shiftCameraVertically(remainingDistance * smoothing);
  }

  private moveCameraFromSlider = (): void => {
    if (!this.cameraHeightElement) {
      return;
    }

    const maxTargetY = Math.max(
      this.cameraTargetMinY,
      this.getCameraClearanceTopY(this.currentStackTopY) + CAMERA_TOP_PADDING
    );
    const sliderMin = Number(this.cameraHeightElement.min);
    const sliderMax = Number(this.cameraHeightElement.max);
    const ratio = (Number(this.cameraHeightElement.value) - sliderMin) / (sliderMax - sliderMin);
    const desiredTargetY = THREE.MathUtils.lerp(this.cameraTargetMinY, maxTargetY, ratio);
    const verticalMovement = desiredTargetY - this.controls.target.y;

    this.shiftCameraVertically(verticalMovement);
    const cameraOffset = this.camera.position.clone().sub(this.controls.target);
    cameraOffset.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(-verticalMovement * SLIDER_ORBIT_DEGREES_PER_HEIGHT_UNIT)
    );
    this.camera.position.copy(this.controls.target).add(cameraOffset);
    this.controls.update();
  };

  private updateCameraSlider(): void {
    if (!this.cameraHeightElement) {
      return;
    }

    const maxTargetY = Math.max(
      this.cameraTargetMinY,
      this.getCameraClearanceTopY(this.currentStackTopY) + CAMERA_TOP_PADDING
    );
    const heightRange = maxTargetY - this.cameraTargetMinY;
    const ratio = heightRange
      ? THREE.MathUtils.clamp((this.controls.target.y - this.cameraTargetMinY) / heightRange, 0, 1)
      : 0;
    const sliderMin = Number(this.cameraHeightElement.min);
    const sliderMax = Number(this.cameraHeightElement.max);
    this.cameraHeightElement.value = String(
      Math.round(THREE.MathUtils.lerp(sliderMin, sliderMax, ratio))
    );
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

function formatAmount(value: number | string, currency: string): string {
  return `${Number(value).toFixed(2)} ${currency}`;
}

function formatPanelAmount(value: number | string, currency: string): string {
  return `${currency} ${Number(value).toFixed(2)}`;
}

function hasAtMostTwoDecimalPlaces(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value);
}

function getBackendErrorType(error: unknown): string | null {
  if (error instanceof MegaBlockApiError) {
    return error.backendErrorType;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  const backendErrorTypes = [
    'OperatorSessionInvalidErrorType',
    'OriginalGameNotFoundErrorType',
    'OriginalGameNotAvailableErrorType',
    'BetAmountOutOfRangeErrorType',
    'InsufficientBalanceErrorType',
    'OpenBetExistsErrorType',
    'NoOpenBetErrorType',
    'MegaBlockNoFloorsCompletedErrorType',
    'WalletServiceUnavailableErrorType'
  ];

  return backendErrorTypes.find((errorType) => error.message.includes(errorType)) ?? null;
}

function getDisplayError(error: unknown): string {
  return error instanceof Error ? error.message : 'MegaBlock request failed.';
}
