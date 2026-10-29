import {
  ACESFilmicToneMapping,
  Color,
  DoubleSide,
  Fog,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import { type SkyState, lerpAngle, SPAWN_POINT } from "@dongjane/shared";
import { CameraRig, DEFAULT_VIEW, configureCamera, projectToCanvas } from "./camera-rig.ts";
import { HALL_BOUNDS, Hall } from "./hall.ts";
import { PointerInput, type StickState } from "./input.ts";
import type { MonkAssets } from "./monk-assets.ts";
import { MonkAvatar, MonkPool } from "./monk-model.ts";
import { AdaptiveScale, detectQuality, type QualityProfile } from "./quality.ts";
import type { SelfDisplay } from "./prediction.ts";
import { DAY_LOOK, packRgb, skyLook } from "./sky-look.ts";
import { RemoteTrack, ServerClock, type Sample } from "./snapshot.ts";

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
  onFrame(dtSeconds: number, nowMs: number): void;
  onRendered(): void;
  onStick(stick: StickState | null): void;
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
  track: RemoteTrack;
  x: number;
  z: number;
  yaw: number;
  targetX: number;
  targetZ: number;
  targetYaw: number;
}

const MAX_MONKS = 40;

export class World {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 80);
  readonly rig: CameraRig;
  readonly quality: QualityProfile;
  selfId: string | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly background = new Color(packRgb(DAY_LOOK.background));
  private readonly fog = new Fog(packRgb(DAY_LOOK.fogColor), DAY_LOOK.fogNear, DAY_LOOK.fogFar);
  private readonly hall: Hall;
  private readonly pool: MonkPool;
  private readonly entries = new Map<string, Entry>();
  private readonly sample: Sample = { x: 0, z: 0, yaw: 0 };
  private readonly clock = new ServerClock();
  private selfPrediction: SelfDisplay | null = null;
  private readonly input: PointerInput;
  private readonly adaptive: AdaptiveScale;
  private readonly selfRing: Mesh;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private last = 0;
  private time = 0;
  private reduceMotion = false;
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
    monkAssets: MonkAssets,
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

    this.scene.background = this.background;
    this.scene.fog = this.fog;

    this.hall = new Hall(this.renderer, this.quality);
    this.scene.add(this.hall.group);
    this.pool = new MonkPool(this.scene, monkAssets, MAX_MONKS);

    this.rig = new CameraRig(this.camera, HALL_BOUNDS);
    this.rig.follow(SPAWN_POINT.x, SPAWN_POINT.z, 0, true);

    this.selfRing = new Mesh(
      new RingGeometry(0.36, 0.42, 32),
      new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide, fog: false }),
    );
    this.selfRing.rotation.x = -Math.PI / 2;
    this.selfRing.visible = false;
    this.scene.add(this.selfRing);

    this.input = new PointerInput(canvas, {
      onOrbit: (dx, dy) => {
        this.idleSpin = false;
        this.rig.orbit(dx, dy);
      },
      onZoom: (factor) => this.rig.zoom(factor),
      onStick: (stick) => this.callbacks.onStick(stick),
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

  setSky(sky: SkyState): void {
    this.hall.setSky(skyLook(sky));
  }

  serverNowAt(localMs: number): number | null {
    return this.clock.serverNowAt(localMs);
  }

  // A hall-list reply carries a whole HTTP round trip, so it may only seed an empty clock; later it would read as jitter and stretch the remote-monk delay.
  seedServerTime(serverMs: number, localMs: number): void {
    if (this.clock.serverNowAt(localMs) === null) this.clock.observe(serverMs, localMs);
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

  setSelfPrediction(display: SelfDisplay | null): void {
    this.selfPrediction = display;
  }

  applyMonks(views: readonly MonkView[], nowMs: number, serverTime: number): void {
    this.clock.observe(serverTime, nowMs);
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
          track: new RemoteTrack(),
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
      const isSelf = view.id === this.selfId;
      if (!isSelf) entry.track.push(serverTime, view.x, view.z, view.yaw, view.mode === "walk");
      if (!(isSelf && this.selfPrediction)) entry.avatar.setMode(view.mode, nowMs);
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
    this.selfPrediction = null;
    this.clock.reset();
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

  projectToScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    return projectToCanvas(this.camera, x, y, z, this.canvas.clientWidth, this.canvas.clientHeight, out);
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.clear();
    this.pool.dispose();
    this.hall.dispose();
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

  private applyAtmosphere(): void {
    const look = this.hall.look;
    this.background.setHex(packRgb(look.background));
    this.fog.color.setHex(packRgb(look.fogColor));
    this.fog.near = look.fogNear;
    this.fog.far = look.fogFar;
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    configureCamera(this.camera, this.rig, width, height, this.hudTop, this.hudBottom);
  }

  private tick(nowMs: number): void {
    const dt = Math.min(0.1, Math.max(0.001, (nowMs - this.last) / 1000));
    this.last = nowMs;
    this.time += dt;
    this.callbacks.onFrame(dt, nowMs);

    const k = 1 - Math.exp(-dt * 14);
    const renderTime = this.clock.advance(nowMs);
    for (const entry of this.entries.values()) {
      const px = entry.x;
      const pz = entry.z;
      if (entry.avatar.id === this.selfId) {
        const predicted = this.selfPrediction;
        if (predicted) {
          entry.x = predicted.x;
          entry.z = predicted.z;
          entry.yaw = lerpAngle(entry.yaw, predicted.yaw, k);
          entry.avatar.setMode(predicted.walking ? "walk" : "stand", nowMs);
        } else {
          entry.x += (entry.targetX - entry.x) * k;
          entry.z += (entry.targetZ - entry.z) * k;
          entry.yaw = lerpAngle(entry.yaw, entry.targetYaw, k);
        }
      } else if (entry.track.sample(renderTime, dt, this.sample)) {
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

    this.hall.update(this.time, dt, this.camera, this.reduceMotion);
    this.applyAtmosphere();
    this.renderer.render(this.scene, this.camera);
    this.callbacks.onRendered();

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
