import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
  type WebGLRenderer,
  IcosahedronGeometry,
} from "three";
import { BUDDHA_Z, CUSHION_SPOTS, HALL_FRONT_Z, HALL_HALF_WIDTH } from "@dongjane/shared";
import { buildBuddha, type BuddhaPieces } from "./buddha.ts";
import { GeometryBuilder, type Placement } from "./geometry.ts";
import {
  backdropTexture,
  beamGlowTexture,
  cushionTexture,
  floorTexture,
  flameGlowTexture,
  mulberry32,
  skyTexture,
} from "./textures.ts";

export interface HallQuality {
  shadows: boolean;
  shadowMapSize: number;
  dust: number;
  anisotropy: number;
}

export const HALL_BOUNDS = {
  minX: -HALL_HALF_WIDTH + 0.7,
  maxX: HALL_HALF_WIDTH - 0.7,
  minZ: -6.6,
  maxZ: HALL_FRONT_Z - 0.4,
  maxY: 5.4,
  minY: 0.5,
} as const;

const WALL_X = HALL_HALF_WIDTH;
const BACK_Z = -7.5;
const HEIGHT = 6;
const PLASTER = 0xeadcb9;
const WOOD_DARK = 0x4a2d1a;
const WOOD_MID = 0x6b4326;
const LACQUER = 0x9a2f20;
const GOLD = 0xd9ad48;
const GOLD_ACCENT = [0xd9ad48, 0x2f7d6b, 0xe6b43c, 0xc43d2d];

const CANDLE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-3.1, BUDDHA_Z + 0.8],
  [-2.4, BUDDHA_Z + 0.8],
  [-1.7, BUDDHA_Z + 0.8],
  [1.7, BUDDHA_Z + 0.8],
  [2.4, BUDDHA_Z + 0.8],
  [3.1, BUDDHA_Z + 0.8],
];
const ALTAR_TOP = 0.62;
const SUN_POSITION = new Vector3(14, 8, -2);
const SUN_TARGET = new Vector3(0, 0.3, 1.5);

function buildDoorSection(width: number, window: boolean): { wood: BufferGeometry; paper: BufferGeometry | null } {
  const wood = new GeometryBuilder();
  const inner = width - 0.2;
  const bottom = 0.9;
  const openHeight = 3.7;

  wood.add(new BoxGeometry(width, bottom, 0.14), WOOD_MID, { y: bottom / 2, z: 0.07 });
  wood.add(new BoxGeometry(width, HEIGHT - bottom - openHeight, 0.16), 0xd9c59a, {
    y: bottom + openHeight + (HEIGHT - bottom - openHeight) / 2,
    z: 0.08,
  });
  const stripColors = [0x2f7d6b, 0xc43d2d, 0xe6b43c];
  stripColors.forEach((color, i) => {
    wood.add(new BoxGeometry(width, 0.1, 0.19), color, { y: bottom + openHeight + 0.12 + i * 0.13, z: 0.1 });
  });
  wood.add(new BoxGeometry(width, 0.1, 0.14), WOOD_DARK, { y: bottom + openHeight + 0.05, z: 0.09 });
  wood.add(new BoxGeometry(0.1, openHeight, 0.12), WOOD_DARK, { x: -inner / 2, y: bottom + openHeight / 2, z: 0.07 });
  wood.add(new BoxGeometry(0.1, openHeight, 0.12), WOOD_DARK, { x: inner / 2, y: bottom + openHeight / 2, z: 0.07 });

  const columns = Math.max(2, Math.round(inner / 0.42));
  for (let i = 1; i < columns; i += 1) {
    const x = -inner / 2 + (inner * i) / columns;
    wood.add(new BoxGeometry(0.035, openHeight, 0.05), WOOD_DARK, { x, y: bottom + openHeight / 2, z: 0.08 });
  }
  for (let k = 0; k <= 5; k += 1) {
    wood.add(new BoxGeometry(inner, 0.035, 0.05), WOOD_DARK, { y: bottom + (openHeight * k) / 5, z: 0.08 });
  }
  if (window) {
    wood.add(new BoxGeometry(width + 0.1, 0.08, 0.34), WOOD_MID, { y: bottom + 0.02, z: 0.14 });
    return { wood: wood.build(), paper: null };
  }
  wood.add(new BoxGeometry(0.1, openHeight, 0.1), WOOD_DARK, { y: bottom + openHeight / 2, z: 0.09 });

  const paper = new GeometryBuilder().add(new PlaneGeometry(inner, openHeight), 0xffffff, {
    y: bottom + openHeight / 2,
    z: 0.04,
  });
  return { wood: wood.build(), paper: paper.build() };
}

function buildEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const dome = new SphereGeometry(10, 24, 16);
  const position = dome.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const top = new Color(0xfff1d2);
  const mid = new Color(0xb98a52);
  const low = new Color(0x2e1c10);
  const mix = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getY(i) / 10;
    if (t > 0) mix.copy(mid).lerp(top, t);
    else mix.copy(mid).lerp(low, -t);
    colors[i * 3] = mix.r;
    colors[i * 3 + 1] = mix.g;
    colors[i * 3 + 2] = mix.b;
  }
  dome.setAttribute("color", new BufferAttribute(colors, 3));
  scene.add(new Mesh(dome, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  const lamp = new Mesh(new PlaneGeometry(5, 4), new MeshBasicMaterial({ color: new Color(1, 0.9, 0.7).multiplyScalar(7), side: DoubleSide }));
  lamp.position.set(8, 4, 0);
  lamp.rotation.y = -Math.PI / 2;
  scene.add(lamp);
  const candle = new Mesh(new PlaneGeometry(3, 2), new MeshBasicMaterial({ color: new Color(1, 0.62, 0.3).multiplyScalar(4), side: DoubleSide }));
  candle.position.set(0, 2, 8);
  candle.rotation.y = Math.PI;
  scene.add(candle);

  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.03);
  generator.dispose();
  dome.dispose();
  return target.texture;
}

export class Hall {
  readonly group = new Group();
  readonly sun: DirectionalLight;

  private readonly buddha: BuddhaPieces;
  private readonly environment: Texture;
  private readonly candleLight: PointLight;
  private readonly flames: InstancedMesh;
  private readonly dust: Points;
  private readonly dustSeeds: Float32Array;
  private readonly cushionBody: InstancedMesh;
  private readonly cushionTop: InstancedMesh;
  private readonly occupied = new Set<number>();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tint = new Color();
  private readonly textures: Texture[] = [];

  constructor(renderer: WebGLRenderer, quality: HallQuality) {
    this.group.name = "hall";
    this.environment = buildEnvironment(renderer);
    this.buddha = buildBuddha(this.environment);
    const anisotropy = quality.anisotropy;

    const hemisphere = new HemisphereLight(0xffe2b4, 0x6b4a2a, 1.25);
    this.group.add(hemisphere);

    this.sun = new DirectionalLight(0xffd8a0, 3.1);
    this.sun.position.copy(SUN_POSITION);
    this.sun.target.position.copy(SUN_TARGET);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const camera = this.sun.shadow.camera;
      camera.left = -11;
      camera.right = 11;
      camera.top = 11;
      camera.bottom = -11;
      camera.near = 2;
      camera.far = 40;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.035;
    }
    this.group.add(this.sun, this.sun.target);

    this.candleLight = new PointLight(0xffb066, 9, 11, 2);
    this.candleLight.position.set(0, 1.7, BUDDHA_Z + 1.4);
    this.group.add(this.candleLight);

    const structure = this.buildStructure();
    const structureMesh = new Mesh(structure.opaque, new MeshLambertMaterial({ vertexColors: true }));
    structureMesh.castShadow = true;
    structureMesh.receiveShadow = true;
    structureMesh.name = "structure";
    this.group.add(structureMesh);

    const paperMesh = new Mesh(
      structure.paper,
      new MeshLambertMaterial({ vertexColors: true, color: 0xf7e6bd, emissive: 0xc79a55, emissiveIntensity: 0.55 }),
    );
    paperMesh.name = "paper";
    this.group.add(paperMesh);

    const floorMap = floorTexture(anisotropy);
    floorMap.repeat.set(2, 2.1);
    const floor = new Mesh(new PlaneGeometry(HALL_HALF_WIDTH * 2, HALL_FRONT_Z - BACK_Z), new MeshLambertMaterial({ map: floorMap }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (HALL_FRONT_Z + BACK_Z) / 2);
    floor.receiveShadow = true;
    floor.name = "floor";
    this.group.add(floor);

    const backdropMap = backdropTexture(anisotropy);
    const backdrop = new Mesh(new PlaneGeometry(HALL_HALF_WIDTH * 2, 6), new MeshLambertMaterial({ map: backdropMap, emissive: 0x2a1c0c, emissiveMap: backdropMap, emissiveIntensity: 0.55 }));
    backdrop.position.set(0, 3, BACK_Z + 0.02);
    backdrop.receiveShadow = true;
    backdrop.name = "backdrop";
    this.group.add(backdrop);

    this.buddha.group.position.set(0, ALTAR_TOP, BUDDHA_Z - 0.5);
    this.group.add(this.buddha.group);

    this.buildOutdoors();
    this.buildBeams();

    const cushions = this.buildCushions(anisotropy);
    this.cushionBody = cushions.body;
    this.cushionTop = cushions.top;

    this.flames = this.buildCandles();

    const dustCount = quality.dust;
    this.dustSeeds = new Float32Array(dustCount * 4);
    const rand = mulberry32(31);
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i += 1) {
      this.dustSeeds[i * 4] = rand() * Math.PI * 2;
      this.dustSeeds[i * 4 + 1] = 0.2 + rand() * 0.5;
      this.dustSeeds[i * 4 + 2] = rand();
      this.dustSeeds[i * 4 + 3] = rand();
    }
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute("position", new Float32BufferAttribute(dustPositions, 3));
    const dustMap = flameGlowTexture();
    this.textures.push(floorMap, backdropMap, dustMap);
    this.dust = new Points(
      dustGeometry,
      new PointsMaterial({
        map: dustMap,
        size: 0.09,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
        color: 0xfff0c8,
        fog: false,
      }),
    );
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    this.update(0, null, true);
  }

  private buildStructure(): { opaque: BufferGeometry; paper: BufferGeometry } {
    const opaque = new GeometryBuilder();
    const paper = new GeometryBuilder();
    const wallDepth = 0.5;

    opaque.add(new BoxGeometry(wallDepth, HEIGHT + 0.4, HALL_FRONT_Z - BACK_Z + 1), PLASTER, {
      x: -WALL_X - wallDepth / 2,
      y: HEIGHT / 2,
      z: (HALL_FRONT_Z + BACK_Z) / 2,
    });
    opaque.add(new BoxGeometry(HALL_HALF_WIDTH * 2 + 1, HEIGHT + 0.4, wallDepth), PLASTER, { y: HEIGHT / 2, z: HALL_FRONT_Z + wallDepth / 2 });
    opaque.add(new BoxGeometry(HALL_HALF_WIDTH * 2 + 1, HEIGHT + 0.4, wallDepth), PLASTER, { y: HEIGHT / 2, z: BACK_Z - wallDepth / 2 });

    const windowFrom = -2.1;
    const windowTo = 2.0;
    const rightBack = windowFrom - BACK_Z;
    const rightFront = HALL_FRONT_Z - windowTo;
    opaque.add(new BoxGeometry(wallDepth, HEIGHT + 0.4, rightBack), PLASTER, { x: WALL_X + wallDepth / 2, y: HEIGHT / 2, z: BACK_Z + rightBack / 2 });
    opaque.add(new BoxGeometry(wallDepth, HEIGHT + 0.4, rightFront), PLASTER, { x: WALL_X + wallDepth / 2, y: HEIGHT / 2, z: windowTo + rightFront / 2 });
    opaque.add(new BoxGeometry(wallDepth, 0.9, windowTo - windowFrom), PLASTER, { x: WALL_X + wallDepth / 2, y: 0.45, z: (windowFrom + windowTo) / 2 });
    opaque.add(new BoxGeometry(wallDepth, HEIGHT - 4.6, windowTo - windowFrom), PLASTER, {
      x: WALL_X + wallDepth / 2,
      y: 4.6 + (HEIGHT - 4.6) / 2,
      z: (windowFrom + windowTo) / 2,
    });

    const addSection = (width: number, window: boolean, at: Placement): void => {
      const section = buildDoorSection(width, window);
      opaque.addBuilt(section.wood, at);
      if (section.paper) paper.addBuilt(section.paper, at);
    };
    const sideSections: ReadonlyArray<readonly [number, number, boolean]> = [
      [-4.25, 4.3, false],
      [-0.05, 4.1, true],
      [4.0, 4.0, false],
    ];
    for (const [z, width, isWindow] of sideSections) {
      addSection(width, false, { x: -WALL_X + 0.0, z, ry: Math.PI / 2 });
      addSection(width, isWindow, { x: WALL_X - 0.0, z, ry: -Math.PI / 2 });
    }
    for (const [x, width] of [[-4.25, 4.3], [0, 4.2], [4.25, 4.3]] as const) {
      addSection(width, false, { x, z: HALL_FRONT_Z, ry: Math.PI });
    }

    const pillarZ = [-6.4, -2.1, 2.0, 6.0];
    const pillarX = WALL_X - 0.45;
    const pillar = (x: number, z: number): void => {
      opaque.add(new CylinderGeometry(0.25, 0.27, HEIGHT, 18), LACQUER, { x, y: HEIGHT / 2, z });
      opaque.add(new CylinderGeometry(0.34, 0.38, 0.28, 18), 0x8b8070, { x, y: 0.14, z });
      opaque.add(new TorusGeometry(0.26, 0.03, 6, 18), GOLD, { x, y: HEIGHT - 0.55, z, rx: Math.PI / 2 });
      opaque.add(new BoxGeometry(0.7, 0.3, 0.7), 0x2f7d6b, { x, y: HEIGHT - 0.2, z });
    };
    for (const z of pillarZ) {
      pillar(-pillarX, z);
      pillar(pillarX, z);
    }
    for (const x of [-pillarX, pillarX]) pillar(x, 7.4);

    const altarWidth = 7.8;
    opaque.add(new BoxGeometry(altarWidth, 0.32, 3.2), LACQUER, { y: 0.16, z: BUDDHA_Z - 0.3 });
    opaque.add(new BoxGeometry(altarWidth + 0.1, 0.05, 3.3), GOLD, { y: 0.34, z: BUDDHA_Z - 0.3 });
    opaque.add(new BoxGeometry(6.8, 0.26, 2.6), 0x7a2418, { y: 0.32 + 0.13 + 0.02, z: BUDDHA_Z - 0.3 });
    opaque.add(new BoxGeometry(6.9, 0.05, 2.7), GOLD, { y: ALTAR_TOP - 0.01, z: BUDDHA_Z - 0.3 });
    for (let i = 0; i < 7; i += 1) {
      opaque.add(new BoxGeometry(0.6, 0.18, 0.04), GOLD_ACCENT[i % GOLD_ACCENT.length] as number, {
        x: -3.0 + i * 1.0,
        y: 0.16,
        z: BUDDHA_Z - 0.3 + 1.61,
      });
    }

    opaque.add(
      new LatheGeometry(
        [new Vector2(0.001, 0), new Vector2(0.24, 0.02), new Vector2(0.3, 0.1), new Vector2(0.24, 0.2), new Vector2(0.3, 0.26), new Vector2(0.27, 0.28), new Vector2(0.001, 0.26)],
        20,
      ),
      0x8a6428,
      { y: ALTAR_TOP, z: BUDDHA_Z + 0.85 },
    );
    for (const [x, z] of CANDLE_SPOTS) {
      opaque.add(new CylinderGeometry(0.13, 0.15, 0.06, 12), 0x8a6428, { x, y: ALTAR_TOP + 0.03, z });
      opaque.add(new CylinderGeometry(0.05, 0.055, 0.34, 10), 0xf6ecd8, { x, y: ALTAR_TOP + 0.23, z });
      opaque.add(new CylinderGeometry(0.004, 0.004, 0.05, 4), 0x2b1a12, { x, y: ALTAR_TOP + 0.425, z });
    }

    return { opaque: opaque.build(), paper: paper.build() };
  }

  private buildBeams(): void {
    const b = new GeometryBuilder();
    b.add(new BoxGeometry(HALL_HALF_WIDTH * 2 + 1.4, 0.3, HALL_FRONT_Z - BACK_Z + 1.4), 0x33200f, { y: HEIGHT + 0.15, z: (HALL_FRONT_Z + BACK_Z) / 2 });
    for (const z of [-6.4, -2.1, 2.0, 6.0, 7.4]) {
      b.add(new BoxGeometry(HALL_HALF_WIDTH * 2, 0.42, 0.36), WOOD_DARK, { y: HEIGHT - 0.55, z });
      b.add(new BoxGeometry(HALL_HALF_WIDTH * 2, 0.07, 0.4), 0x2f7d6b, { y: HEIGHT - 0.8, z });
      b.add(new BoxGeometry(HALL_HALF_WIDTH * 2, 0.05, 0.4), 0xc43d2d, { y: HEIGHT - 0.87, z });
    }
    for (const x of [-WALL_X + 0.45, -3.4, 0, 3.4, WALL_X - 0.45]) {
      b.add(new BoxGeometry(0.34, 0.42, HALL_FRONT_Z - BACK_Z), WOOD_MID, { x, y: HEIGHT - 0.2, z: (HALL_FRONT_Z + BACK_Z) / 2 });
    }
    const beams = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));
    beams.name = "beams";
    this.group.add(beams);

    const lanterns = new GeometryBuilder();
    lanterns.add(
      new LatheGeometry(
        [new Vector2(0.001, -0.3), new Vector2(0.12, -0.28), new Vector2(0.24, -0.15), new Vector2(0.28, 0), new Vector2(0.24, 0.15), new Vector2(0.12, 0.28), new Vector2(0.001, 0.3)],
        14,
      ),
      0xffffff,
    );
    lanterns.add(new CylinderGeometry(0.1, 0.1, 0.06, 10), 0x4a2c18, { y: 0.31 });
    lanterns.add(new CylinderGeometry(0.012, 0.012, 1.3, 4), 0x4a2c18, { y: 0.99 });
    lanterns.add(new CylinderGeometry(0.07, 0.01, 0.34, 6), 0xe6b43c, { y: -0.47 });
    const spots: Array<[number, number]> = [];
    for (const x of [-4.4, -1.5, 1.5, 4.4]) {
      for (const z of [-3.2, 0.8, 4.8]) spots.push([x, z]);
    }
    const lanternMesh = new InstancedMesh(lanterns.build(), new MeshBasicMaterial({ vertexColors: true, fog: false }), spots.length);
    const palette = [0xff8a5a, 0xffc15a, 0xff7a8a, 0xffd88a];
    const m = new Matrix4();
    const color = new Color();
    spots.forEach(([x, z], i) => {
      lanternMesh.setMatrixAt(i, m.makeTranslation(x, 4.5 + ((i * 7) % 3) * 0.12, z));
      lanternMesh.setColorAt(i, color.setHex(palette[i % palette.length] as number));
    });
    lanternMesh.name = "lanterns";
    lanternMesh.frustumCulled = false;
    this.group.add(lanternMesh);
  }

  private buildOutdoors(): void {
    const skyMap = skyTexture();
    this.textures.push(skyMap);
    const sky = new Mesh(new PlaneGeometry(70, 16), new MeshBasicMaterial({ map: skyMap, fog: false, toneMapped: false }));
    sky.position.set(32, 5.5, 0);
    sky.rotation.y = -Math.PI / 2;
    sky.name = "sky";
    this.group.add(sky);

    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshLambertMaterial({ color: 0x5b7640 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(30, -0.06, 0);
    ground.name = "ground";
    this.group.add(ground);

    const rand = mulberry32(11);
    const trees = new GeometryBuilder();
    const foliage = [0xd8602f, 0xe3a23a, 0x4f8040, 0x3d6b3a, 0xc2432b];
    for (let i = 0; i < 16; i += 1) {
      const x = 9.5 + rand() * 11;
      const z = -9 + rand() * 18;
      const size = 0.8 + rand() * 0.9;
      const tone = foliage[Math.floor(rand() * foliage.length)] as number;
      trees.add(new CylinderGeometry(0.12 * size, 0.18 * size, 2.2 * size, 6), 0x4a3020, { x, y: 1.1 * size, z });
      trees.add(new IcosahedronGeometry(1.15 * size, 1), tone, { x, y: 2.9 * size, z, sy: 1.15 });
      trees.add(new IcosahedronGeometry(0.8 * size, 1), tone, { x: x + 0.6 * size, y: 2.3 * size, z: z + 0.3 * size });
    }
    for (let i = 0; i < 6; i += 1) {
      const x = 8.6 + rand() * 3;
      const z = -4 + rand() * 8;
      trees.add(new ConeGeometry(0.7, 2.2, 7), 0x2f5d3a, { x, y: 1.1, z });
    }
    const treeMesh = new Mesh(trees.build(), new MeshLambertMaterial({ vertexColors: true }));
    treeMesh.name = "trees";
    this.group.add(treeMesh);

    const beam = beamGlowTexture();
    this.textures.push(beam);
    const rays = new GeometryBuilder();
    const along = new Vector3().copy(SUN_TARGET).sub(SUN_POSITION).normalize();
    const length = 11;
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along.clone().negate());
    for (const z of [-1.5, -0.1, 1.3]) {
      for (const twist of [0, Math.PI / 2]) {
        const plane = new PlaneGeometry(0.9, length);
        plane.rotateY(twist);
        plane.translate(0, -length / 2, 0);
        plane.applyQuaternion(quat);
        plane.translate(WALL_X - 0.2, 2.8, z);
        rays.add(plane, 0xfff0c8);
      }
    }
    const rayMesh = new Mesh(
      rays.build(),
      new MeshBasicMaterial({ map: beam, transparent: true, opacity: 0.32, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, vertexColors: true, fog: false }),
    );
    rayMesh.name = "sunbeams";
    this.group.add(rayMesh);
  }

  private buildCushions(anisotropy: number): { body: InstancedMesh; top: InstancedMesh } {
    const map = cushionTexture(anisotropy);
    this.textures.push(map);
    const bodyGeometry = new CylinderGeometry(0.42, 0.46, 0.12, 28);
    bodyGeometry.translate(0, 0.06, 0);
    const body = new InstancedMesh(bodyGeometry, new MeshLambertMaterial({ color: 0xb87a22 }), CUSHION_SPOTS.length);
    const topGeometry = new CircleGeometry(0.4, 28);
    topGeometry.rotateX(-Math.PI / 2);
    topGeometry.translate(0, 0.122, 0);
    const top = new InstancedMesh(topGeometry, new MeshLambertMaterial({ map }), CUSHION_SPOTS.length);
    for (const mesh of [body, top]) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(CUSHION_SPOTS.length * 3).fill(1), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.castShadow = mesh === body;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
    body.name = "cushion-body";
    top.name = "cushion-top";
    const m = new Matrix4();
    for (const spot of CUSHION_SPOTS) {
      m.makeTranslation(spot.x, 0, spot.z);
      body.setMatrixAt(spot.id, m);
      top.setMatrixAt(spot.id, m);
    }
    this.group.add(body, top);
    return { body, top };
  }

  private buildCandles(): InstancedMesh {
    const map = flameGlowTexture();
    this.textures.push(map);
    const flames = new InstancedMesh(
      new PlaneGeometry(0.5, 0.62),
      new MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }),
      CANDLE_SPOTS.length,
    );
    flames.frustumCulled = false;
    flames.name = "flames";
    this.group.add(flames);
    return flames;
  }

  setOccupied(cushionId: number, occupied: boolean): void {
    if (cushionId < 0 || cushionId >= CUSHION_SPOTS.length) return;
    if (occupied === this.occupied.has(cushionId)) return;
    if (occupied) this.occupied.add(cushionId);
    else this.occupied.delete(cushionId);
    this.tint.setScalar(occupied ? 0.55 : 1);
    for (const mesh of [this.cushionBody, this.cushionTop]) {
      mesh.setColorAt(cushionId, this.tint);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  update(time: number, camera: Camera | null, reduceMotion: boolean): void {
    const flicker = reduceMotion ? 0.35 : 1;
    const base = this.tmpPos;
    for (let i = 0; i < CANDLE_SPOTS.length; i += 1) {
      const [x, z] = CANDLE_SPOTS[i] as readonly [number, number];
      const wobble = 0.92 + flicker * (0.09 * Math.sin(time * 9 + i * 1.7) + 0.05 * Math.sin(time * 17 + i * 3.1));
      base.set(x, ALTAR_TOP + 0.56, z);
      if (camera) this.tmpQuat.copy(camera.quaternion);
      else this.tmpQuat.identity();
      this.tmpScale.set(wobble * 0.9, wobble, 1);
      this.tmpMatrix.compose(base, this.tmpQuat, this.tmpScale);
      this.flames.setMatrixAt(i, this.tmpMatrix);
    }
    this.flames.instanceMatrix.needsUpdate = true;

    this.candleLight.intensity = 9 * (0.93 + flicker * (0.07 * Math.sin(time * 7.3) + 0.04 * Math.sin(time * 13.1 + 1)));
    this.buddha.glow.scale.setScalar(1 + (reduceMotion ? 0 : 0.015 * Math.sin(time * 0.9)));

    const count = this.dustSeeds.length / 4;
    const attribute = this.dust.geometry.getAttribute("position") as BufferAttribute;
    const drift = reduceMotion ? 0 : time;
    for (let i = 0; i < count; i += 1) {
      const phase = this.dustSeeds[i * 4] as number;
      const speed = this.dustSeeds[i * 4 + 1] as number;
      const a = this.dustSeeds[i * 4 + 2] as number;
      const c = this.dustSeeds[i * 4 + 3] as number;
      const along = (a + drift * 0.012 * speed) % 1;
      attribute.setXYZ(
        i,
        6 - along * 8 + Math.sin(drift * 0.3 * speed + phase) * 0.4,
        3.4 - along * 3.1 + Math.sin(drift * 0.5 * speed + phase * 2) * 0.35 + c * 0.6,
        -2 + c * 4.6 + along * 1.4 + Math.cos(drift * 0.25 * speed + phase) * 0.4,
      );
    }
    attribute.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else if (material) material.dispose();
    });
    this.buddha.dispose();
    for (const texture of this.textures) texture.dispose();
    this.environment.dispose();
    this.group.removeFromParent();
  }
}
