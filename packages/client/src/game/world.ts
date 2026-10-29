import {
  ACESFilmicToneMapping,
  Color,
  DoubleSide,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { HALL_FRONT_Z, HALL_HALF_WIDTH, lerpAngle, resolveWalkable, SPAWN_POINT } from "@dongjane/shared";
import { CameraRig, DEFAULT_VIEW, configureCamera } from "./camera-rig.ts";
import { HALL_BOUNDS, Hall } from "./hall.ts";
import { PointerInput } from "./input.ts";
import { MonkAvatar, MonkPool } from "./monk-model.ts";
import { AdaptiveScale, detectQuality, type QualityProfile } from "./quality.ts";
import { SnapshotBuffer, type Sample } from "./snapshot.ts";

export interface MonkView {
  id: string;
  hue: number;
  x: number;
  z: number;
  yaw: number;
  mode: string;
  cushionId: number;
}

export interface WorldCallbacks {
  onPickCushion(cushionId: number): void;
  onPickFloor(x: number, z: number): void;
  onFrame(dtSeconds: number, nowMs: number): void;
}

export interface WorldStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  monks: number;
  pixelRatio: number;
}

interface Entry {
  avatar: MonkAvatar;
  buffer: SnapshotBuffer;
  x: number;
  z: number;
  yaw: number;
  targetX: number;
  targetZ: number;
  targetYaw: number;
}

const INTERPOLATION_DELAY_MS = 100;
const MAX_MONKS = 40;
const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

export class World {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 80);
  readonly rig: CameraRig;
  readonly quality: QualityProfile;
  selfId: string | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly hall: Hall;
  private readonly pool: MonkPool;
  private readonly entries = new Map<string, Entry>();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly hitPoint = new Vector3();
  private readonly sample: Sample = { x: 0, z: 0, yaw: 0 };
  private readonly input: PointerInput;
  private readonly adaptive: AdaptiveScale;
  private readonly marker: Mesh;
  private readonly selfRing: Mesh;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private last = 0;
  private time = 0;
  private reduceMotion = false;
  private markerAge = 99;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private stats: WorldStats = { fps: 0, drawCalls: 0, triangles: 0, monks: 0, pixelRatio: 1 };
  private running = false;
  private idleSpin = true;
  private hudTop = 0;
  private hudBottom = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: WorldCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.quality = detectQuality({
      devicePixelRatio: window.devicePixelRatio,
      cores: navigator.hardwareConcurrency,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    });
    this.adaptive = new AdaptiveScale(this.quality.pixelRatioCap, this.quality.pixelRatioCap);
    this.renderer.setPixelRatio(this.adaptive.ratio);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality.shadows;

    this.scene.background = new Color(0x1c120b);
    this.scene.fog = new Fog(0x2a1a10, 16, 42);

    this.hall = new Hall(this.renderer, this.quality);
    this.scene.add(this.hall.group);
    this.pool = new MonkPool(this.scene, MAX_MONKS);

    this.rig = new CameraRig(this.camera, HALL_BOUNDS);
    this.rig.follow(SPAWN_POINT.x, SPAWN_POINT.z, 0, true);

    this.marker = new Mesh(
      new RingGeometry(0.16, 0.24, 28),
      new MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.selfRing = new Mesh(
      new RingGeometry(0.36, 0.42, 32),
      new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide, fog: false }),
    );
    this.selfRing.rotation.x = -Math.PI / 2;
    this.selfRing.visible = false;
    const overlay = new Group();
    overlay.add(this.marker, this.selfRing);
    this.scene.add(overlay);

    this.input = new PointerInput(canvas, {
      onTap: (x, y) => this.pick(x, y),
      onOrbit: (dx, dy) => {
        this.idleSpin = false;
        this.rig.orbit(dx, dy);
      },
      onZoom: (factor) => this.rig.zoom(factor),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
  }

  get selfPosition(): { x: number; z: number } | null {
    const entry = this.selfId ? this.entries.get(this.selfId) : undefined;
    return entry ? { x: entry.x, z: entry.z } : null;
  }

  get currentStats(): WorldStats {
    return this.stats;
  }

  get monkCount(): number {
    return this.entries.size;
  }

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
    this.rig.reduceMotion = value;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (): void => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      this.tick(performance.now());
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  applyMonks(views: readonly MonkView[], nowMs: number): void {
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.id);
      let entry = this.entries.get(view.id);
      if (!entry) {
        const avatar = new MonkAvatar(view.id, view.hue, view.id === this.selfId);
        if (!this.pool.add(avatar)) {
          avatar.dispose();
          continue;
        }
        entry = {
          avatar,
          buffer: new SnapshotBuffer(),
          x: view.x,
          z: view.z,
          yaw: view.yaw,
          targetX: view.x,
          targetZ: view.z,
          targetYaw: view.yaw,
        };
        avatar.mode = view.mode;
        avatar.modeSince = nowMs;
        avatar.pose.update(view.mode, 10, false);
        avatar.place(view.x, view.z, view.yaw);
        this.entries.set(view.id, entry);
        if (view.id === this.selfId) this.rig.follow(view.x, view.z, 0, true);
      } else if (entry.avatar.hue !== view.hue) {
        entry.avatar.hue = view.hue;
        this.pool.repaint(entry.avatar);
      }
      entry.targetX = view.x;
      entry.targetZ = view.z;
      entry.targetYaw = view.yaw;
      if (view.id !== this.selfId) entry.buffer.push(nowMs, view.x, view.z, view.yaw);
      entry.avatar.setMode(view.mode, nowMs);
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) this.dropEntry(id);
    }
  }

  setOccupancy(occupied: ReadonlySet<number>): void {
    for (let id = 0; id < 8; id += 1) this.hall.setOccupied(id, occupied.has(id));
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.dropEntry(id);
    this.selfId = null;
    this.setOccupancy(new Set());
  }

  resetCamera(): void {
    this.rig.yaw = DEFAULT_VIEW.yaw;
    this.rig.pitch = DEFAULT_VIEW.pitch;
    this.rig.distance = DEFAULT_VIEW.distance;
  }

  setHudInsets(top: number, bottom: number): void {
    if (top === this.hudTop && bottom === this.hudBottom) return;
    this.hudTop = top;
    this.hudBottom = bottom;
    this.resize();
  }

  setIdleSpin(value: boolean): void {
    this.idleSpin = value;
  }

  showMarker(x: number, z: number): void {
    this.marker.position.set(x, 0.03, z);
    this.markerAge = 0;
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.clear();
    this.pool.dispose();
    this.hall.dispose();
    this.marker.geometry.dispose();
    this.selfRing.geometry.dispose();
    this.renderer.dispose();
  }

  private dropEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.pool.remove(entry.avatar);
    entry.avatar.dispose();
    this.entries.delete(id);
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    configureCamera(this.camera, this.rig, width, height, this.hudTop, this.hudBottom);
  }

  private pick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.hall.pickables, false);
    for (const hit of hits) {
      const id = this.hall.cushionAt(hit);
      if (id !== null) {
        this.callbacks.onPickCushion(id);
        return;
      }
    }
    if (!this.raycaster.ray.intersectPlane(FLOOR_PLANE, this.hitPoint)) return;
    const { x, z } = this.hitPoint;
    if (Math.abs(x) > HALL_HALF_WIDTH || z > HALL_FRONT_Z) return;
    const target = resolveWalkable(x, z);
    this.showMarker(target.x, target.z);
    this.callbacks.onPickFloor(target.x, target.z);
  }

  private tick(nowMs: number): void {
    const dt = Math.min(0.1, Math.max(0.001, (nowMs - this.last) / 1000));
    this.last = nowMs;
    this.time += dt;
    this.callbacks.onFrame(dt, nowMs);

    const k = 1 - Math.exp(-dt * 14);
    const renderTime = nowMs - INTERPOLATION_DELAY_MS;
    for (const entry of this.entries.values()) {
      const px = entry.x;
      const pz = entry.z;
      if (entry.avatar.id === this.selfId) {
        entry.x += (entry.targetX - entry.x) * k;
        entry.z += (entry.targetZ - entry.z) * k;
        entry.yaw = lerpAngle(entry.yaw, entry.targetYaw, k);
      } else if (entry.buffer.sample(renderTime, this.sample)) {
        entry.x = this.sample.x;
        entry.z = this.sample.z;
        entry.yaw = this.sample.yaw;
      }
      const speed = Math.hypot(entry.x - px, entry.z - pz) / dt;
      entry.avatar.place(entry.x, entry.z, entry.yaw);
      entry.avatar.animate(dt, nowMs, speed, this.reduceMotion);
    }
    this.pool.flush();

    const self = this.selfId ? this.entries.get(this.selfId) : undefined;
    if (self) {
      this.rig.follow(self.x, self.z, dt);
      const grounded = self.avatar.mode === "stand" || self.avatar.mode === "walk";
      this.selfRing.visible = grounded;
      this.selfRing.position.set(self.x, 0.028, self.z);
    } else {
      this.selfRing.visible = false;
      if (this.idleSpin && !this.reduceMotion) this.rig.yaw += dt * 0.05;
    }
    this.rig.update(dt);
    this.camera.updateMatrixWorld();

    this.markerAge += dt;
    const material = this.marker.material as MeshBasicMaterial;
    if (this.markerAge < 0.8) {
      const t = this.markerAge / 0.8;
      material.opacity = 0.9 * (1 - t);
      this.marker.scale.setScalar(0.7 + t * 0.9);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
    }

    this.hall.update(this.time, this.camera, this.reduceMotion);
    this.renderer.render(this.scene, this.camera);

    const info = this.renderer.info.render;
    this.fpsAccumulator += dt;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.stats = {
        fps: Math.round(this.fpsFrames / this.fpsAccumulator),
        drawCalls: info.calls,
        triangles: info.triangles,
        monks: this.entries.size,
        pixelRatio: this.adaptive.ratio,
      };
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    const next = this.adaptive.push(dt * 1000);
    if (next !== null) {
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
