import { ACESFilmicToneMapping, Color, Fog, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import { ARRIVAL, GATBAWI_SEAT_TOP, NPC_PER_ZONE, SEAT_COUNT, type SkyState, WORLD_CAPACITY, ZONES, type Zone, lerpAngle, zoneAt } from "@dongjane/shared";
import type { GameAssets } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import type { Quad } from "../ui/stage-quad.ts";
import { CameraRig, DHARMA_KEEP_OUTS, configureCamera, pointInRoom, projectToCanvas, projectUnclipped, regionFor, startViewFor } from "./camera-rig.ts";
import { DHARMA_FOG, DharmaScene } from "./dharma.ts";
import { EmoteTracker } from "./emote-tracker.ts";
import { aimThroughCamera, pickFloor } from "./floor-pick.ts";
import { Landscape, type ScreenMode } from "./landscape.ts";
import { PointerInput, type StickState } from "./input.ts";
import { JumpTracker } from "./jump-tracker.ts";
import { KnockTracker } from "./knock-tracker.ts";
import type { MonkAssets } from "./monk-assets.ts";
import { MonkAvatar, MonkPool, SEAT_TOP } from "./monk-model.ts";
import { AdaptiveScale, detectQuality, type QualityProfile } from "./quality.ts";
import type { SelfDisplay } from "./prediction.ts";
import { DAY_LOOK, packRgb, skyLook } from "./sky-look.ts";
import { RemoteTrack, ServerClock, type Sample } from "./snapshot.ts";
import { screenCorners } from "./venue-layout.ts";

export interface MonkView {
  id: string;
  hue: number;
  x: number;
  z: number;
  yaw: number;
  mode: string;
  seatId: number;
  npc: boolean;
  bowCount: number;
  emote: number;
  emoteSeq: number;
  knockSeq: number;
  chanting: boolean;
  item: number;
  jumpSeq: number;
}

export interface WorldCallbacks {
  onFrame(dtSeconds: number, nowMs: number): void;
  onRendered(nowMs: number): void;
  onStick(stick: StickState | null): void;
  // The visitor tapped or clicked the floor of the part of the world the camera is in, at this spot.
  onFloorTap(x: number, z: number): void;
  // The visitor's monk crossed the 법당's threshold: this is the part of the world the camera is in now.
  onZone(zone: Zone): void;
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

// Every monk of the world is in the scene, so the pool holds a world full of visitors and every zone's computer-driven monks.
const MAX_MONKS = WORLD_CAPACITY + ZONES.length * NPC_PER_ZONE;
// How long the camera takes to slide between the open ground's box and the room's box when the monk crosses the doorway,
// and the light to change from the sun's to the room's.
const REGION_BLEND_SECONDS = 0.5;

export class World {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 80);
  readonly rig: CameraRig;
  readonly quality: QualityProfile;
  readonly emotes = new EmoteTracker();
  private readonly knocks = new KnockTracker();
  private readonly remoteKnockers: MonkView[] = [];
  selfId: string | null = null;

  // Where the camera is: the 법당 once the followed monk is inside its door, the open ground otherwise.
  private area: Zone = "gatbawi";
  // How far the light has gone over from the open ground's to the room's, 0 to 1, moving toward the area at a steady pace.
  private indoor = 0;
  private readonly occupied: Record<Zone, ReadonlySet<number>> = { gatbawi: new Set(), dharma: new Set() };
  private readonly renderer: WebGLRenderer;
  private readonly background = new Color(packRgb(DAY_LOOK.fogColor));
  private readonly fog = new Fog(packRgb(DAY_LOOK.fogColor), DAY_LOOK.fogNear, DAY_LOOK.fogFar);
  private readonly landscape: Landscape;
  private dharma: DharmaScene | null = null;
  private dharmaLoading: Promise<boolean> | null = null;
  private disposed = false;
  private readonly indoorColor = new Color(THEME.scene.dharmaBackground);
  private readonly pool: MonkPool;
  private readonly entries = new Map<string, Entry>();
  private readonly jumps = new JumpTracker();
  private readonly sample: Sample = { x: 0, z: 0, yaw: 0 };
  private readonly anchor = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly clock = new ServerClock();
  private selfPrediction: SelfDisplay | null = null;
  private readonly input: PointerInput;
  private readonly adaptive: AdaptiveScale;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private sizeDirty = false;
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
  private readonly screenCorners = screenCorners();
  private readonly screenPoints: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: WorldCallbacks,
    private readonly assets: GameAssets,
    monkAssets: MonkAssets,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
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

    this.landscape = new Landscape(this.renderer, this.quality, assets.models.world, assets.models.gatbawi, assets.models.buddha, assets.models.venue);
    this.scene.add(this.landscape.group);
    this.pool = new MonkPool(this.scene, monkAssets, MAX_MONKS);

    const region = regionFor(this.area);
    this.rig = new CameraRig(this.camera, region.bounds, region.limits, DHARMA_KEEP_OUTS);
    this.rig.follow(ARRIVAL.x, ARRIVAL.z, 0, true);

    this.input = new PointerInput(canvas, {
      onOrbit: (dx, dy) => {
        this.idleSpin = false;
        this.rig.orbit(dx, dy);
      },
      onZoom: (factor) => this.rig.zoom(factor),
      onStick: (stick) => this.callbacks.onStick(stick),
      onTap: (clientX, clientY) => {
        const point = this.floorPointAt(clientX, clientY);
        if (point) this.callbacks.onFloorTap(point.x, point.z);
      },
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

  floorPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
    aimThroughCamera(this.raycaster, this.ndc, this.camera);
    const hit = pickFloor(this.raycaster, this.dharma ? [this.landscape.surfaces, this.dharma.surfaces] : [this.landscape.surfaces]);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  displayedPosition(id: string, out: { x: number; z: number }): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.avatar.hidden) return false;
    out.x = entry.x;
    out.z = entry.z;
    return true;
  }

  headTopOf(id: string): number | null {
    const entry = this.entries.get(id);
    return entry && !entry.avatar.hidden ? entry.avatar.headTopY() : null;
  }

  get currentStats(): WorldStats {
    return this.stats;
  }

  get monkCount(): number {
    return this.entries.size;
  }

  get currentZone(): Zone {
    return this.area;
  }

  // The 법당's inside is fetched while the visitor settles in, and at the latest when they reach its door. Resolves false when it
  // could not be had; asking again retries.
  ensureDharma(): Promise<boolean> {
    if (this.dharma) return Promise.resolve(true);
    if (this.dharmaLoading) return this.dharmaLoading;
    const loading = this.assets
      .loadDharma()
      .then((meshes) => {
        if (this.disposed) return false;
        const scene = new DharmaScene(this.renderer, this.quality, meshes, this.assets.models.buddha.buddha, this.assets.models.venue.lantern);
        scene.setPresence(this.indoorShare());
        this.scene.add(scene.group);
        this.dharma = scene;
        this.applyOccupancy("dharma");
        return true;
      })
      .catch(() => false);
    this.dharmaLoading = loading;
    void loading.then((ok) => {
      if (!ok && this.dharmaLoading === loading) this.dharmaLoading = null;
    });
    return loading;
  }

  // The camera goes where the followed monk stands. The 법당's inside has to be here before the camera enters it, so a monk
  // who walks in early is followed from outside until it has arrived.
  private followArea(x: number, z: number): void {
    const wanted = zoneAt(x, z);
    if (wanted === this.area) return;
    if (wanted === "dharma" && !this.dharma) {
      void this.ensureDharma();
      return;
    }
    this.setArea(wanted);
  }

  private setArea(zone: Zone): void {
    if (zone === this.area) return;
    this.area = zone;
    const region = regionFor(zone);
    this.rig.setRegion(region.bounds, region.limits, REGION_BLEND_SECONDS);
    this.callbacks.onZone(zone);
  }

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
    this.rig.reduceMotion = value;
  }

  setSky(sky: SkyState): void {
    this.landscape.setSky(skyLook(sky));
  }

  serverNowAt(localMs: number): number | null {
    return this.clock.serverNowAt(localMs);
  }

  // A world-list reply carries a whole HTTP round trip, so it may only seed an empty clock; later it would read as jitter and stretch the remote-monk delay.
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

  // Returns the other monks who struck their wooden fish since the last call (the array is reused); the caller plays the sound.
  applyMonks(views: readonly MonkView[], nowMs: number, serverTime: number): readonly MonkView[] {
    this.clock.observe(serverTime, nowMs);
    const seen = new Set<string>();
    const remoteKnockers = this.remoteKnockers;
    remoteKnockers.length = 0;
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
      this.emotes.observe(view.id, view.emoteSeq, view.emote, nowMs);
      const isSelf = view.id === this.selfId;
      entry.avatar.chanting = view.chanting;
      entry.avatar.item = view.item;
      entry.avatar.seatTop = zoneAt(view.x, view.z) === "dharma" ? SEAT_TOP : GATBAWI_SEAT_TOP;
      // The tracker sees the player's own counter too, so the echo of a knock already played locally never replays.
      if (this.knocks.observe(view.id, view.knockSeq) && !isSelf) {
        entry.avatar.knock(nowMs);
        remoteKnockers.push(view);
      }
      if (this.jumps.observe(view.id, view.jumpSeq) && !isSelf) entry.avatar.hop(nowMs);
      if (!isSelf) entry.track.push(serverTime, view.x, view.z, view.yaw, view.mode === "walk");
      if (!(isSelf && this.selfPrediction)) entry.avatar.setMode(view.mode, nowMs);
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) this.dropEntry(id);
    }
    return remoteKnockers;
  }

  // Optimistic local feedback for the player's own knock; the server echo is ignored for the player.
  knock(monkId: string, nowMs: number): void {
    this.entries.get(monkId)?.avatar.knock(nowMs);
  }

  // The player's own hop starts on the keypress, so the server's echo of the same jump does not hop again.
  hopSelf(nowMs: number): void {
    const entry = this.selfId ? this.entries.get(this.selfId) : undefined;
    entry?.avatar.hop(nowMs);
  }

  // Which seats of a zone are taken. The 법당's are remembered until its inside has arrived.
  setOccupancy(zone: Zone, occupied: ReadonlySet<number>): void {
    this.occupied[zone] = occupied;
    this.applyOccupancy(zone);
  }

  private applyOccupancy(zone: Zone): void {
    const occupied = this.occupied[zone];
    for (let id = 0; id < SEAT_COUNT; id += 1) {
      if (zone === "dharma") this.dharma?.setOccupied(id, occupied.has(id));
      else this.landscape.setOccupied(id, occupied.has(id));
    }
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.dropEntry(id);
    this.knocks.reset();
    this.selfId = null;
    this.selfPrediction = null;
    this.clock.reset();
    for (const zone of ZONES) this.setOccupancy(zone, new Set());
    this.setArea("gatbawi");
    this.indoor = 0;
    this.rig.follow(ARRIVAL.x, ARRIVAL.z, 0, true);
  }

  resetCamera(): void {
    const view = startViewFor(this.area, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.rig.yaw = view.yaw;
    this.rig.pitch = view.pitch;
    this.rig.distance = view.distance;
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

  setScreenMode(mode: ScreenMode): void {
    this.landscape.setScreenMode(mode);
  }

  // Where the concert screen's corners are on the canvas (bottom-left, bottom-right, top-right, top-left), or null
  // when the camera is inside the 법당 or any corner is behind the camera. The points are reused between calls.
  screenQuad(): Quad | null {
    if (this.area !== "gatbawi") return null;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (let i = 0; i < this.screenCorners.length; i += 1) {
      const corner = this.screenCorners[i] as (typeof this.screenCorners)[number];
      if (!projectUnclipped(this.camera, corner.x, corner.y, corner.z, width, height, this.screenPoints[i] as { x: number; y: number })) return null;
    }
    return this.screenPoints;
  }

  projectToScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    return projectToCanvas(this.camera, x, y, z, this.canvas.clientWidth, this.canvas.clientHeight, out);
  }

  projectEmoteAnchor(monkId: string, out: { x: number; y: number }): boolean {
    const entry = this.entries.get(monkId);
    if (!entry || entry.avatar.hidden) return false;
    entry.avatar.emoteAnchor(this.anchor);
    return this.projectToScreen(this.anchor.x, this.anchor.y, this.anchor.z, out);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.clear();
    this.pool.dispose();
    this.dharma?.dispose();
    this.landscape.dispose();
    this.assets.dispose();
    this.renderer.dispose();
  }

  private dropEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.pool.remove(entry.avatar);
    entry.avatar.dispose();
    this.entries.delete(id);
    this.emotes.forget(id);
    this.knocks.forget(id);
    this.jumps.forget(id);
  }

  private indoorShare(): number {
    return this.indoor * this.indoor * (3 - 2 * this.indoor);
  }

  // The camera is in the room itself, not just following someone who is: only then are the front wall and the roof in the way.
  private cameraInRoom(): boolean {
    return pointInRoom(this.camera.position);
  }

  // The air, the lights and the colour behind the world go over from the open ground's to the room's as the share rises.
  private applyAtmosphere(share: number): void {
    const look = this.landscape.look;
    this.background.setHex(packRgb(look.fogColor)).lerp(this.indoorColor, share);
    this.fog.color.copy(this.background);
    this.fog.near = look.fogNear + (DHARMA_FOG.near - look.fogNear) * share;
    this.fog.far = look.fogFar + (DHARMA_FOG.far - look.fogFar) * share;
    this.landscape.setIndoor(share);
    this.dharma?.setPresence(share);
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    configureCamera(this.camera, this.rig, width, height, this.hudTop, this.hudBottom);
    this.sizeDirty = true;
  }

  // Assigning the canvas size clears its drawing buffer, so it must happen in the same frame, just before drawing, never between frames.
  private applySize(): void {
    this.renderer.setPixelRatio(this.adaptive.ratio);
    this.renderer.setSize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), false);
    this.sizeDirty = false;
  }

  private tick(nowMs: number): void {
    if (this.sizeDirty) this.applySize();
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

    const self = this.selfId ? this.entries.get(this.selfId) : undefined;
    if (self) this.followArea(self.x, self.z);
    for (const entry of this.entries.values()) {
      entry.avatar.hidden = entry !== self && zoneAt(entry.x, entry.z) !== this.area;
    }
    this.pool.flush();

    if (self) {
      this.rig.follow(self.x, self.z, dt);
    } else if (this.idleSpin && !this.reduceMotion) {
      this.rig.yaw += dt * 0.05;
    }
    this.rig.update(dt);
    this.camera.updateMatrixWorld();

    const wanted = this.area === "dharma" ? 1 : 0;
    const step = this.reduceMotion ? 1 : dt / REGION_BLEND_SECONDS;
    this.indoor = wanted > this.indoor ? Math.min(wanted, this.indoor + step) : Math.max(wanted, this.indoor - step);
    this.landscape.setCutaway(this.area === "dharma" && !this.cameraInRoom());
    this.applyAtmosphere(this.indoorShare());
    this.landscape.update(this.time, dt, this.camera, this.reduceMotion, this.rig.focusPoint);
    this.dharma?.update(this.time, this.camera, this.reduceMotion);
    this.renderer.render(this.scene, this.camera);
    this.callbacks.onRendered(nowMs);

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
    if (next !== null) this.sizeDirty = true;
  }
}
