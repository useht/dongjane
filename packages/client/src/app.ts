import {
  type SeatResponse,
  type TempleState,
  type WorldInfo,
  ZONES,
  ZONE_SEATS,
  type Zone,
  isZone,
  otherZone,
  parseWorldParam,
  seatLabel,
  skyAt,
  worldName,
} from "@dongjane/shared";
import type { GameAssets } from "./assets/registry.ts";
import { AudioEngine } from "./audio/engine.ts";
import { ChantBellScheduler } from "./audio/chant-bell.ts";
import { SutraPlayer } from "./audio/music.ts";
import { serverHttpBase } from "./config.ts";
import { BowWatcher, type WatchedMonk } from "./game/bow-watch.ts";
import { combineAxes, floorDirection, KeyboardInput } from "./game/input.ts";
import { SelfPrediction } from "./game/prediction.ts";
import { type MonkView, World } from "./game/world.ts";
import { fetchWorlds, requestSeat } from "./net/worlds.ts";
import { RetryCancelled } from "./net/retry.ts";
import { ReturnCountdown } from "./net/return-countdown.ts";
import { WorldSession, JoinError, type LinkState } from "./net/session.ts";
import { SoloSession } from "./net/solo.ts";
import { type Profile, type Settings, loadProfile, loadSettings, newHue, saveProfile, saveSettings } from "./storage.ts";
import { Hud, type VisitorRow } from "./ui/hud.ts";
import { HudFrame } from "./ui/hud-frame.ts";
import { describeChant, seatName, zoneFullNote } from "./ui/format.ts";
import { Joystick } from "./ui/joystick.ts";
import { Overlay } from "./ui/overlay.ts";
import { SeatHints } from "./ui/seat-hints.ts";
import { SettingsSheet } from "./ui/settings.ts";
import { SoundChip } from "./ui/sound-chip.ts";
import { StageScreen } from "./ui/stage-screen.ts";

const SEAT_HINT_REACH = 2.2;
const SEAT_HINT_HEIGHT = 0.6;
const CHANT_TICK_MS = 250;
const SKY_TICK_MS = 1000;
const WORLD_POLL_MS = 10_000;
const RETURN_COUNTDOWN_SECONDS = 10;
const ENTER_ATTEMPTS = 3;
const JOIN_RETRY_DELAYS_MS: readonly number[] = [500, 1200];

interface SelfSnapshot {
  x: number;
  z: number;
  mode: string;
  seatId: number;
}

export class App {
  private readonly params = new URLSearchParams(window.location.search);
  private readonly debug = this.params.has("debug");
  private readonly base = serverHttpBase();
  private readonly audio = new AudioEngine();
  private readonly bowWatch = new BowWatcher();
  private readonly chantBell = new ChantBellScheduler();
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: HTMLElement;
  private readonly world: World;
  private readonly hud: Hud;
  private readonly hudFrame: HudFrame;
  private readonly overlay: Overlay;
  private readonly settingsSheet: SettingsSheet;
  private readonly keyboard: KeyboardInput;
  private readonly joystick: Joystick;
  private readonly seatHints: SeatHints;
  private readonly stage: StageScreen;
  private readonly soundChip: SoundChip;
  private readonly sutra: SutraPlayer;
  private readonly hintPoint = { x: 0, y: 0 };
  private settings: Settings = loadSettings();
  private profile: Profile | null = loadProfile();
  private session: WorldSession | SoloSession | null = null;
  private worlds: WorldInfo[] = [];
  private currentWorld = 0;
  private joinToken = 0;
  private self: SelfSnapshot | null = null;
  private zone: Zone = "gatbawi";
  private seatOwners = new Map<number, string>();
  private readonly prediction = new SelfPrediction();
  private lastFrameMs = 0;
  private nextChantTick = 0;
  private nextSkyTick = 0;
  private chantOverride: { label: string; startsAt: number; durationMs: number } | null = null;
  private lastViews: MonkView[] = [];
  private lost = false;
  private videoAudible = false;
  private stageToasted = false;
  private inSolo = false;
  private soloReturnWorld: number | null = null;
  private returnHeld = false;
  private readonly returnCountdown = new ReturnCountdown(
    (seconds) => this.hud.setSolo({ kind: "countdown", seconds }),
    () => void this.returnToWorld(),
  );

  constructor(assets: GameAssets) {
    this.canvas = document.getElementById("stage") as HTMLCanvasElement;
    this.ui = document.getElementById("ui") as HTMLElement;

    this.joystick = new Joystick(this.ui);
    this.world = new World(
      this.canvas,
      {
        onFrame: (dt, now) => this.frame(dt, now),
        onRendered: () => {
          this.updateSeatHints();
          if (this.stage.mounted) this.stage.place(this.world.screenQuad());
        },
        onStick: (stick) => this.joystick.set(stick),
      },
      assets,
    );
    this.world.setReduceMotion(this.settings.reduceMotion);

    this.stage = new StageScreen(
      this.canvas,
      { width: this.world.quality.videoWidth, height: this.world.quality.videoHeight },
      () => this.world.serverNowAt(performance.now()),
      {
        onStatus: (status) => {
          if (status === "blocked" && !this.stageToasted) {
            this.stageToasted = true;
            this.hud.toast("무대 영상을 열 수 없어요");
          }
          this.syncZoneSound();
        },
        onTapNeeded: (needed) => this.soundChip.show(needed),
        onAudible: (audible) => {
          this.videoAudible = audible;
          this.syncZoneSound();
        },
      },
    );
    this.stage.setReduceMotion(this.settings.reduceMotion);
    this.sutra = new SutraPlayer(
      this.audio,
      () => this.world.serverNowAt(performance.now()),
      async () => (await import("./assets/audio/sutra.mp3?url")).default,
    );

    this.hud = new Hud(this.ui, {
      onSwitchWorld: (world) => void this.enter(world),
      onOpenWorlds: () => void this.refreshWorlds(),
      onBow: () => this.bow(),
      onStand: () => this.stand(),
      onInvite: () => void this.copyInvite(),
      onToggleSound: () => this.updateSettings({ ...this.settings, sound: !this.settings.sound }),
      onOpenSettings: () => this.settingsSheet.sheet.open(),
      onCancelReturn: () => this.holdReturn(),
      onReturnNow: () => void this.enter(this.soloReturnWorld),
    });
    this.settingsSheet = new SettingsSheet(this.ui, this.settings, {
      onChange: (next) => this.updateSettings(next),
    });
    this.soundChip = new SoundChip(this.ui, () => this.stage.openTapWindow());
    this.seatHints = new SeatHints(this.ui, (id) => {
      this.prediction.cancel();
      this.session?.sit(this.zone, id);
    });
    this.hudFrame = new HudFrame(this.ui);
    this.overlay = new Overlay(this.ui);
    this.keyboard = new KeyboardInput(window, {
      onBow: () => this.bow(),
      onStand: () => {
        if (!this.hud.closeSheets()) this.stand();
      },
    });

    this.applyAudio();
    this.hud.setSoundOn(this.settings.sound);
    this.syncZoneSound();
    this.bindAudioUnlock();
    this.bindLifecycle();
    this.fitCameraToHud();
    window.addEventListener("resize", () => this.fitCameraToHud());
    if (this.debug) this.bindDebug();
    this.world.start();
  }

  async start(): Promise<void> {
    this.ensureProfile();
    this.world.setIdleSpin(false);
    const requested = parseWorldParam(this.params.get("world"));
    await this.enter(requested);
    window.setInterval(() => void this.pollWorlds(), WORLD_POLL_MS);
  }

  private async enter(requested: number | null): Promise<void> {
    const profile = this.profile;
    if (!profile) return;
    this.returnCountdown.cancel();
    const token = ++this.joinToken;
    this.lost = false;
    this.inSolo = false;
    await this.leaveCurrent();
    if (token !== this.joinToken) return;

    this.world.clear();
    this.bowWatch.reset();
    this.self = null;
    this.prediction.cancel();
    this.seatOwners.clear();
    this.hud.setLink("online");
    this.overlay.loading("월드로 들어가는 중이에요", "잠시만 기다려 주세요");

    const returnWorld = requested ?? (this.currentWorld || null);
    const retry = { label: "다시 시도", run: () => void this.enter(returnWorld) };

    let busyFailures = 0;
    let transportFailures = 0;
    while (busyFailures < ENTER_ATTEMPTS) {
      let seat: SeatResponse;
      try {
        seat = await requestSeat(this.base, requested, {
          isCancelled: () => token !== this.joinToken,
          onRetry: () => this.overlay.loading("서버에 연결하는 중이에요", "잠시만 기다려 주세요"),
        });
      } catch (error) {
        if (token === this.joinToken && !(error instanceof RetryCancelled)) this.showUnreachable([retry, this.soloAction(returnWorld)]);
        return;
      }
      if (token !== this.joinToken) return;

      try {
        const session = await WorldSession.join(
          this.base,
          seat.roomId,
          seat.world,
          { hue: profile.hue, zone: this.zone },
          {
            onState: (state) => {
              if (token === this.joinToken) this.handleState(state);
            },
            onLink: (link) => {
              if (token === this.joinToken) this.handleLink(link);
            },
            onRelocate: (world) => {
              if (token !== this.joinToken) return;
              this.hud.toast(`월드가 합쳐져서 ${worldName(world)}로 옮겨 드려요`);
              void this.enter(world);
            },
            onZoneFull: (zone) => {
              if (token === this.joinToken) this.hud.toast(zoneFullNote(zone, otherZone(zone)));
            },
          },
        );
        if (token !== this.joinToken) {
          void session.leave();
          return;
        }
        this.attach(session, seat.world, seat.fellBack ? requested : null);
        return;
      } catch (error) {
        if (token !== this.joinToken) return;
        if (error instanceof JoinError && error.reason !== "offline") {
          busyFailures += 1;
          continue;
        }
        const delay = JOIN_RETRY_DELAYS_MS[transportFailures];
        if (delay === undefined) {
          this.showUnreachable([retry, this.soloAction(returnWorld)]);
          return;
        }
        transportFailures += 1;
        this.overlay.loading("서버에 연결하는 중이에요", "잠시만 기다려 주세요");
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (token !== this.joinToken) return;
      }
    }
    if (token === this.joinToken) {
      this.overlay.problem("월드에 들어가지 못했어요", "월드가 바쁜 것 같아요. 잠시 뒤 다시 시도해 주세요.", [retry]);
    }
  }

  private ensureProfile(): Profile {
    if (!this.profile) {
      this.profile = { hue: newHue() };
      saveProfile(this.profile);
    }
    return this.profile;
  }

  private soloAction(returnWorld: number | null): { label: string; run(): void } {
    return { label: "혼자 월드에서 쉬기", run: () => void this.enterSolo(returnWorld) };
  }

  private async enterSolo(returnWorld: number | null): Promise<void> {
    const profile = this.ensureProfile();
    this.returnCountdown.cancel();
    this.returnHeld = false;
    const token = ++this.joinToken;
    this.lost = false;
    await this.leaveCurrent();
    if (token !== this.joinToken) return;
    this.inSolo = true;
    this.soloReturnWorld = returnWorld;

    this.world.clear();
    this.bowWatch.reset();
    this.self = null;
    this.prediction.cancel();
    this.seatOwners.clear();
    this.applyZone("gatbawi");

    const session = new SoloSession(profile.hue, {
      onState: (state) => {
        if (token === this.joinToken) this.handleState(state);
      },
    });
    this.session = session;
    this.syncZoneSound();
    this.currentWorld = 0;
    this.world.selfId = session.sessionId;
    this.world.resetCamera();
    this.world.seedServerTime(Date.now(), performance.now());
    this.hud.setSolo({ kind: "idle" });
    this.overlay.hide();
    this.handleState(session.state);
  }

  private attach(session: WorldSession, world: number, fellBackFrom: number | null): void {
    this.session = session;
    this.syncZoneSound();
    this.currentWorld = world;
    this.world.selfId = session.sessionId;
    this.world.resetCamera();
    this.hud.setWorlds(this.worlds, world);
    void this.refreshWorlds();

    const url = new URL(window.location.href);
    url.searchParams.set("world", String(world));
    window.history.replaceState(null, "", url);

    this.overlay.hide();
    if (fellBackFrom !== null) {
      this.hud.toast(`${worldName(fellBackFrom)}는 없거나 비어 있거나 가득 차서 ${worldName(world)}로 모셨어요`);
    }
    this.handleState(session.state);
  }

  private async leaveCurrent(): Promise<void> {
    const old = this.session;
    this.session = null;
    if (old) await old.leave();
  }

  private handleState(state: TempleState): void {
    const session = this.session;
    if (!session) return;
    const now = performance.now();
    const selfId = session.sessionId;

    const mine = state.monks.get(selfId);
    if (mine && isZone(mine.zone) && mine.zone !== this.zone) this.applyZone(mine.zone);
    const zone = this.zone;

    const views: MonkView[] = [];
    const rows: VisitorRow[] = [];
    const watched: WatchedMonk[] = [];
    const counts: Record<Zone, number> = { gatbawi: 0, dharma: 0 };
    state.monks.forEach((monk) => {
      const here = monk.zone === zone;
      if (here) {
        views.push({
          id: monk.id,
          hue: monk.hue,
          x: monk.x,
          z: monk.z,
          yaw: monk.yaw,
          mode: monk.mode,
          zone,
          seatId: monk.seatId,
        });
      }
      // computer-driven monks are drawn but are not visitors: no count, no list row, no greeting
      if (monk.npc) return;
      if (isZone(monk.zone)) counts[monk.zone] += 1;
      if (here) watched.push({ id: monk.id, slot: monk.slot, x: monk.x, z: monk.z, mode: monk.mode });
      rows.push({
        id: monk.id,
        slot: monk.slot,
        mode: monk.mode,
        zone: monk.zone,
        seatId: monk.seatId,
        bowCount: monk.bowCount,
        isSelf: monk.id === selfId,
      });
      if (monk.id === selfId) {
        this.self = { x: monk.x, z: monk.z, mode: monk.mode, seatId: monk.seatId };
        this.prediction.reconcile({ x: monk.x, z: monk.z, mode: monk.mode, ackSeq: monk.ackSeq });
        this.hud.setSelf({ mode: monk.mode, seatId: monk.seatId });
      }
    });
    this.lastViews = views;

    const owners = new Map<number, string>();
    const occupied = new Set<number>();
    state.seats.forEach((seat) => {
      if (seat.zone !== zone || seat.occupantId === "") return;
      occupied.add(seat.id);
      if (!state.monks.get(seat.occupantId)?.npc) owners.set(seat.id, seat.occupantId);
    });
    this.seatOwners = owners;

    this.world.setSelfPrediction(this.prediction.display());
    this.world.applyMonks(views, now, state.serverTime);
    this.world.setOccupancy(occupied);

    rows.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.slot - b.slot);
    this.hud.setVisitors(rows);
    this.syncWorldCount(rows.length, counts);

    const report = this.bowWatch.update(watched, selfId, now);
    if (report.selfStarted) this.audio.knock();
    for (const slot of report.greeters) this.hud.toast(`${seatLabel(slot)}님이 인사했어요`);
  }

  private syncWorldCount(count: number, zones: Record<Zone, number>): void {
    const info = this.worlds.find((entry) => entry.world === this.currentWorld);
    if (!info) return;
    const same = info.clients === count && ZONES.every((zone) => info.zones[zone] === zones[zone]);
    if (same) return;
    info.clients = count;
    info.zones = { ...zones };
    info.full = count >= info.capacity;
    this.hud.setWorlds(this.worlds, this.currentWorld);
  }

  // Which zone the visitor is in follows the server's state. Everything that was drawn or predicted for the old zone is dropped.
  private applyZone(zone: Zone): void {
    this.zone = zone;
    this.prediction.cancel();
    this.prediction.zone = zone;
    this.seatHints.hideAll();
    this.world.setZone(zone);
    this.syncZoneSound();
  }

  // What belongs to where the visitor stands: the concert video and the wind outdoors, the sutra in the 법당.
  private syncZoneSound(): void {
    const outdoors = this.zone === "gatbawi";
    const live = outdoors && this.session !== null && !this.inSolo;
    if (live && !this.stage.mounted && this.stage.status !== "blocked") this.stage.mount();
    else if (!live && this.stage.mounted) this.stage.unmount();
    this.world.setScreenMode(this.stage.mounted && !this.settings.reduceMotion ? "video" : "poster");
    this.sutra.setIndoors(this.zone === "dharma" && this.session !== null);
    this.audio.setWindAllowed(outdoors && !this.videoAudible);
  }

  private handleLink(link: LinkState): void {
    this.hud.setLink(link);
    if (link !== "lost") return;
    this.lost = true;
    this.session = null;
    this.syncZoneSound();
    this.prediction.cancel();
    this.world.clear();
    this.overlay.problem("연결이 끊어졌어요", "월드와의 연결이 끊겼어요. 다시 들어가 볼까요?", [
      { label: "다시 들어가기", run: () => void this.enter(this.currentWorld || null) },
      this.soloAction(this.currentWorld || null),
    ]);
  }

  private showUnreachable(actions: { label: string; run(): void }[]): void {
    this.syncZoneSound();
    if (!navigator.onLine) {
      this.overlay.problem("인터넷에 연결되어 있지 않아요", "연결을 확인한 뒤 다시 시도해 주세요.", actions);
    } else {
      this.overlay.problem("월드를 열지 못했어요", "서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.", actions);
    }
  }

  private bow(): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    const seated = this.self && this.self.seatId >= 0 && this.self.mode === "kneel";
    if (!seated) {
      if (this.self?.mode !== "bow") this.hud.toast(`${seatName(this.zone)}에 앉아야 절할 수 있어요`);
      return;
    }
    session.bow(1);
  }

  private stand(): void {
    this.prediction.cancel();
    if (this.self && this.self.mode !== "stand") this.session?.stand();
  }

  private updateSettings(next: Settings): void {
    this.settings = next;
    saveSettings(next);
    this.settingsSheet.sync(next);
    this.hud.setSoundOn(next.sound);
    this.world.setReduceMotion(next.reduceMotion);
    this.stage.setReduceMotion(next.reduceMotion);
    this.applyAudio();
    this.syncZoneSound();
  }

  private applyAudio(): void {
    this.audio.configure(this.settings.volume, this.settings.sound, this.settings.wind);
    this.stage.setSound(this.settings.sound, this.settings.volume);
  }

  private bindAudioUnlock(): void {
    const unlock = (): void => {
      this.audio.unlock();
      this.stage.userGesture();
      if (this.audio.unlocked) {
        window.removeEventListener("pointerdown", unlock, true);
        window.removeEventListener("keydown", unlock, true);
        window.removeEventListener("touchend", unlock, true);
      }
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("touchend", unlock, true);
  }

  private fitCameraToHud(): void {
    const { top, bottom } = this.hudFrame.measure();
    this.world.setHudInsets(top, bottom);
  }

  private bindLifecycle(): void {
    document.addEventListener("visibilitychange", () => {
      const hidden = document.visibilityState !== "visible";
      this.stage.setHidden(hidden);
      this.sutra.setHidden(hidden);
      if (!hidden && this.lost) void this.enter(this.currentWorld || null);
    });
    window.addEventListener("online", () => {
      if (this.lost) void this.enter(this.currentWorld || null);
    });
    window.addEventListener("pagehide", () => {
      void this.session?.leave();
    });
  }

  private bindDebug(): void {
    const chantSeconds = Number(this.params.get("debugChant"));
    if (Number.isFinite(chantSeconds) && chantSeconds > 0) {
      this.chantOverride = { label: "시험 예불", startsAt: Date.now() + chantSeconds * 1000, durationMs: 20_000 };
    }
    window.setInterval(() => {
      const stats = this.world.currentStats;
      this.hud.setStats(
        `${stats.fps} fps · ${stats.drawCalls} calls\n${Math.round(stats.triangles / 1000)}k tris · ${stats.monks} monks\npr ${stats.pixelRatio.toFixed(2)} · ${this.audio.unlocked ? "audio on" : "audio locked"}`,
      );
    }, 500);
    (window as unknown as { __dongjane: unknown }).__dongjane = {
      world: this.world,
      stats: () => this.world.currentStats,
      monks: () => this.lastViews,
      self: () => this.self,
      sessionId: () => this.session?.sessionId ?? null,
      worldNumber: () => this.currentWorld,
      bellCount: () => this.audio.bellCount,
      stage: () => ({ status: this.stage.status, mounted: this.stage.mounted, audible: this.videoAudible }),
      sutraPlaying: () => this.sutra.playing,
      serverNow: () => this.world.serverNowAt(performance.now()),
    };
  }

  private async refreshWorlds(): Promise<boolean> {
    try {
      this.worlds = await fetchWorlds(this.base, undefined, undefined, (serverTime) =>
        this.world.seedServerTime(serverTime, performance.now()),
      );
      if (this.currentWorld) this.hud.setWorlds(this.worlds, this.currentWorld);
      return true;
    } catch {
      // the list keeps its last known counts; joining reports a real failure
      return false;
    }
  }

  private async pollWorlds(): Promise<void> {
    if (document.visibilityState !== "visible" || !this.session) return;
    const reachable = await this.refreshWorlds();
    if (reachable && this.inSolo && !this.returnHeld && !this.returnCountdown.running) {
      this.returnCountdown.start(RETURN_COUNTDOWN_SECONDS);
    }
  }

  private async returnToWorld(): Promise<void> {
    const reachable = await this.refreshWorlds();
    if (!this.inSolo || this.returnHeld) return;
    if (reachable) void this.enter(this.soloReturnWorld);
    else this.hud.setSolo({ kind: "idle" });
  }

  private holdReturn(): void {
    this.returnCountdown.cancel();
    this.returnHeld = true;
    this.hud.setSolo({ kind: "held" });
  }

  private async copyInvite(): Promise<void> {
    if (!this.currentWorld) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("world", String(this.currentWorld));
    const link = url.toString();
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      copied = this.copyWithSelection(link);
    }
    this.hud.toast(copied ? `${worldName(this.currentWorld)} 초대 링크를 복사했어요` : link);
  }

  private copyWithSelection(text: string): boolean {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;opacity:0;pointer-events:none;top:0;left:0";
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  }

  private frame(dt: number, nowMs: number): void {
    const elapsed = this.lastFrameMs > 0 ? (nowMs - this.lastFrameMs) / 1000 : dt;
    this.lastFrameMs = nowMs;
    this.driveMovement(dt, Math.max(0, elapsed), nowMs);
    if (nowMs >= this.nextChantTick) {
      this.nextChantTick = nowMs + CHANT_TICK_MS;
      this.tickChant();
    }
    if (nowMs >= this.nextSkyTick) {
      this.nextSkyTick = nowMs + SKY_TICK_MS;
      this.tickSky();
    }
  }

  private driveMovement(dt: number, realDt: number, nowMs: number): void {
    const turn = this.keyboard.rotation();
    if (turn !== 0) this.world.rig.orbit(turn * dt * 1.8, 0);

    const session = this.session;
    const displayed = this.world.selfPosition;
    if (!session || !this.self || !displayed) return;
    const axes = combineAxes(this.keyboard.axes(), this.joystick.axes());
    const moving = axes.forward !== 0 || axes.right !== 0;
    const dir = moving ? floorDirection(axes, this.world.rig.forward) : null;
    const target = this.prediction.frame(realDt, nowMs, dir, displayed);
    this.world.setSelfPrediction(this.prediction.display());
    if (target) session.move(target.x, target.z, target.seq);
  }

  private updateSeatHints(): void {
    const self = this.self;
    if (!this.session || !self || self.seatId >= 0) {
      this.seatHints.hideAll();
      return;
    }
    for (const spot of ZONE_SEATS[this.zone]) {
      const reachable = !this.seatOwners.has(spot.id) && Math.hypot(spot.x - self.x, spot.z - self.z) <= SEAT_HINT_REACH;
      if (reachable && this.world.projectToScreen(spot.x, SEAT_HINT_HEIGHT, spot.z, this.hintPoint)) {
        this.seatHints.place(spot.id, this.hintPoint.x, this.hintPoint.y);
      } else {
        this.seatHints.hide(spot.id);
      }
    }
  }

  private tickSky(): void {
    const serverNow = this.world.serverNowAt(performance.now());
    const sky = serverNow === null ? null : skyAt(serverNow);
    if (sky) this.world.setSky(sky);
    this.hud.setSky(sky);
  }

  private tickChant(): void {
    const session = this.session;
    if (!session) {
      this.hud.setChant(null);
      return;
    }
    const chant = this.chantOverride ?? session.state.chant;
    const now = Date.now();
    this.chantBell.observe(chant, now);
    if (this.chantBell.shouldRing(chant, now)) {
      this.audio.bell();
      this.hud.toast(`${chant.label}이 시작됐어요`);
    }
    const status = describeChant(chant, now);
    this.hud.setChant(status.phase === "ended" ? null : status);
  }
}
