import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NoBlending,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from "three";
import { GATBAWI_SEATS, GATBAWI_Z, PLATFORM, SEAT_COUNT, SEAT_YAWS, SEA_LINE_X, SHORE } from "@dongjane/shared";
import { type ModelMeshes, headOf, normalOf, textureOf } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import { GATBAWI_STATUE, MOON_DIRECTION, SHADOW_HALF_EXTENT, SKY_RADIUS, SUN_POSITION, SUN_TARGET } from "./landscape-layout.ts";
import { Precipitation } from "./precipitation.ts";
import { DAY_LOOK, type SkyLook, cloneLook, easeLook, packRgb } from "./sky-look.ts";
import { cloudTexture, discGlowTexture, flakeTexture, foamTexture, leafTexture, mulberry32, seaTexture, stagePosterTexture } from "./textures.ts";
import { CANOPY, lanternSpots, screenUv } from "./venue-layout.ts";
import type { FloorSurfaces } from "./floor-pick.ts";
import { WATER_Y, buildSand, buildSea, carveGround, withoutEastHillside } from "./shore.ts";
import { vertexGlowMaterial } from "./vertex-glow.ts";

export interface LandscapeQuality {
  shadows: boolean;
  shadowMapSize: number;
  leaves: number;
  precipitation: number;
  anisotropy: number;
  lanterns: number;
  weak: boolean;
}

interface Shadows {
  cast?: boolean;
  receive?: boolean;
}

// A change of weather or hour takes this long to show.
const SKY_EASE_SECONDS = 1.5;
const SKY_VISIBLE = 0.004;
const REDUCED_PRECIPITATION_MOTION = 0.1;
const CLOUD_TURN_PER_SECOND = 0.004;
const STAR_COUNT = 260;
const SUN_DISTANCE = 58;

// The photographed stone, ground and straw come out darker than the colours painted on them, so each is lifted. The scanned
// Buddha is only a grey picture of light and shade, tinted granite, and is lifted the same way.
const LIFT = { ground: 1.35, stone: 1.5, mat: 1.35, statue: 1.5 } as const;

// The paper lanterns glow a little by day and fully at night.
const LANTERN_GLOW = { day: 0.12, night: 1.1 } as const;

// At night a warm light hangs `drop` metres under the canopy in each of these bays (corner poles, by index), so the plaza, the stage
// and the statue take the lanterns' light. The count is fixed: a light that comes or goes recompiles every material.
const LANTERN_LIGHT = { intensity: 24, distance: 17, decay: 2, drop: 1 } as const;
const LANTERN_BAYS = [
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [4, 5, 9, 8],
] as const;

const LEAF_AREA = { minX: -10, spanX: 22, minZ: -2, spanZ: 17, top: 8, floor: 0.05 } as const;
const LEAF_FALL_PER_SECOND = 0.05;
const LEAF_WIND = 3;
const LEAF_SIZE = 0.2;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
varying vec3 vDirection;
void main() {
  float height = clamp(vDirection.y, 0.0, 1.0);
  vec3 color = mix(uHorizon, uMid, smoothstep(0.0, 0.32, height));
  color = mix(color, uTop, smoothstep(0.18, 0.95, height));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

// A soft gradient of sky above and ground below, which the statue's stone reflects faintly.
function buildEnvironment(renderer: WebGLRenderer): Texture {
  const { scene: palette } = THEME;
  const scene = new Scene();
  const dome = new SphereGeometry(10, 24, 16);
  const position = dome.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const top = new Color(palette.envTop);
  const mid = new Color(palette.envMid);
  const low = new Color(palette.envLow);
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
  const domeMaterial = new MeshBasicMaterial({ vertexColors: true, side: BackSide });
  scene.add(new Mesh(dome, domeMaterial));

  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.03);
  generator.dispose();
  dome.dispose();
  domeMaterial.dispose();
  return target.texture;
}

// Either the picture of the lanterns, or a hole the renderer leaves empty so the video behind the canvas shows through.
export type ScreenMode = "poster" | "video";

// One band of surf along the waterline; `phase` (radians) keeps two bands from rising together.
interface FoamStrip {
  readonly mesh: Mesh;
  readonly material: MeshLambertMaterial;
  readonly phase: number;
}

const SURF_SECONDS = 8;
const SURF_SWING = 0.9;
const SURF_WIDTH = 1.3;
const SURF_TILE = 2.4;
const SEA_DRIFT_PER_SECOND = 0.009;
const SEA_SWAY = 0.04;
const SEA_SWAY_PER_SECOND = 0.07;
const FOAM_LIFT = 0.03;

export class Landscape {
  readonly group = new Group();
  readonly sun: DirectionalLight;
  // The 법당's front wall and roof: the parts that stand between the camera and the people inside.
  readonly dharmaFront: Mesh;
  readonly dharmaRoof: Mesh;
  // The open ground a tap can walk to, and what stands on it.
  readonly surfaces: FloorSurfaces;

  private readonly environment: Texture;
  private readonly hemisphere: HemisphereLight;
  private readonly sky = new Group();
  private readonly skyMaterial: ShaderMaterial;
  private readonly clouds: Mesh;
  private readonly stars: Points;
  private readonly sunSprite: Sprite;
  private readonly moonSprite: Sprite;
  private readonly precipitation: Precipitation;
  private readonly leaves: Points;
  private readonly leafSeeds: Float32Array;
  private readonly mats: InstancedMesh;
  private readonly lanternMaterial: MeshLambertMaterial;
  private readonly lanternLights: readonly PointLight[];
  private readonly screen: Mesh;
  private readonly screenPoster: MeshBasicMaterial;
  private readonly screenHole: MeshBasicMaterial;
  private readonly envMaterials: MeshStandardMaterial[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly sea: Texture;
  private readonly foam: readonly FoamStrip[];
  private readonly weak: boolean;
  private readonly occupied = new Set<number>();
  private readonly tint = new Color();
  private readonly sunDirection = new Vector3(...SUN_POSITION).normalize();
  private readonly moonDirection = new Vector3(...MOON_DIRECTION).normalize();
  private target: SkyLook = cloneLook(DAY_LOOK);
  private current: SkyLook = cloneLook(DAY_LOOK);
  private skyKnown = false;
  private cloudTurn = 0;
  private indoor = 0;

  constructor(
    renderer: WebGLRenderer,
    quality: LandscapeQuality,
    world: ModelMeshes<"world">,
    gatbawi: ModelMeshes<"gatbawi">,
    buddha: ModelMeshes<"buddha">,
    venue: ModelMeshes<"venue">,
  ) {
    const { scene: palette, material: tokens } = THEME;
    this.group.name = "landscape";
    this.environment = buildEnvironment(renderer);
    const { anisotropy } = quality;

    this.hemisphere = new HemisphereLight(packRgb(DAY_LOOK.hemisphereSky), packRgb(DAY_LOOK.hemisphereGround), DAY_LOOK.hemisphereIntensity);
    this.group.add(this.hemisphere);

    this.sun = new DirectionalLight(packRgb(DAY_LOOK.sunColor), DAY_LOOK.sunIntensity);
    this.sun.position.set(...SUN_POSITION);
    this.sun.target.position.set(...SUN_TARGET);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const camera = this.sun.shadow.camera;
      camera.left = -SHADOW_HALF_EXTENT;
      camera.right = SHADOW_HALF_EXTENT;
      camera.top = SHADOW_HALF_EXTENT;
      camera.bottom = -SHADOW_HALF_EXTENT;
      camera.near = 2;
      camera.far = 45;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.035;
    }
    this.group.add(this.sun, this.sun.target);

    this.skyMaterial = new ShaderMaterial({
      uniforms: { uTop: { value: new Color() }, uMid: { value: new Color() }, uHorizon: { value: new Color() } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const dome = new Mesh(this.track(new SphereGeometry(SKY_RADIUS, 32, 16)), this.skyMaterial);
    dome.name = "sky";
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.materials.push(this.skyMaterial);
    this.sky.add(dome);

    const cloudMap = this.texture(cloudTexture());
    const cloudMaterial = new MeshBasicMaterial({ map: cloudMap, transparent: true, opacity: 0, depthWrite: false, side: BackSide, fog: false, toneMapped: false });
    this.materials.push(cloudMaterial);
    this.clouds = new Mesh(this.track(new SphereGeometry(SKY_RADIUS * 0.96, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2)), cloudMaterial);
    this.clouds.name = "clouds";
    this.clouds.renderOrder = -1;
    this.clouds.frustumCulled = false;
    this.clouds.visible = false;
    this.sky.add(this.clouds);

    this.stars = this.buildStars(palette.star);
    this.sky.add(this.stars);

    const disc = this.texture(discGlowTexture());
    this.sunSprite = this.buildDisc(disc, 13, this.sunDirection);
    this.moonSprite = this.buildDisc(disc, 7, this.moonDirection);
    this.moonSprite.material.color.set(palette.moon);
    this.sky.add(this.sunSprite, this.moonSprite);
    this.group.add(this.sky);

    const statue = this.buildStatue(gatbawi, buddha.buddha, world.rocks, anisotropy);
    this.group.add(statue);
    const ground = this.add(this.derived(world.ground, carveGround(world.ground.geometry)), this.surface(world.ground, anisotropy, LIFT.ground), { receive: true });
    const steps = this.add(world.steps, this.surface(world.steps, anisotropy, LIFT.stone), { cast: true, receive: true });
    const rocks = this.add(this.derived(world.rocks, withoutEastHillside(world.rocks.geometry)), this.surface(world.rocks, anisotropy, LIFT.stone), { cast: true, receive: true });
    const pine = this.add(this.derived(world.pine, withoutEastHillside(world.pine.geometry)), new MeshLambertMaterial({ vertexColors: true }), { cast: true });
    const maple = this.add(this.derived(world.maple, withoutEastHillside(world.maple.geometry)), new MeshLambertMaterial({ vertexColors: true }), { cast: true });
    // The 법당 stands outside the sun's shadow box, which is cut round the plaza, so its walls take no shadows and give none.
    const dharmaBase = this.add(world.dharmaBase, new MeshLambertMaterial({ vertexColors: true }));
    const dharmaWalls = this.add(world.dharmaWalls, new MeshLambertMaterial({ vertexColors: true }));
    this.dharmaFront = this.add(world.dharmaFront, new MeshLambertMaterial({ vertexColors: true }));
    this.dharmaRoof = this.add(world.dharmaRoof, new MeshLambertMaterial({ vertexColors: true }));

    this.mats = this.buildMats(world.mat, anisotropy);
    this.group.add(this.mats);

    const shore = this.buildShore(quality.weak);
    this.sea = shore.sea;
    this.foam = shore.foam;
    this.weak = quality.weak;
    this.group.add(shore.group);

    const stage = new Group();
    stage.name = "venue";
    const stageFloor = this.add(venue.stage, new MeshLambertMaterial({ vertexColors: true }), { cast: true, receive: true }, stage);
    const truss = this.add(venue.truss, new MeshLambertMaterial({ vertexColors: true }), { cast: true }, stage);
    const poles = this.add(venue.poles, new MeshLambertMaterial({ vertexColors: true }), { cast: true }, stage);
    const poster = this.texture(stagePosterTexture());
    poster.anisotropy = anisotropy;
    this.screenPoster = new MeshBasicMaterial({ map: poster, fog: false, toneMapped: false });
    this.screenHole = new MeshBasicMaterial({ opacity: 0, blending: NoBlending, fog: false, toneMapped: false });
    this.screenHole.color.setScalar(0);
    this.materials.push(this.screenHole);
    this.screen = this.add(this.withPicture(venue.screen), this.screenPoster, {}, stage);
    this.lanternMaterial = this.lanternSurface();
    stage.add(this.buildLanterns(venue.lantern, quality.lanterns, [palette.lanternPink, palette.lanternWhite, palette.lanternYellow, palette.lanternOrange, palette.lanternGreen, palette.lanternViolet]));
    this.group.add(stage);

    this.lanternLights = LANTERN_BAYS.map((bay) => {
      const middle = (axis: 0 | 1): number => bay.reduce<number>((sum, pole) => sum + CANOPY.poles[pole][axis], 0) / bay.length;
      const light = new PointLight(palette.envLamp, 0, LANTERN_LIGHT.distance, LANTERN_LIGHT.decay);
      light.position.set(middle(0), CANOPY.height - LANTERN_LIGHT.drop, middle(1));
      this.group.add(light);
      return light;
    });

    // The ground, the steps, the 법당's plinth and the sand are floor; the sea is not, and the front wall and the roof only count
    // while they are drawn.
    this.surfaces = {
      floors: [ground, steps, dharmaBase, shore.sand],
      blockers: [statue, rocks, pine, maple, dharmaWalls, this.dharmaFront, this.dharmaRoof, stageFloor, truss, poles, this.screen],
    };

    const flake = this.texture(flakeTexture());
    this.precipitation = new Precipitation(quality.precipitation, flake);
    this.group.add(this.precipitation.group);

    this.leafSeeds = new Float32Array(quality.leaves * 5);
    const rand = mulberry32(31);
    for (let i = 0; i < this.leafSeeds.length; i += 1) this.leafSeeds[i] = rand();
    this.leaves = this.buildLeaves(quality.leaves, [tokens.maple, tokens.leafRed, tokens.ginkgo, tokens.litter]);
    this.group.add(this.leaves);

    this.applyLook(this.current);
    this.update(0, 0, null, true, { x: 0, z: 0 });
  }

  // The glb's screen is a bare quad; this copy also knows which part of the picture each corner shows.
  private withPicture(source: Mesh): Mesh {
    const geometry = this.track(source.geometry.clone());
    const position = geometry.getAttribute("position");
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i += 1) {
      const { u, v } = screenUv({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    const copy = new Mesh(geometry);
    copy.name = source.name;
    return copy;
  }

  setScreenMode(mode: ScreenMode): void {
    this.screen.material = mode === "video" ? this.screenHole : this.screenPoster;
  }

  private track(geometry: BufferGeometry): BufferGeometry {
    this.geometries.push(geometry);
    return geometry;
  }

  private texture<T extends Texture>(texture: T): T {
    this.textures.push(texture);
    return texture;
  }

  private add(source: Mesh, material: Material, shadows: Shadows = {}, parent: Group = this.group): Mesh {
    const mesh = new Mesh(source.geometry, material);
    mesh.name = source.name;
    mesh.castShadow = shadows.cast ?? false;
    mesh.receiveShadow = shadows.receive ?? false;
    this.materials.push(material);
    parent.add(mesh);
    return mesh;
  }

  // The photograph and, when the glb has one, its normal map, times the colours painted into the vertices.
  private surface(source: Mesh, anisotropy: number, lift: number): MeshLambertMaterial {
    const map = textureOf(source);
    const normalMap = normalOf(source);
    map.anisotropy = anisotropy;
    if (normalMap) normalMap.anisotropy = anisotropy;
    const material = new MeshLambertMaterial({ map, normalMap, vertexColors: true });
    material.color.setScalar(lift);
    return material;
  }

  private stoneOf(source: Mesh, anisotropy: number): MeshStandardMaterial {
    const map = textureOf(source);
    const normalMap = normalOf(source);
    map.anisotropy = anisotropy;
    if (normalMap) normalMap.anisotropy = anisotropy;
    const material = new MeshStandardMaterial({ map, normalMap, vertexColors: true, roughness: 0.92, metalness: 0, envMap: this.environment });
    material.color.setScalar(LIFT.stone);
    this.envMaterials.push(material);
    return material;
  }

  private granite(source: Mesh, anisotropy: number): MeshLambertMaterial {
    const map = textureOf(source);
    map.anisotropy = anisotropy;
    const material = new MeshLambertMaterial({ map });
    material.color.set(THEME.material.granite).multiplyScalar(LIFT.statue);
    return material;
  }

  // Gatbawi stands on the platform; the glb draws the pedestal around the middle of its foot, and its hat stone and pedestal wear
  // the rock picture of the world's `rocks` (`rock`), which the glb of the statue does not repeat. The scanned Buddha is scaled to
  // the statue's height and seated on the pedestal's top; the hat stone, drawn one metre in radius, is scaled to the Buddha's
  // head (the glb says where it is) and set on the crown, its underside sunk a little so the topknot is under it.
  private buildStatue(meshes: ModelMeshes<"gatbawi">, scan: Mesh, rock: Mesh, anisotropy: number): Group {
    const statue = new Group();
    statue.name = "gatbawi";
    statue.position.set(0, PLATFORM.topY, GATBAWI_Z);
    const { height, seatY, seatZ, hatHeads, hatSink } = GATBAWI_STATUE;
    const figure = this.add(scan, this.granite(scan, anisotropy), { cast: true, receive: true }, statue);
    figure.scale.setScalar(height);
    figure.position.set(0, seatY, seatZ);
    const head = headOf(scan);
    const hat = this.add(meshes.hatStone, this.stoneOf(rock, anisotropy), { cast: true, receive: true }, statue);
    hat.scale.setScalar(hatHeads * head.radius * height);
    hat.position.set(head.top[0] * height, seatY + (head.top[1] - hatSink * head.radius) * height, seatZ + head.top[2] * height);
    this.add(meshes.pedestal, this.stoneOf(rock, anisotropy), { cast: true, receive: true }, statue);
    const offerings = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMap: this.environment });
    this.envMaterials.push(offerings);
    this.add(meshes.offerings, offerings, { cast: true, receive: true }, statue);
    return statue;
  }

  private buildMats(source: Mesh, anisotropy: number): InstancedMesh {
    const material = this.surface(source, anisotropy, LIFT.mat);
    this.materials.push(material);
    const mats = new InstancedMesh(source.geometry, material, SEAT_COUNT);
    mats.instanceColor = new InstancedBufferAttribute(new Float32Array(SEAT_COUNT * 3).fill(1), 3);
    mats.instanceColor.setUsage(DynamicDrawUsage);
    mats.receiveShadow = true;
    mats.frustumCulled = false;
    mats.name = "mats";
    const m = new Matrix4();
    for (const spot of GATBAWI_SEATS) {
      m.makeRotationY(SEAT_YAWS.gatbawi).setPosition(spot.x, 0, spot.z);
      mats.setMatrixAt(spot.id, m);
    }
    return mats;
  }

  // The sand and the sea lie on the baked ground. The sand is floor and takes shadows; the sea is not floor and casts none, and the
  // bands of surf run along the waterline over the edge of both.
  private buildShore(weak: boolean): { group: Group; sand: Mesh; sea: Texture; foam: FoamStrip[] } {
    const group = new Group();
    group.name = "shore";
    const sandMaterial = new MeshLambertMaterial({ vertexColors: true, transparent: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.materials.push(sandMaterial);
    const sand = new Mesh(this.track(buildSand()), sandMaterial);
    sand.name = "sand";
    sand.receiveShadow = true;
    sand.renderOrder = 1;
    group.add(sand);

    const sea = this.texture(seaTexture());
    const seaMaterial = new MeshLambertMaterial({ vertexColors: true, map: sea, transparent: !weak, depthWrite: weak });
    this.materials.push(seaMaterial);
    const water = new Mesh(this.track(buildSea(weak)), seaMaterial);
    water.name = "sea";
    water.renderOrder = 2;
    water.frustumCulled = false;
    group.add(water);

    const length = SHORE.maxZ - SHORE.minZ;
    const foamMap = this.texture(foamTexture());
    foamMap.repeat.set(1, length / SURF_TILE);
    const strip = this.track(new PlaneGeometry(SURF_WIDTH, length).rotateX(-Math.PI / 2));
    const foam: FoamStrip[] = [];
    for (const phase of weak ? [0] : [0, 2.4]) {
      const material = new MeshLambertMaterial({ map: foamMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.materials.push(material);
      const mesh = new Mesh(strip, material);
      mesh.name = "surf";
      mesh.renderOrder = 3;
      mesh.position.set(SEA_LINE_X, WATER_Y + FOAM_LIFT, (SHORE.minZ + SHORE.maxZ) / 2);
      group.add(mesh);
      foam.push({ mesh, material, phase });
    }
    return { group, sand, sea, foam };
  }

  // The same geometry-and-name shell as `source`, around a geometry the landscape cut from it.
  private derived(source: Mesh, geometry: BufferGeometry): Mesh {
    const copy = new Mesh(this.track(geometry), source.material);
    copy.name = source.name;
    return copy;
  }

  // Each lantern's colour multiplies both the light it takes and the light it gives, so the paper glows in its own tint.
  private lanternSurface(): MeshLambertMaterial {
    const material = vertexGlowMaterial(THEME.material.paper, LANTERN_GLOW.day);
    this.materials.push(material);
    return material;
  }

  // Every lantern the device can afford, spread evenly over the strings.
  private buildLanterns(source: Mesh, limit: number, tones: readonly string[]): InstancedMesh {
    const all = lanternSpots();
    const step = Math.max(1, Math.ceil(all.length / limit));
    const spots = all.filter((_, index) => index % step === 0);
    const lanterns = new InstancedMesh(source.geometry, this.lanternMaterial, spots.length);
    const m = new Matrix4();
    const color = new Color();
    spots.forEach((spot, index) => {
      m.makeRotationY(spot.yaw).scale(new Vector3(spot.scale, spot.scale, spot.scale)).setPosition(spot.x, spot.y, spot.z);
      lanterns.setMatrixAt(index, m);
      lanterns.setColorAt(index, color.set(tones[Math.min(tones.length - 1, Math.floor(spot.tone * tones.length))] as string));
    });
    lanterns.name = "lanterns";
    lanterns.frustumCulled = false;
    return lanterns;
  }

  private buildStars(hex: string): Points {
    const rand = mulberry32(5);
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const height = 0.12 + rand() * 0.88;
      const turn = rand() * Math.PI * 2;
      const ring = Math.sqrt(1 - height * height);
      positions[i * 3] = Math.cos(turn) * ring * SKY_RADIUS * 0.94;
      positions[i * 3 + 1] = height * SKY_RADIUS * 0.94;
      positions[i * 3 + 2] = Math.sin(turn) * ring * SKY_RADIUS * 0.94;
    }
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const material = new PointsMaterial({ color: hex, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    this.materials.push(material);
    const stars = new Points(geometry, material);
    stars.name = "stars";
    stars.renderOrder = -2;
    stars.frustumCulled = false;
    stars.visible = false;
    return stars;
  }

  private buildDisc(map: Texture, size: number, direction: Vector3): Sprite {
    const material = new SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    this.materials.push(material);
    const sprite = new Sprite(material);
    sprite.position.copy(direction).multiplyScalar(SUN_DISTANCE);
    sprite.scale.setScalar(size);
    sprite.renderOrder = -3;
    sprite.frustumCulled = false;
    sprite.visible = false;
    return sprite;
  }

  private buildLeaves(count: number, tones: readonly string[]): Points {
    const map = this.texture(leafTexture());
    const geometry = this.track(new BufferGeometry());
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
    const colors = new Float32Array(count * 3);
    const color = new Color();
    for (let i = 0; i < count; i += 1) {
      const tone = tones[Math.floor((this.leafSeeds[i * 5 + 4] as number) * tones.length)] as string;
      color.set(tone);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    const material = new PointsMaterial({ map, size: LEAF_SIZE, vertexColors: true, alphaTest: 0.4 });
    this.materials.push(material);
    const leaves = new Points(geometry, material);
    leaves.name = "leaves";
    leaves.frustumCulled = false;
    return leaves;
  }

  setOccupied(seatId: number, occupied: boolean): void {
    if (seatId < 0 || seatId >= SEAT_COUNT) return;
    if (occupied === this.occupied.has(seatId)) return;
    if (occupied) this.occupied.add(seatId);
    else this.occupied.delete(seatId);
    this.tint.setScalar(occupied ? 0.55 : 1);
    this.mats.setColorAt(seatId, this.tint);
    if (this.mats.instanceColor) this.mats.instanceColor.needsUpdate = true;
  }

  get look(): SkyLook {
    return this.current;
  }

  // How much of the camera's world is the 법당's inside, 0 to 1: the sun, the sky's light, the weather and the leaves give way
  // to the room's own lights, which the room itself turns up by the same amount.
  setIndoor(share: number): void {
    this.indoor = share;
  }

  // The front wall and the roof are hidden while the camera looks into the room from outside it.
  setCutaway(cut: boolean): void {
    this.dharmaFront.visible = !cut;
    this.dharmaRoof.visible = !cut;
  }

  // The first look snaps so the world never opens on the wrong hour; later ones ease in.
  setSky(look: SkyLook): void {
    this.target = look;
    if (this.skyKnown) return;
    this.skyKnown = true;
    this.current = cloneLook(look);
  }

  update(time: number, dt: number, camera: Camera | null, reduceMotion: boolean, focus: { x: number; z: number }): void {
    if (dt > 0) easeLook(this.current, this.target, 1 - Math.exp(-dt / SKY_EASE_SECONDS));
    const look = this.current;
    this.applyLook(look);
    const open = 1 - this.indoor;
    this.precipitation.update(dt, reduceMotion ? REDUCED_PRECIPITATION_MOTION : 1, look.rain * open, look.snow * open, packRgb(look.precipTint), focus);

    if (camera) this.sky.position.copy(camera.position);
    if (!reduceMotion) this.cloudTurn += dt * CLOUD_TURN_PER_SECOND;
    this.clouds.rotation.y = this.cloudTurn;

    this.driftSea(time, !reduceMotion);

    if (this.leaves.visible) this.driftLeaves(reduceMotion ? 0 : time);
  }

  // The ripples slide over the water and the surf runs up the sand and back. A weak device keeps one band, standing still.
  private driftSea(time: number, moving: boolean): void {
    this.sea.offset.set(moving ? time * SEA_DRIFT_PER_SECOND : 0, moving ? Math.sin(time * SEA_SWAY_PER_SECOND) * SEA_SWAY : 0);
    const running = moving && !this.weak;
    for (const strip of this.foam) {
      const wave = running ? 0.5 + 0.5 * Math.sin((time * Math.PI * 2) / SURF_SECONDS + strip.phase) : 0.5;
      strip.mesh.position.x = SEA_LINE_X + 0.3 + (wave - 0.5) * SURF_SWING;
      strip.material.opacity = 0.2 + 0.6 * wave * wave;
    }
  }

  private applyLook(look: SkyLook): void {
    const open = 1 - this.indoor;
    this.hemisphere.intensity = look.hemisphereIntensity * open;
    this.hemisphere.color.setHex(packRgb(look.hemisphereSky));
    this.hemisphere.groundColor.setHex(packRgb(look.hemisphereGround));
    this.sun.intensity = look.sunIntensity * open;
    this.sun.color.setHex(packRgb(look.sunColor));
    for (const material of this.envMaterials) material.envMapIntensity = look.envIntensity;

    const uniforms = this.skyMaterial.uniforms as Record<"uTop" | "uMid" | "uHorizon", { value: Color }>;
    uniforms.uTop.value.setHex(packRgb(look.skyTop));
    uniforms.uMid.value.setHex(packRgb(look.skyMid));
    uniforms.uHorizon.value.setHex(packRgb(look.fogColor));

    const cloud = this.clouds.material as MeshBasicMaterial;
    cloud.opacity = look.cloudCover;
    cloud.color.setHex(packRgb(look.cloudTint));
    this.clouds.visible = look.cloudCover > SKY_VISIBLE;

    const stars = this.stars.material as PointsMaterial;
    stars.opacity = look.nightSky;
    this.stars.visible = look.nightSky > SKY_VISIBLE;

    this.lanternMaterial.emissiveIntensity = LANTERN_GLOW.day + (LANTERN_GLOW.night - LANTERN_GLOW.day) * look.nightSky;
    for (const light of this.lanternLights) light.intensity = LANTERN_LIGHT.intensity * look.nightSky * open;

    this.sunSprite.material.opacity = look.sunGlow;
    this.sunSprite.material.color.setHex(packRgb(look.sunColor));
    this.sunSprite.visible = look.sunGlow > SKY_VISIBLE;
    this.moonSprite.material.opacity = look.nightSky;
    this.moonSprite.visible = look.nightSky > SKY_VISIBLE;

    const leaves = this.leaves.material as PointsMaterial;
    const fallout = Math.max(look.rain, look.snow);
    leaves.size = LEAF_SIZE * (1 - fallout) * open;
    leaves.color.setScalar(1 - 0.7 * look.nightSky);
    this.leaves.visible = fallout < 0.98 && open > 0.02;
  }

  private driftLeaves(drift: number): void {
    const count = this.leafSeeds.length / 5;
    const attribute = this.leaves.geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      const phase = (this.leafSeeds[i * 5] as number) * Math.PI * 2;
      const speed = 0.6 + (this.leafSeeds[i * 5 + 1] as number) * 0.8;
      const along = ((this.leafSeeds[i * 5 + 2] as number) + drift * LEAF_FALL_PER_SECOND * speed) % 1;
      const across = this.leafSeeds[i * 5 + 3] as number;
      attribute.setXYZ(
        i,
        LEAF_AREA.minX + across * LEAF_AREA.spanX + along * LEAF_WIND + Math.sin(drift * 0.9 * speed + phase) * 0.6,
        LEAF_AREA.floor + (1 - along) * LEAF_AREA.top,
        LEAF_AREA.minZ + ((across * 7.31 + phase) % 1) * LEAF_AREA.spanZ + Math.cos(drift * 0.7 * speed + phase) * 0.5,
      );
    }
    attribute.needsUpdate = true;
  }

  // The geometries and textures that came with the glbs belong to the loaded assets; only what the landscape made is released here.
  dispose(): void {
    this.precipitation.dispose();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    this.mats.dispose();
    this.environment.dispose();
    this.group.removeFromParent();
  }
}
