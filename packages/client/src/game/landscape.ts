import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Camera,
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
import { BUDDHA_Z, MAT_SPOTS } from "@dongjane/shared";
import { type ModelMeshes, textureOf } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import { buildBuddha, type BuddhaPieces } from "./buddha.ts";
import { ALTAR_TOP, CANDLE_SPOTS, SUN_POSITION, SUN_TARGET } from "./landscape-layout.ts";
import { flameGlowTexture, mulberry32 } from "./textures.ts";

export interface LandscapeQuality {
  shadows: boolean;
  shadowMapSize: number;
  dust: number;
  anisotropy: number;
}

interface Shadows {
  cast?: boolean;
  receive?: boolean;
}

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
  const panels = new PlaneGeometry(5, 4);
  const lampMaterial = new MeshBasicMaterial({ color: new Color(palette.envLamp).multiplyScalar(7), side: DoubleSide });
  const lamp = new Mesh(panels, lampMaterial);
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
  for (const geometry of [dome, panels, candleGeometry]) geometry.dispose();
  for (const material of [domeMaterial, lampMaterial, candleMaterial]) material.dispose();
  return target.texture;
}

export class Landscape {
  readonly group = new Group();
  readonly sun: DirectionalLight;

  private readonly buddha: BuddhaPieces;
  private readonly environment: Texture;
  private readonly candleLight: PointLight;
  private readonly flames: InstancedMesh;
  private readonly dust: Points;
  private readonly dustSeeds: Float32Array;
  private readonly matBody: InstancedMesh;
  private readonly matTop: InstancedMesh;
  private readonly glow: Texture;
  private readonly materials: Material[] = [];
  private readonly occupied = new Set<number>();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tint = new Color();

  constructor(renderer: WebGLRenderer, quality: LandscapeQuality, meshes: ModelMeshes<"world">, buddha: ModelMeshes<"buddha">) {
    const { scene: palette } = THEME;
    this.group.name = "landscape";
    this.environment = buildEnvironment(renderer);
    this.buddha = buildBuddha(buddha, this.environment);
    const { anisotropy } = quality;

    this.group.add(new HemisphereLight(palette.hemiSky, palette.hemiGround, 1.25));

    this.sun = new DirectionalLight(palette.sun, 3.1);
    this.sun.position.set(...SUN_POSITION);
    this.sun.target.position.set(...SUN_TARGET);
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

    this.candleLight = new PointLight(palette.candle, 9, 11, 2);
    this.candleLight.position.set(0, 1.7, BUDDHA_Z + 1.4);
    this.group.add(this.candleLight);

    const lit = (): MeshLambertMaterial => new MeshLambertMaterial({ vertexColors: true });
    this.add(meshes.structure, lit(), { cast: true, receive: true });
    this.add(meshes.beams, lit());
    this.add(meshes.paper, new MeshLambertMaterial({ vertexColors: true, emissive: palette.paperGlow, emissiveIntensity: 0.55 }));
    this.add(meshes.outdoor, lit());
    this.add(meshes.lanterns, new MeshBasicMaterial({ vertexColors: true, fog: false }));

    const floorMap = textureOf(meshes.floor);
    const backdropMap = textureOf(meshes.backdrop);
    const matMap = textureOf(meshes.matTop);
    for (const map of [floorMap, backdropMap, matMap]) map.anisotropy = anisotropy;
    this.add(meshes.floor, new MeshLambertMaterial({ map: floorMap }), { receive: true });
    this.add(
      meshes.backdrop,
      new MeshLambertMaterial({ map: backdropMap, emissive: palette.muralGlow, emissiveMap: backdropMap, emissiveIntensity: 0.55 }),
      { receive: true },
    );
    this.add(meshes.sky, new MeshBasicMaterial({ map: textureOf(meshes.sky), fog: false, toneMapped: false }));
    this.add(
      meshes.sunbeams,
      new MeshBasicMaterial({
        map: textureOf(meshes.sunbeams),
        color: palette.beamTint,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: false,
      }),
    );

    this.buddha.group.position.set(0, ALTAR_TOP, BUDDHA_Z - 0.5);
    this.group.add(this.buddha.group);

    this.matBody = this.instance(meshes.matBody, lit(), "mat-body", { cast: true, receive: true });
    this.matTop = this.instance(meshes.matTop, new MeshLambertMaterial({ map: matMap }), "mat-top", { receive: true });
    this.placeMats();

    this.glow = flameGlowTexture();
    this.flames = this.buildCandles();

    const dustCount = quality.dust;
    this.dustSeeds = new Float32Array(dustCount * 4);
    const rand = mulberry32(31);
    for (let i = 0; i < dustCount; i += 1) {
      this.dustSeeds[i * 4] = rand() * Math.PI * 2;
      this.dustSeeds[i * 4 + 1] = 0.2 + rand() * 0.5;
      this.dustSeeds[i * 4 + 2] = rand();
      this.dustSeeds[i * 4 + 3] = rand();
    }
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(dustCount * 3), 3));
    const dustMaterial = new PointsMaterial({
      map: this.glow,
      size: 0.09,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
      color: palette.dust,
      fog: false,
    });
    this.materials.push(dustMaterial);
    this.dust = new Points(dustGeometry, dustMaterial);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    this.update(0, null, true);
  }

  private add(source: Mesh, material: Material, shadows: Shadows = {}): void {
    const mesh = new Mesh(source.geometry, material);
    mesh.name = source.name;
    mesh.castShadow = shadows.cast ?? false;
    mesh.receiveShadow = shadows.receive ?? false;
    this.materials.push(material);
    this.group.add(mesh);
  }

  private instance(source: Mesh, material: Material, name: string, shadows: Shadows): InstancedMesh {
    const mesh = new InstancedMesh(source.geometry, material, MAT_SPOTS.length);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAT_SPOTS.length * 3).fill(1), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.castShadow = shadows.cast ?? false;
    mesh.receiveShadow = shadows.receive ?? false;
    mesh.frustumCulled = false;
    mesh.name = name;
    this.materials.push(material);
    this.group.add(mesh);
    return mesh;
  }

  private placeMats(): void {
    const m = new Matrix4();
    for (const spot of MAT_SPOTS) {
      m.makeTranslation(spot.x, 0, spot.z);
      this.matBody.setMatrixAt(spot.id, m);
      this.matTop.setMatrixAt(spot.id, m);
    }
  }

  private buildCandles(): InstancedMesh {
    const material = new MeshBasicMaterial({ map: this.glow, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    this.materials.push(material);
    const flames = new InstancedMesh(new PlaneGeometry(0.5, 0.62), material, CANDLE_SPOTS.length);
    flames.frustumCulled = false;
    flames.name = "flames";
    this.group.add(flames);
    return flames;
  }

  setOccupied(matId: number, occupied: boolean): void {
    if (matId < 0 || matId >= MAT_SPOTS.length) return;
    if (occupied === this.occupied.has(matId)) return;
    if (occupied) this.occupied.add(matId);
    else this.occupied.delete(matId);
    this.tint.setScalar(occupied ? 0.55 : 1);
    for (const mesh of [this.matBody, this.matTop]) {
      mesh.setColorAt(matId, this.tint);
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

  // The geometries and textures that came with the glb belong to the loaded assets; only what the landscape made is released here.
  dispose(): void {
    for (const material of this.materials) material.dispose();
    this.flames.geometry.dispose();
    this.dust.geometry.dispose();
    for (const mesh of [this.flames, this.matBody, this.matTop]) mesh.dispose();
    this.glow.dispose();
    this.buddha.dispose();
    this.environment.dispose();
    this.group.removeFromParent();
  }
}
