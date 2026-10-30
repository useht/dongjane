import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DirectionalLight,
  DoubleSide,
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
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from "three";
import { DHARMA_ORIGIN, SEAT_COUNT, SEAT_YAW, ZONE_SEATS } from "@dongjane/shared";
import { type ModelMeshes, textureOf } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import { ALTAR, BUDDHA_AT, BUDDHA_HEIGHT, CANDLE_SPOTS, FLAME_HEIGHT, hangingLanterns } from "./dharma-layout.ts";
import { flameGlowTexture, mulberry32 } from "./textures.ts";
import { vertexGlowMaterial } from "./vertex-glow.ts";

export interface DharmaQuality {
  dust: number;
  shadows: boolean;
  shadowMapSize: number;
}

// The room's air is clear: the fog only has to hide where the walls end.
export const DHARMA_FOG = { near: 40, far: 90 } as const;

const WINDOW_LIGHT_AT = [9, 6.5, 1] as const;
const WINDOW_LIGHT_TARGET = [0, 0, -2] as const;
const SHADOW_HALF_EXTENT = 14;
const CANDLE_LIGHT_AT = [0, ALTAR.topY + 0.95, ALTAR.maxZ + 0.35] as const;
const CANDLE_LIGHT = { intensity: 9, distance: 11, decay: 2 } as const;
const HEMISPHERE_LIGHT = 1.35;
const WINDOW_LIGHT = 1.7;
const LANTERN_GLOW = 0.9;
const MURAL_GLOW = 0.5;
const SEAT_OCCUPIED_TINT = 0.55;
const FLAME_SIZE = { width: 0.34, height: 0.5 } as const;
const DUST_SIZE = 0.09;

// A soft warm room for the gold to reflect, with a window panel on one side and the candles on the other.
function buildEnvironment(renderer: WebGLRenderer): Texture {
  const { scene: palette } = THEME;
  const scene = new Scene();
  const dome = new SphereGeometry(10, 24, 16);
  const position = dome.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const top = new Color(palette.dharmaEnvTop);
  const mid = new Color(palette.dharmaEnvMid);
  const low = new Color(palette.dharmaEnvLow);
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

  const lampGeometry = new PlaneGeometry(5, 4);
  const lampMaterial = new MeshBasicMaterial({ color: new Color(palette.envLamp).multiplyScalar(7), side: DoubleSide });
  const lamp = new Mesh(lampGeometry, lampMaterial);
  lamp.position.set(8, 4, 0);
  lamp.rotation.y = -Math.PI / 2;
  scene.add(lamp);
  const candleGeometry = new PlaneGeometry(3, 2);
  const candleMaterial = new MeshBasicMaterial({ color: new Color(palette.envCandle).multiplyScalar(4), side: DoubleSide });
  const candle = new Mesh(candleGeometry, candleMaterial);
  candle.position.set(0, 2, 8);
  candle.rotation.y = Math.PI;
  scene.add(candle);

  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.03);
  generator.dispose();
  for (const geometry of [dome, lampGeometry, candleGeometry]) geometry.dispose();
  for (const material of [domeMaterial, lampMaterial, candleMaterial]) material.dispose();
  return target.texture;
}

// The glow breathes by scale, so it needs its own origin at the middle of the disc.
function centredGlow(source: Mesh): { geometry: BufferGeometry; centre: Vector3 } {
  const geometry = source.geometry.clone();
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
  geometry.translate(-centre.x, -centre.y, -centre.z);
  return { geometry, centre };
}

// The 법당's inside: the room, the Buddha on his altar, fifty floor seats. It is modelled around its own origin and its group
// stands at DHARMA_ORIGIN in the world. It owns its own lights and never looks at the sky, so the weather and the hour
// outside change nothing in here. The lights stay in the scene all the time (adding or removing one would recompile every
// material); `setPresence` turns them up as the camera comes in and down as it goes out.
export class DharmaScene {
  readonly group = new Group();

  private readonly environment: Texture;
  private readonly hemisphere: HemisphereLight;
  private readonly windowLight: DirectionalLight;
  private readonly candleLight: PointLight;
  private readonly flames: InstancedMesh;
  private readonly seats: InstancedMesh;
  private readonly lanterns: InstancedMesh;
  private readonly glowMesh: Mesh;
  private readonly dust: Points;
  private readonly dustSeeds: Float32Array;
  private readonly glowTexture: Texture;
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly occupied = new Set<number>();
  private readonly tint = new Color();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly tmpPos = new Vector3();
  private presence = 0;

  constructor(renderer: WebGLRenderer, quality: DharmaQuality, meshes: ModelMeshes<"dharma">, scan: Mesh, lantern: Mesh) {
    const { scene: palette } = THEME;
    this.group.name = "dharma";
    this.group.position.set(DHARMA_ORIGIN.x, 0, DHARMA_ORIGIN.z);
    this.environment = buildEnvironment(renderer);

    this.hemisphere = new HemisphereLight(palette.dharmaHemiSky, palette.dharmaHemiGround, 0);
    this.group.add(this.hemisphere);

    const window = new DirectionalLight(palette.dharmaWindow, 0);
    this.windowLight = window;
    window.position.set(...WINDOW_LIGHT_AT);
    window.target.position.set(...WINDOW_LIGHT_TARGET);
    window.castShadow = quality.shadows;
    if (quality.shadows) {
      window.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const shadowCamera = window.shadow.camera;
      shadowCamera.left = -SHADOW_HALF_EXTENT;
      shadowCamera.right = SHADOW_HALF_EXTENT;
      shadowCamera.top = SHADOW_HALF_EXTENT;
      shadowCamera.bottom = -SHADOW_HALF_EXTENT;
      shadowCamera.near = 1;
      shadowCamera.far = 32;
      window.shadow.bias = -0.0006;
      window.shadow.normalBias = 0.03;
    }
    this.group.add(window, window.target);

    this.candleLight = new PointLight(palette.candle, 0, CANDLE_LIGHT.distance, CANDLE_LIGHT.decay);
    this.candleLight.position.set(...CANDLE_LIGHT_AT);
    this.group.add(this.candleLight);

    const lit = (): MeshLambertMaterial => new MeshLambertMaterial({ vertexColors: true });
    this.add(meshes.structure, lit());
    this.add(meshes.ceiling, lit());
    this.add(meshes.floor, lit()).receiveShadow = quality.shadows;
    this.add(meshes.mural, vertexGlowMaterial(palette.muralGlow, MURAL_GLOW));

    const gold = new MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.62,
      roughness: 0.36,
      emissive: palette.goldGlow,
      emissiveIntensity: 0.55,
      envMap: this.environment,
      envMapIntensity: 1.1,
    });
    const petals = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, emissive: palette.lotusGlow, emissiveIntensity: 0.25 });
    // The scanned Buddha is a grey picture of light and shade: gilded here, the picture keeps its folds and its glow.
    const map = textureOf(scan);
    const gilt = new MeshStandardMaterial({
      map,
      metalness: 0.55,
      roughness: 0.4,
      emissive: palette.goldGlow,
      emissiveMap: map,
      emissiveIntensity: 0.3,
      envMap: this.environment,
      envMapIntensity: 1.1,
    });
    gilt.color.set(THEME.material.buddhaGold);
    const buddha = this.add(scan, gilt);
    buddha.scale.setScalar(BUDDHA_HEIGHT);
    buddha.position.set(BUDDHA_AT.x, BUDDHA_AT.y, BUDDHA_AT.z);
    this.add(meshes.halo, gold);
    this.add(meshes.lotus, petals);

    const { geometry: glowGeometry, centre } = centredGlow(meshes.glow);
    this.geometries.push(glowGeometry);
    const glowMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.materials.push(glowMaterial);
    this.glowMesh = new Mesh(glowGeometry, glowMaterial);
    this.glowMesh.name = meshes.glow.name;
    this.glowMesh.position.copy(centre);
    this.group.add(this.glowMesh);

    this.seats = this.buildSeats(meshes.seat);
    this.lanterns = this.buildLanterns(lantern, [palette.lanternPink, palette.lanternWhite, palette.lanternYellow, palette.lanternOrange, palette.lanternGreen, palette.lanternViolet]);

    this.glowTexture = flameGlowTexture();
    this.flames = this.buildFlames();

    const dustCount = quality.dust;
    this.dustSeeds = new Float32Array(dustCount * 4);
    const rand = mulberry32(31);
    for (let i = 0; i < this.dustSeeds.length; i += 1) this.dustSeeds[i] = rand();
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(dustCount * 3), 3));
    this.geometries.push(dustGeometry);
    const dustMaterial = new PointsMaterial({
      map: this.glowTexture,
      size: DUST_SIZE,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
      color: palette.dust,
      fog: false,
    });
    this.materials.push(dustMaterial);
    this.dust = new Points(dustGeometry, dustMaterial);
    this.dust.name = "dust";
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    this.update(0, null, true);
  }

  private add(source: Mesh, material: Material): Mesh {
    const mesh = new Mesh(source.geometry, material);
    mesh.name = source.name;
    this.materials.push(material);
    this.group.add(mesh);
    return mesh;
  }

  private buildSeats(source: Mesh): InstancedMesh {
    const material = new MeshLambertMaterial({ vertexColors: true });
    this.materials.push(material);
    const seats = new InstancedMesh(source.geometry, material, SEAT_COUNT);
    seats.instanceColor = new InstancedBufferAttribute(new Float32Array(SEAT_COUNT * 3).fill(1), 3);
    seats.instanceColor.setUsage(DynamicDrawUsage);
    seats.frustumCulled = false;
    seats.name = "seats";
    const m = new Matrix4();
    for (const spot of ZONE_SEATS.dharma) {
      m.makeRotationY(SEAT_YAW).setPosition(spot.x - DHARMA_ORIGIN.x, 0, spot.z - DHARMA_ORIGIN.z);
      seats.setMatrixAt(spot.id, m);
    }
    this.group.add(seats);
    return seats;
  }

  // The lantern's colour multiplies both the light it takes and the light it gives, as outdoors.
  private buildLanterns(source: Mesh, tones: readonly string[]): InstancedMesh {
    const material = vertexGlowMaterial(THEME.material.paper, LANTERN_GLOW);
    this.materials.push(material);
    const spots = hangingLanterns();
    const lanterns = new InstancedMesh(source.geometry, material, spots.length);
    const m = new Matrix4();
    const color = new Color();
    spots.forEach((spot, index) => {
      m.makeRotationY(spot.yaw).scale(new Vector3(spot.scale, spot.scale, spot.scale)).setPosition(spot.x, spot.y, spot.z);
      lanterns.setMatrixAt(index, m);
      lanterns.setColorAt(index, color.set(tones[Math.min(tones.length - 1, Math.floor(spot.tone * tones.length))] as string));
    });
    lanterns.name = "lanterns";
    lanterns.frustumCulled = false;
    this.group.add(lanterns);
    return lanterns;
  }

  private buildFlames(): InstancedMesh {
    const material = new MeshBasicMaterial({ map: this.glowTexture, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    this.materials.push(material);
    const geometry = new PlaneGeometry(FLAME_SIZE.width, FLAME_SIZE.height);
    this.geometries.push(geometry);
    const flames = new InstancedMesh(geometry, material, CANDLE_SPOTS.length);
    flames.frustumCulled = false;
    flames.name = "flames";
    this.group.add(flames);
    return flames;
  }

  setOccupied(seatId: number, occupied: boolean): void {
    if (seatId < 0 || seatId >= SEAT_COUNT) return;
    if (occupied === this.occupied.has(seatId)) return;
    if (occupied) this.occupied.add(seatId);
    else this.occupied.delete(seatId);
    this.tint.setScalar(occupied ? SEAT_OCCUPIED_TINT : 1);
    this.seats.setColorAt(seatId, this.tint);
    if (this.seats.instanceColor) this.seats.instanceColor.needsUpdate = true;
  }

  // 0 when the camera is outside and the room is dark, 1 when it is inside and the room is lit.
  setPresence(share: number): void {
    this.presence = share;
    this.hemisphere.intensity = HEMISPHERE_LIGHT * share;
    this.windowLight.intensity = WINDOW_LIGHT * share;
  }

  update(time: number, camera: Camera | null, reduceMotion: boolean): void {
    const flicker = reduceMotion ? 0.35 : 1;
    const base = this.tmpPos;
    for (let i = 0; i < CANDLE_SPOTS.length; i += 1) {
      const [x, z] = CANDLE_SPOTS[i] as readonly [number, number];
      const wobble = 0.92 + flicker * (0.09 * Math.sin(time * 9 + i * 1.7) + 0.05 * Math.sin(time * 17 + i * 3.1));
      base.set(x, ALTAR.topY + FLAME_HEIGHT, z);
      if (camera) this.tmpQuat.copy(camera.quaternion);
      else this.tmpQuat.identity();
      this.tmpScale.set(wobble * 0.9, wobble, 1);
      this.tmpMatrix.compose(base, this.tmpQuat, this.tmpScale);
      this.flames.setMatrixAt(i, this.tmpMatrix);
    }
    this.flames.instanceMatrix.needsUpdate = true;

    this.candleLight.intensity = this.presence * CANDLE_LIGHT.intensity * (0.93 + flicker * (0.07 * Math.sin(time * 7.3) + 0.04 * Math.sin(time * 13.1 + 1)));
    this.glowMesh.scale.setScalar(1 + (reduceMotion ? 0 : 0.015 * Math.sin(time * 0.9)));

    const count = this.dustSeeds.length / 4;
    const attribute = this.dust.geometry.getAttribute("position") as BufferAttribute;
    const drift = reduceMotion ? 0 : time;
    for (let i = 0; i < count; i += 1) {
      const phase = (this.dustSeeds[i * 4] as number) * Math.PI * 2;
      const speed = 0.2 + (this.dustSeeds[i * 4 + 1] as number) * 0.5;
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

  // The geometries and textures that came with the glb belong to the loaded assets; only what the room made is released here.
  dispose(): void {
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const mesh of [this.flames, this.seats, this.lanterns]) mesh.dispose();
    this.glowTexture.dispose();
    this.environment.dispose();
    this.group.removeFromParent();
  }
}
