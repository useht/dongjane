import {
  CUSHION_SPOTS,
  type HallInfo,
  type SeatResponse,
  type TempleState,
  hallName,
  parseHallParam,
  seatLabel,
  skyAt,
} from "@dongjane/shared";
import { AudioEngine } from "./audio/engine.ts";
import { ChantBellScheduler } from "./audio/chant-bell.ts";
import { serverHttpBase } from "./config.ts";
import { BowWatcher, type WatchedMonk } from "./game/bow-watch.ts";
import { combineAxes, floorDirection, KeyboardInput } from "./game/input.ts";
import { SelfPrediction } from "./game/prediction.ts";
import { type MonkView, World } from "./game/world.ts";
import { fetchHalls, requestSeat } from "./net/halls.ts";
import { RetryCancelled } from "./net/retry.ts";
import { ReturnCountdown } from "./net/return-countdown.ts";
import { HallSession, JoinError, type LinkState } from "./net/session.ts";
import { SoloSession } from "./net/solo.ts";
import { type Profile, type Settings, loadProfile, loadSettings, newHue, saveProfile, saveSettings } from "./storage.ts";
import { Hud, type VisitorRow } from "./ui/hud.ts";
import { HudFrame } from "./ui/hud-frame.ts";
import { describeChant } from "./ui/format.ts";
import { Joystick } from "./ui/joystick.ts";
import { EmoteBubbles } from "./ui/emote-bubbles.ts";
import { Overlay } from "./ui/overlay.ts";
import { SeatHints } from "./ui/seat-hints.ts";
import { SettingsSheet } from "./ui/settings.ts";

const SEAT_HINT_REACH = 2.2;
const SEAT_HINT_HEIGHT = 0.6;
const CHANT_TICK_MS = 250;
const SKY_TICK_MS = 1000;
const HALL_POLL_MS = 10_000;
const RETURN_COUNTDOWN_SECONDS = 10;
const ENTER_ATTEMPTS = 3;
const JOIN_RETRY_DELAYS_MS: readonly number[] = [500, 1200];

interface SelfSnapshot {
  x: number;
  z: number;
  mode: string;
  cushionId: number;
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
  private readonly emoteBubbles: EmoteBubbles;
  private readonly hintPoint = { x: 0, y: 0 };
  private settings: Settings = loadSettings();
  private profile: Profile | null = loadProfile();
  private session: HallSession | SoloSession | null = null;
  private halls: HallInfo[] = [];
  private currentHall = 0;
  private joinToken = 0;
  private self: SelfSnapshot | null = null;
  private occupiedCushions = new Set<number>();
  private readonly prediction = new SelfPrediction();
  private lastFrameMs = 0;
  private nextChantTick = 0;
  private nextSkyTick = 0;
  private chantOverride: { label: string; startsAt: number; durationMs: number } | null = null;
  private lastViews: MonkView[] = [];
  private lost = false;
  private inSolo = false;
  private soloReturnHall: number | null = null;
  private returnHeld = false;
  private readonly returnCountdown = new ReturnCountdown(
    (seconds) => this.hud.setSolo({ kind: "countdown", seconds }),
    () => void this.returnToHall(),
  );

  constructor() {
    this.canvas = document.getElementById("stage") as HTMLCanvasElement;
    this.ui = document.getElementById("ui") as HTMLElement;

    this.joystick = new Joystick(this.ui);
    this.world = new World(this.canvas, {
      onFrame: (dt, now) => this.frame(dt, now),
      onRendered: (nowMs) => {
        this.updateSeatHints();
        this.emoteBubbles.update(nowMs);
      },
      onStick: (stick) => this.joystick.set(stick),
    });
    this.world.setReduceMotion(this.settings.reduceMotion);
    this.emoteBubbles = new EmoteBubbles(this.ui, this.world.emotes, (id, out) => this.world.projectEmoteAnchor(id, out));

    this.hud = new Hud(this.ui, {
      onSwitchHall: (hall) => void this.enter(hall),
      onOpenHalls: () => void this.refreshHalls(),
      onBow: () => this.bow(),
      onStand: () => this.stand(),
      onEmote: (emote) => this.session?.emote(emote),
      onInvite: () => void this.copyInvite(),
      onToggleSound: () => this.updateSettings({ ...this.settings, sound: !this.settings.sound }),
      onOpenSettings: () => this.settingsSheet.sheet.open(),
      onCancelReturn: () => this.holdReturn(),
      onReturnNow: () => void this.enter(this.soloReturnHall),
    });
    this.settingsSheet = new SettingsSheet(this.ui, this.settings, {
      onChange: (next) => this.updateSettings(next),
    });
    this.seatHints = new SeatHints(this.ui, (id) => {
      this.prediction.cancel();
      this.session?.sit(id);
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
    const requested = parseHallParam(this.params.get("hall"));
    await this.enter(requested);
    window.setInterval(() => void this.pollHalls(), HALL_POLL_MS);
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
    this.occupiedCushions.clear();
    this.hud.setLink("online");
    this.overlay.loading("법당으로 들어가는 중이에요", "잠시만 기다려 주세요");

    const returnHall = requested ?? (this.currentHall || null);
    const retry = { label: "다시 시도", run: () => void this.enter(returnHall) };

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
        if (token === this.joinToken && !(error instanceof RetryCancelled)) this.showUnreachable([retry, this.soloAction(returnHall)]);
        return;
      }
      if (token !== this.joinToken) return;

      try {
        const session = await HallSession.join(
          this.base,
          seat.roomId,
          seat.hall,
          { hue: profile.hue },
          {
            onState: (state) => {
              if (token === this.joinToken) this.handleState(state);
            },
            onLink: (link) => {
              if (token === this.joinToken) this.handleLink(link);
            },
            onRelocate: (hall) => {
              if (token !== this.joinToken) return;
              this.hud.toast(`법당이 합쳐져서 ${hallName(hall)}으로 옮겨 드려요`);
              void this.enter(hall);
            },
          },
        );
        if (token !== this.joinToken) {
          void session.leave();
          return;
        }
        this.attach(session, seat.hall, seat.fellBack ? requested : null);
        return;
      } catch (error) {
        if (token !== this.joinToken) return;
        if (error instanceof JoinError && error.reason !== "offline") {
          busyFailures += 1;
          continue;
        }
        const delay = JOIN_RETRY_DELAYS_MS[transportFailures];
        if (delay === undefined) {
          this.showUnreachable([retry, this.soloAction(returnHall)]);
          return;
        }
        transportFailures += 1;
        this.overlay.loading("서버에 연결하는 중이에요", "잠시만 기다려 주세요");
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (token !== this.joinToken) return;
      }
    }
    if (token === this.joinToken) {
      this.overlay.problem("법당에 들어가지 못했어요", "법당이 바쁜 것 같아요. 잠시 뒤 다시 시도해 주세요.", [retry]);
    }
  }

  private ensureProfile(): Profile {
    if (!this.profile) {
      this.profile = { hue: newHue() };
      saveProfile(this.profile);
    }
    return this.profile;
  }

  private soloAction(returnHall: number | null): { label: string; run(): void } {
    return { label: "혼자 법당에서 쉬기", run: () => void this.enterSolo(returnHall) };
  }

  private async enterSolo(returnHall: number | null): Promise<void> {
    const profile = this.ensureProfile();
    this.returnCountdown.cancel();
    this.returnHeld = false;
    const token = ++this.joinToken;
    this.lost = false;
    await this.leaveCurrent();
    if (token !== this.joinToken) return;
    this.inSolo = true;
    this.soloReturnHall = returnHall;

    this.world.clear();
    this.bowWatch.reset();
    this.self = null;
    this.prediction.cancel();
    this.occupiedCushions.clear();

    const session = new SoloSession(profile.hue, {
      onState: (state) => {
        if (token === this.joinToken) this.handleState(state);
      },
    });
    this.session = session;
    this.currentHall = 0;
    this.world.selfId = session.sessionId;
    this.world.resetCamera();
    this.world.seedServerTime(Date.now(), performance.now());
    this.hud.setSolo({ kind: "idle" });
    this.overlay.hide();
    this.handleState(session.state);
  }

  private attach(session: HallSession, hall: number, fellBackFrom: number | null): void {
    this.session = session;
    this.currentHall = hall;
    this.world.selfId = session.sessionId;
    this.world.resetCamera();
    this.hud.setHalls(this.halls, hall);
    void this.refreshHalls();

    const url = new URL(window.location.href);
    url.searchParams.set("hall", String(hall));
    window.history.replaceState(null, "", url);

    this.overlay.hide();
    if (fellBackFrom !== null) {
      this.hud.toast(`${hallName(fellBackFrom)}은 없거나 비어 있거나 가득 차서 ${hallName(hall)}으로 모셨어요`);
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

    const views: MonkView[] = [];
    const rows: VisitorRow[] = [];
    const watched: WatchedMonk[] = [];
    state.monks.forEach((monk) => {
      views.push({
        id: monk.id,
        hue: monk.hue,
        x: monk.x,
        z: monk.z,
        yaw: monk.yaw,
        mode: monk.mode,
        cushionId: monk.cushionId,
        emote: monk.emote,
        emoteSeq: monk.emoteSeq,
      });
      if (monk.npc) return;
      watched.push({ id: monk.id, slot: monk.slot, x: monk.x, z: monk.z, mode: monk.mode });
      rows.push({
        id: monk.id,
        slot: monk.slot,
        mode: monk.mode,
        cushionId: monk.cushionId,
        bowCount: monk.bowCount,
        isSelf: monk.id === selfId,
      });
      if (monk.id === selfId) {
        this.self = { x: monk.x, z: monk.z, mode: monk.mode, cushionId: monk.cushionId };
        this.prediction.reconcile({ x: monk.x, z: monk.z, mode: monk.mode, ackSeq: monk.ackSeq });
        this.hud.setSelf({ mode: monk.mode, cushionId: monk.cushionId, bowCount: monk.bowCount });
      }
    });
    this.lastViews = views;

    const occupied = new Set<number>();
    state.cushions.forEach((cushion) => {
      if (cushion.occupantId !== "") occupied.add(cushion.id);
    });
    this.occupiedCushions = occupied;

    this.world.setSelfPrediction(this.prediction.display());
    this.world.applyMonks(views, now, state.serverTime);
    this.world.setOccupancy(occupied);

    rows.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.slot - b.slot);
    this.hud.setVisitors(rows);
    this.syncHallCount(rows.length);

    const report = this.bowWatch.update(watched, selfId, now);
    if (report.selfStarted) this.audio.knock();
    for (const slot of report.greeters) this.hud.toast(`${seatLabel(slot)}님이 인사했어요`);
  }

  private syncHallCount(count: number): void {
    const info = this.halls.find((entry) => entry.hall === this.currentHall);
    if (!info || info.clients === count) return;
    info.clients = count;
    info.full = count >= info.capacity;
    this.hud.setHalls(this.halls, this.currentHall);
  }

  private handleLink(link: LinkState): void {
    this.hud.setLink(link);
    if (link !== "lost") return;
    this.lost = true;
    this.session = null;
    this.prediction.cancel();
    this.world.clear();
    this.overlay.problem("연결이 끊어졌어요", "법당과의 연결이 끊겼어요. 다시 들어가 볼까요?", [
      { label: "다시 들어가기", run: () => void this.enter(this.currentHall || null) },
      this.soloAction(this.currentHall || null),
    ]);
  }

  private showUnreachable(actions: { label: string; run(): void }[]): void {
    if (!navigator.onLine) {
      this.overlay.problem("인터넷에 연결되어 있지 않아요", "연결을 확인한 뒤 다시 시도해 주세요.", actions);
    } else {
      this.overlay.problem("법당 문을 열지 못했어요", "서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.", actions);
    }
  }

  private bow(): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    const seated = this.self && this.self.cushionId >= 0 && this.self.mode === "kneel";
    if (!seated) {
      if (this.self?.mode !== "bow") this.hud.toast("방석에 앉아야 절할 수 있어요");
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
    this.applyAudio();
  }

  private applyAudio(): void {
    this.audio.configure(this.settings.volume, this.settings.sound, this.settings.wind);
  }

  private bindAudioUnlock(): void {
    const unlock = (): void => {
      this.audio.unlock();
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
      if (document.visibilityState === "visible" && this.lost) void this.enter(this.currentHall || null);
    });
    window.addEventListener("online", () => {
      if (this.lost) void this.enter(this.currentHall || null);
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
      hall: () => this.currentHall,
      bellCount: () => this.audio.bellCount,
      serverNow: () => this.world.serverNowAt(performance.now()),
    };
  }

  private async refreshHalls(): Promise<boolean> {
    try {
      this.halls = await fetchHalls(this.base, undefined, undefined, (serverTime) =>
        this.world.seedServerTime(serverTime, performance.now()),
      );
      if (this.currentHall) this.hud.setHalls(this.halls, this.currentHall);
      return true;
    } catch {
      // the list keeps its last known counts; joining reports a real failure
      return false;
    }
  }

  private async pollHalls(): Promise<void> {
    if (document.visibilityState !== "visible" || !this.session) return;
    const reachable = await this.refreshHalls();
    if (reachable && this.inSolo && !this.returnHeld && !this.returnCountdown.running) {
      this.returnCountdown.start(RETURN_COUNTDOWN_SECONDS);
    }
  }

  private async returnToHall(): Promise<void> {
    const reachable = await this.refreshHalls();
    if (!this.inSolo || this.returnHeld) return;
    if (reachable) void this.enter(this.soloReturnHall);
    else this.hud.setSolo({ kind: "idle" });
  }

  private holdReturn(): void {
    this.returnCountdown.cancel();
    this.returnHeld = true;
    this.hud.setSolo({ kind: "held" });
  }

  private async copyInvite(): Promise<void> {
    if (!this.currentHall) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("hall", String(this.currentHall));
    const link = url.toString();
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      copied = this.copyWithSelection(link);
    }
    this.hud.toast(copied ? `${hallName(this.currentHall)} 초대 링크를 복사했어요` : link);
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
    if (!this.session || !self || self.cushionId >= 0) {
      this.seatHints.hideAll();
      return;
    }
    for (const spot of CUSHION_SPOTS) {
      const reachable = !this.occupiedCushions.has(spot.id) && Math.hypot(spot.x - self.x, spot.z - self.z) <= SEAT_HINT_REACH;
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
