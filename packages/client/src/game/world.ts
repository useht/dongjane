import { ACESFilmicToneMapping, Color, Fog, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import { ARRIVAL, DHARMA_VENUE, GATBAWI_VENUE, INDOOR, type MachineSpot, NPC_COUNT, SEAT_COUNT, SEAT_POSES, SEAT_TOPS, type SkyState, WORLD_CAPACITY, ZONES, type Zone, lerpAngle, perZone, venueAt } from "@dongjane/shared";
import type { GameAssets, KitModel } from "../assets/registry.ts";
import { THEME } from "../theme.ts";
import type { Quad } from "../ui/stage-quad.ts";
import { CameraRig, WORLD_KEEP_OUTS, WORLD_SOLIDS, casinoRegion, configureCamera, pointInRoom, projectToCanvas, projectUnclipped, regionFor, startViewFor } from "./camera-rig.ts";
import { CASINO_FOG, CasinoScene } from "./casino.ts";
import { CASINO_SHELL, casinoNearness, insideBounds } from "./casino-layout.ts";
import { DHARMA_FOG, DharmaScene } from "./dharma.ts";
import { EmoteTracker } from "./emote-tracker.ts";
import { type FloorSurfaces, aimThroughCamera, pickFloor, pickHit } from "./floor-pick.ts";
import { Landscape, type ScreenMode } from "./landscape.ts";
import { PointerInput, type StickState } from "./input.ts";
import { JumpTracker } from "./jump-tracker.ts";
import { type KitLook, kitById } from "./kits/index.ts";
import { KnockTracker } from "./knock-tracker.ts";
import type { MonkAssets } from "./monk-assets.ts";
import { MonkAvatar, MonkPool } from "./monk-model.ts";
import { AdaptiveScale, detectQuality, type QualityProfile } from "./quality.ts";
import type { SelfDisplay } from "./prediction.ts";
import { DAY_LOOK, packRgb, skyLook } from "./sky-look.ts";
import { RemoteTrack, ServerClock, type Sample } from "./snapshot.ts";
import { screenCorners } from "./venue-layout.ts";
import { VenueLights, VenueScene } from "./venue-scene.ts";

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
  bite: boolean;
}

export interface WorldCallbacks {
  onFrame(dtSeconds: number, nowMs: number): void;
  onRendered(nowMs: number): void;
  onStick(stick: StickState | null): void;
  // The visitor tapped or clicked the stage at this screen point.
  onTap(clientX: number, clientY: number): void;
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
const MAX_MONKS = WORLD_CAPACITY + NPC_COUNT;
// How long the camera takes to slide between the open ground's box and the room's box when the monk crosses the doorway,
// and the light to change from the sun's to the room's.
const REGION_BLEND_SECONDS = 0.5;

// Every visit starts where ARRIVAL puts the monk, so the camera, the light and the sounds start in that part of the world too.
export const START_ZONE: Zone = venueAt(ARRIVAL.x, ARRIVAL.z);

const smooth = (t: number): number => t * t * (3 - 2 * t);
const dharmaOf = (zone: Zone): number => (zone === DHARMA_VENUE.id ? 1 : 0);
const casinoOf = (inside: boolean): number => (inside ? 1 : 0);
const approach = (value: number, wanted: number, step: number): number => (wanted > value ? Math.min(wanted, value + step) : Math.max(wanted, value - step));

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
  private area: Zone = START_ZONE;
  // How far the light has gone over from the open ground's to the 법당's, 0 to 1, moving toward the area at a steady pace.
  private dharmaIn = dharmaOf(START_ZONE);
  // The casino has no zone of its own (it is open ground to the rules); the camera is in it once the followed monk is between its
  // walls. `casinoIn` is the same kind of share as `indoor`, for the casino's light and air.
  private inCasino = false;
  private casinoIn = casinoOf(false);
  // The same for the kit venues (bathhouse, ...): the look of the one the camera is in, or was in until the light is down.
  private venueIn = 0;
  private lit: { look: KitLook; indoor: boolean } | null = null;
  private readonly venues = new Map<string, VenueScene>();
  private readonly venueModels: KitModel[] = [];
  private surfacesInWorld: FloorSurfaces[];
  private readonly occupied: Record<Zone, ReadonlySet<number>> = perZone(() => new Set());
  private readonly renderer: WebGLRenderer;
  private readonly background = new Color(packRgb(DAY_LOOK.fogColor));
  private readonly fog = new Fog(packRgb(DAY_LOOK.fogColor), DAY_LOOK.fogNear, DAY_LOOK.fogFar);
  private readonly landscape: Landscape;
  private readonly dharma: DharmaScene;
  private readonly casino: CasinoScene;
  private readonly venueLights: VenueLights;
  private readonly indoorColor = new Color(THEME.scene.dharmaBackground);
  private readonly casinoColor = new Color(THEME.scene.casinoBackground);
  private readonly venueColor = new Color();
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
    this.dharma = new DharmaScene(this.renderer, this.quality, assets.models.dharma, assets.models.buddha.buddha, assets.models.venue.lantern);
    this.dharma.setPresence(this.dharmaShare());
    this.scene.add(this.dharma.group);
    this.casino = new CasinoScene(assets.models.casino, assets.models.world.ground, this.quality);
    this.scene.add(this.casino.group);
    this.venueLights = new VenueLights(this.quality);
    this.scene.add(this.venueLights.group);
    this.surfacesInWorld = [this.landscape.surfaces, this.dharma.surfaces, this.casino.surfaces];
    this.pool = new MonkPool(this.scene, monkAssets, MAX_MONKS);

    const region = regionFor(this.area);
    this.rig = new CameraRig(this.camera, region.bounds, region.limits, WORLD_KEEP_OUTS, WORLD_SOLIDS);
    this.resetCamera();
    this.rig.follow(ARRIVAL.x, ARRIVAL.z, 0, true);

    this.input = new PointerInput(canvas, {
      onOrbit: (dx, dy) => {
        this.idleSpin = false;
        this.rig.orbit(dx, dy);
      },
      onZoom: (factor) => this.rig.zoom(factor),
      onStick: (stick) => this.callbacks.onStick(stick),
      onTap: (clientX, clientY) => this.callbacks.onTap(clientX, clientY),
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
    if (!this.aimAt(clientX, clientY)) return null;
    const hit = pickFloor(this.raycaster, this.pickable());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  // The casino machine under a screen point, when nothing solid is in front of it.
  machineAt(clientX: number, clientY: number): MachineSpot | null {
    if (!this.aimAt(clientX, clientY)) return null;
    return this.casino.machineAt(pickHit(this.raycaster, this.pickable()));
  }

  private aimAt(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
    aimThroughCamera(this.raycaster, this.ndc, this.camera);
    return true;
  }

  private pickable(): readonly FloorSurfaces[] {
    return this.surfacesInWorld;
  }

  // Puts the venues built from kits into the world once their models have loaded (they come after the game has started). A venue
  // whose seats are already taken shows them at once.
  addVenues(models: readonly KitModel[]): void {
    for (const model of models) {
      const spec = kitById(model.id);
      if (!spec || this.venues.has(model.id)) {
        model.dispose();
        continue;
      }
      const venue = new VenueScene(spec, model);
      this.venueModels.push(model);
      this.venues.set(model.id, venue);
      this.scene.add(venue.group);
      const zone = ZONES.find((candidate) => candidate === model.id);
      if (zone) this.applyOccupancy(zone);
    }
    this.surfacesInWorld = [this.landscape.surfaces, this.dharma.surfaces, this.casino.surfaces, ...[...this.venues.values()].map((venue) => venue.surfaces)];
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

  private setArea(zone: Zone): void {
    if (zone === this.area) return;
    this.area = zone;
    this.applyRegion();
    this.callbacks.onZone(zone);
  }

  private setInCasino(inside: boolean): void {
    if (inside === this.inCasino) return;
    this.inCasino = inside;
    this.applyRegion();
  }

  // The camera's box and zoom range: the casino's room while the monk is inside it, otherwise the part of the world the area names.
  private applyRegion(): void {
    const region = this.inCasino ? casinoRegion() : regionFor(this.area);
    this.rig.setRegion(region.bounds, region.limits, REGION_BLEND_SECONDS);
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
      entry.avatar.bite = view.bite;
      const zone = venueAt(view.x, view.z);
      entry.avatar.seatTop = SEAT_TOPS[zone];
      entry.avatar.seatPose = SEAT_POSES[zone];
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

  // Which seats of a zone are taken.
  setOccupancy(zone: Zone, occupied: ReadonlySet<number>): void {
    this.occupied[zone] = occupied;
    this.applyOccupancy(zone);
  }

  private applyOccupancy(zone: Zone): void {
    const occupied = this.occupied[zone];
    const venue = this.venues.get(zone);
    if (venue) {
      venue.setOccupancy(occupied);
      return;
    }
    if (zone !== DHARMA_VENUE.id && zone !== GATBAWI_VENUE.id) return;
    for (let id = 0; id < SEAT_COUNT; id += 1) {
      if (zone === DHARMA_VENUE.id) this.dharma.setOccupied(id, occupied.has(id));
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
    this.setInCasino(false);
    this.setArea(START_ZONE);
    this.dharmaIn = dharmaOf(START_ZONE);
    this.venueIn = 0;
    this.casinoIn = casinoOf(false);
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
    if (INDOOR[this.area] || this.inCasino) return null;
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
    this.stop();
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.clear();
    this.pool.dispose();
    for (const venue of this.venues.values()) venue.dispose();
    for (const model of this.venueModels) model.dispose();
    this.venueLights.dispose();
    this.casino.dispose();
    this.dharma.dispose();
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

  private dharmaShare(): number {
    return smooth(this.dharmaIn);
  }

  // The camera is in the room itself, not just following someone who is: only then are the front wall and the roof in the way.
  private cameraInRoom(): boolean {
    return pointInRoom(this.camera.position);
  }

  // The air, the lights and the colour behind the world go over from the open ground's to the 법당's as its share rises, from there
  // to the casino's as the casino's share does, and from there to a kit venue's own air while the camera is in one that is indoors.
  private applyAtmosphere(share: number, casinoShare: number, venueShare: number): void {
    const look = this.landscape.look;
    const dharmaShare = share * (1 - casinoShare);
    const lit = this.lit;
    const airShare = lit?.indoor ? venueShare * (1 - casinoShare) : 0;
    this.background.setHex(packRgb(look.fogColor)).lerp(this.indoorColor, dharmaShare).lerp(this.casinoColor, casinoShare);
    let near = look.fogNear + (DHARMA_FOG.near - look.fogNear) * dharmaShare;
    let far = look.fogFar + (DHARMA_FOG.far - look.fogFar) * dharmaShare;
    near += (CASINO_FOG.near - near) * casinoShare;
    far += (CASINO_FOG.far - far) * casinoShare;
    if (lit && airShare > 0) {
      this.background.lerp(this.venueColor.set(lit.look.air), airShare);
      near += (lit.look.fog.near - near) * airShare;
      far += (lit.look.fog.far - far) * airShare;
    }
    this.fog.color.copy(this.background);
    this.fog.near = near;
    this.fog.far = far;
    this.landscape.setIndoor(Math.max(share, casinoShare, airShare));
    this.dharma.setPresence(share);
    this.venueLights.show(lit?.look ?? null, venueShare, this.reduceMotion ? null : this.time);
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
    if (self) {
      this.setArea(venueAt(self.x, self.z));
      this.setInCasino(insideBounds(CASINO_SHELL, self.x, self.z));
    }
    for (const entry of this.entries.values()) {
      entry.avatar.hidden = entry !== self && venueAt(entry.x, entry.z) !== this.area;
    }
    this.pool.flush();

    if (self) {
      this.rig.follow(self.x, self.z, dt);
    } else if (this.idleSpin && !this.reduceMotion) {
      this.rig.yaw += dt * 0.05;
    }
    this.rig.update(dt);
    this.camera.updateMatrixWorld();

    const wanted = dharmaOf(this.area);
    const step = this.reduceMotion ? 1 : dt / REGION_BLEND_SECONDS;
    this.dharmaIn = approach(this.dharmaIn, wanted, step);
    this.casinoIn = approach(this.casinoIn, casinoOf(this.inCasino), step);
    const kit = this.venues.has(this.area) ? kitById(this.area) : undefined;
    if (kit?.look) this.lit = { look: kit.look, indoor: INDOOR[this.area] };
    this.venueIn = approach(this.venueIn, kit?.look ? 1 : 0, step);
    for (const venue of this.venues.values()) venue.setCutaway(venue.spec.id === this.area);
    const casinoShare = smooth(this.casinoIn);
    this.landscape.setCutaway(this.area === DHARMA_VENUE.id && !this.cameraInRoom());
    this.casino.setCutaway(this.inCasino, this.camera.position.y);
    this.casino.setPresence(casinoShare, casinoNearness(this.rig.focusPoint.x, this.rig.focusPoint.z));
    this.applyAtmosphere(this.dharmaShare(), casinoShare, smooth(this.venueIn));
    this.landscape.update(this.time, dt, this.camera, this.reduceMotion, this.rig.focusPoint);
    this.dharma.update(this.time, this.camera, this.reduceMotion);
    this.casino.update(this.time, this.reduceMotion);
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
