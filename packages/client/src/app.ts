import {
  INDOOR,
  ITEM_CHANT,
  ITEM_MOKT,
  ITEM_NONE,
  ITEM_ROD,
  KNOCK_COOLDOWN_MS,
  JUMP_COOLDOWN_MS,
  MACHINE_REACH,
  type MachineSpot,
  type SeatResponse,
  type TempleState,
  type WorldInfo,
  WALK_SPEED,
  ZONES,
  ZONE_SEATS,
  type Zone,
  isZone,
  machineNear,
  machineSpot,
  parseWorldParam,
  perZone,
  planPath,
  seatLabel,
  skyAt,
  venueAt,
  visitorTitle,
  worldName,
} from "@dongjane/shared";
import type { GameAssets } from "./assets/registry.ts";
import { AudioEngine } from "./audio/engine.ts";
import { ChantBellScheduler } from "./audio/chant-bell.ts";
import { KNOCK_AUDIBLE_GAIN, knockGain } from "./audio/knock-gain.ts";
import clickUrl from "./assets/audio/click.mp3?url";
import coinUrl from "./assets/audio/coin.mp3?url";
import jackpotUrl from "./assets/audio/jackpot.mp3?url";
import sutraUrl from "./assets/audio/sutra.mp3?url";
import { SyncedLoop, areaMix, chantMix } from "./audio/music.ts";
import { CasinoSounds } from "./audio/casino.ts";
import { seaLevel } from "./audio/sea-level.ts";
import { CasinoBank } from "./casino/bank.ts";
import { serverHttpBase } from "./config.ts";
import { gainedBows, titlesCrossed } from "./collection/titles.ts";
import { BowWatcher, type WatchedMonk } from "./game/bow-watch.ts";
import { CatchWatcher } from "./game/catch-watch.ts";
import { machineHeight } from "./game/casino-layout.ts";
import { heldAction, isSeated } from "./game/held-action.ts";
import { combineAxes, floorDirection, headingAlong, KeyboardInput } from "./game/input.ts";
import { MAX_FRAME_DT_S, SelfPrediction } from "./game/prediction.ts";
import type { MonkAssets } from "./game/monk-assets.ts";
import { QuestTracker } from "./game/quest-tracker.ts";
import { STAGE } from "./game/venue-layout.ts";
import { type MonkView, START_ZONE, World } from "./game/world.ts";
import { fetchWorlds, requestSeat } from "./net/worlds.ts";
import { RetryCancelled } from "./net/retry.ts";
import { ReturnCountdown } from "./net/return-countdown.ts";
import { WorldSession, JoinError, type LinkState } from "./net/session.ts";
import { SoloSession } from "./net/solo.ts";
import {
  type Profile,
  type Settings,
  loadBows,
  loadProfile,
  loadSettings,
  loadWallet,
  newHue,
  saveBows,
  saveProfile,
  saveSettings,
  saveWallet,
} from "./storage.ts";
import { BackGuard } from "./ui/back-guard.ts";
import { CasinoPanel } from "./ui/casino-panel.ts";
import { Hud, type VisitorRow } from "./ui/hud.ts";
import { HudFrame } from "./ui/hud-frame.ts";
import { catchMessage, describeChant, seatName } from "./ui/format.ts";
import { InstallBanner } from "./ui/install-banner.ts";
import { Joystick } from "./ui/joystick.ts";
import { MachineHint } from "./ui/machine-hint.ts";
import { EmoteBubbles } from "./ui/emote-bubbles.ts";
import { Overlay } from "./ui/overlay.ts";
import { SeatHints } from "./ui/seat-hints.ts";
import { SettingsPanel } from "./ui/settings.ts";
import { SoundChip } from "./ui/sound-chip.ts";
import { StageHint } from "./ui/stage-hint.ts";
import { StageScreen } from "./ui/stage-screen.ts";
import type { Quad } from "./ui/stage-quad.ts";
import { hintAction, screenModeFor } from "./ui/stage-video.ts";
import { TouchIntro } from "./ui/touch-intro.ts";
import { VisitorTitles } from "./ui/visitor-titles.ts";

const SEAT_HINT_REACH = 2.2;
const SEAT_HINT_HEIGHT = 0.6;
const TITLE_REACH = SEAT_HINT_REACH;
const TITLE_GAP = 0.1;
const CHANT_TICK_MS = 250;
const SKY_TICK_MS = 1000;
const WORLD_POLL_MS = 10_000;
const RETURN_COUNTDOWN_SECONDS = 10;
const ENTER_ATTEMPTS = 3;
const JOIN_RETRY_DELAYS_MS: readonly number[] = [500, 1200];
const TAP_ARRIVE_DISTANCE = 0.1;
// The hint floats a little above the top of the machine it belongs to.
const MACHINE_HINT_LIFT = 0.2;
// Bows pay every few seconds; the toast for it speaks up at most this often.
const REWARD_TOAST_QUIET_MS = 10_000;

interface SelfSnapshot {
  x: number;
  z: number;
  mode: string;
  seatId: number;
  chanting: boolean;
  item: number;
}

export class App {
  private readonly params = new URLSearchParams(window.location.search);
  private readonly debug = this.params.has("debug");
  private readonly base = serverHttpBase();
  private readonly audio = new AudioEngine();
  private readonly bowWatch = new BowWatcher();
  private readonly catchWatch = new CatchWatcher();
  private readonly chantBell = new ChantBellScheduler();
  private readonly quests = new QuestTracker();
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: HTMLElement;
  private readonly world: World;
  private readonly hud: Hud;
  private readonly hudFrame: HudFrame;
  private readonly overlay: Overlay;
  private readonly touchIntro: TouchIntro;
  private readonly settingsPanel: SettingsPanel;
  private readonly keyboard: KeyboardInput;
  private readonly joystick: Joystick;
  private readonly seatHints: SeatHints;
  private readonly machineHint: MachineHint;
  private readonly casinoBank: CasinoBank;
  private readonly casino: CasinoPanel;
  private readonly backGuard: BackGuard;
  private readonly stageHint: StageHint;
  private readonly stage: StageScreen;
  private readonly soundChip: SoundChip;
  private readonly sutra: SyncedLoop;
  private readonly visitorTitles: VisitorTitles;
  private readonly emoteBubbles: EmoteBubbles;
  private readonly hintPoint = { x: 0, y: 0 };
  private readonly titleSelf = { x: 0, z: 0 };
  private readonly titleOther = { x: 0, z: 0 };
  private settings: Settings = loadSettings();
  private profile: Profile | null = loadProfile();
  private bows: number = loadBows();
  private lastSelfBows: number | null = null;
  private nextRewardToastAt = 0;
  private session: WorldSession | SoloSession | null = null;
  private worlds: WorldInfo[] = [];
  private currentWorld = 0;
  private joinToken = 0;
  private self: SelfSnapshot | null = null;
  // The part of the world the camera is in, which the seat hints, the sounds and the greetings belong to.
  private zone: Zone = START_ZONE;
  private seatOwners: Record<Zone, Map<number, string>> = perZone(() => new Map());
  private nextKnockAt = 0;
  private readonly prediction = new SelfPrediction();
  private tapPath: { x: number; z: number }[] = [];
  // The machine the visitor stands at (its hint is up), and the one a tap is walking them to.
  private nearMachine: MachineSpot | null = null;
  private pendingMachine: MachineSpot | null = null;
  private lastFrameMs = 0;
  private nextJumpAt = 0;
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

  constructor(assets: GameAssets, monkAssets: MonkAssets) {
    this.canvas = document.getElementById("stage") as HTMLCanvasElement;
    this.ui = document.getElementById("ui") as HTMLElement;

    this.joystick = new Joystick(this.ui);
    this.world = new World(
      this.canvas,
      {
        onFrame: (dt, now) => this.frame(dt, now),
        onRendered: (nowMs) => {
          const quad = this.stage.mounted ? this.world.screenQuad() : null;
          this.updateSeatHints();
          this.updateMachineHint();
          this.updateStageHint(quad);
          this.updateVisitorTitles();
          this.emoteBubbles.update(nowMs);
          if (this.stage.mounted) this.stage.place(quad);
        },
        onStick: (stick) => this.joystick.set(stick),
        onZone: (zone) => this.setZone(zone),
        onTap: (clientX, clientY) => {
          const seatId = this.seatHints.seatAt(clientX, clientY);
          if (seatId !== null) {
            this.sitAt(seatId);
            return;
          }
          if (this.nearMachine && this.machineHint.contains(clientX, clientY)) {
            this.openMachine(this.nearMachine);
            return;
          }
          const machine = this.world.machineAt(clientX, clientY);
          if (machine) {
            this.tapMachine(machine);
            return;
          }
          const point = this.world.floorPointAt(clientX, clientY);
          if (point) this.walkTo(point.x, point.z);
        },
      },
      assets,
      monkAssets,
    );
    this.world.setReduceMotion(this.settings.reduceMotion);
    this.emoteBubbles = new EmoteBubbles(this.ui, this.world.emotes, (id, out) => this.world.projectEmoteAnchor(id, out));

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
        onPlayback: () => this.syncZoneSound(),
        onAudible: (audible) => {
          this.videoAudible = audible;
          this.syncZoneSound();
        },
      },
    );
    this.stage.setReduceMotion(this.settings.reduceMotion);
    this.sutra = new SyncedLoop(this.audio, () => this.world.serverNowAt(performance.now()), sutraUrl);

    this.settingsPanel = new SettingsPanel(this.settings, {
      onChange: (next) => this.updateSettings(next),
    });
    this.hud = new Hud(
      this.ui,
      {
        onSwitchWorld: (world) => void this.enter(world),
        onOpenWorlds: () => void this.refreshWorlds(),
        onBow: () => this.bow(),
        onStand: () => this.stand(),
        onJump: () => this.jump(),
        onEmote: (emote) => this.session?.emote(emote),
        onKnock: () => this.knock(),
        onChant: (on) => this.chant(on),
        onCast: () => this.cast(),
        onReel: () => this.reel(),
        onEquip: (item) => this.equip(item),
        onInvite: () => void this.copyInvite(),
        onCancelReturn: () => this.holdReturn(),
        onReturnNow: () => void this.enter(this.soloReturnWorld),
      },
      this.settingsPanel.root,
    );
    this.hud.setReduceMotion(this.settings.reduceMotion);
    this.hud.setCollection(this.bows);
    this.soundChip = new SoundChip(this.ui, () => {
      this.audio.unlock();
      this.stage.userGesture();
      this.sutra.prime();
      this.stage.openTapWindow();
    });
    this.seatHints = new SeatHints(this.ui, (id) => this.sitAt(id));
    this.machineHint = new MachineHint(this.ui, () => {
      if (this.nearMachine) this.openMachine(this.nearMachine);
    });
    this.casinoBank = new CasinoBank({ load: loadWallet, save: saveWallet }, () => Date.now());
    this.casino = new CasinoPanel(this.ui, {
      bank: this.casinoBank,
      sounds: new CasinoSounds(this.audio, { coin: coinUrl, click: clickUrl, jackpot: jackpotUrl }),
      random: Math.random,
      reduceMotion: () => this.settings.reduceMotion,
      onClose: () => this.closedCasino(),
    });
    this.casino.setReduceMotion(this.settings.reduceMotion);
    this.backGuard = new BackGuard(window, window.history, () => this.casino.close());
    this.stageHint = new StageHint(this.ui, { play: () => this.stage.play(), stop: () => this.stage.stop() });
    this.visitorTitles = new VisitorTitles(this.ui);
    this.hudFrame = new HudFrame(this.ui);
    new InstallBanner(this.ui, () => this.fitCameraToHud());
    this.touchIntro = new TouchIntro(this.ui);
    this.overlay = new Overlay(this.ui);
    this.keyboard = new KeyboardInput(window, {
      onSpace: () => {
        if (this.self && (this.self.seatId >= 0 || heldAction(this.self) !== null)) this.act();
        else this.jump();
      },
      onStand: () => {
        if (!this.hud.closeSheets()) this.stand();
      },
      onInteract: () => {
        if (!this.nearMachine || !this.machineHint.visible) return false;
        this.openMachine(this.nearMachine);
        return true;
      },
    });

    this.applyAudio();
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
    this.catchWatch.reset();
    this.lastSelfBows = null;
    this.self = null;
    this.hud.setSelf(null);
    this.casino.close();
    this.stopWalking();
    this.clearSeatOwners();
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
          { hue: profile.hue },
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
    this.catchWatch.reset();
    this.lastSelfBows = null;
    this.self = null;
    this.hud.setSelf(null);
    this.casino.close();
    this.stopWalking();
    this.clearSeatOwners();

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
    this.touchIntro.show();
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
    this.touchIntro.show();
    if (fellBackFrom !== null) {
      this.hud.toast(`${worldName(fellBackFrom)}는 없거나 비어 있거나 가득 차서 ${worldName(world)}로 모셨어요`);
    }
    this.handleState(session.state);
  }

  private isLive(): boolean {
    return this.session !== null && !this.inSolo;
  }

  private async leaveCurrent(): Promise<void> {
    const old = this.session;
    // A video playing in the world being left must not carry over to the next; the iframe stays mounted, waiting.
    this.stage.stop();
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
    const counts: Record<Zone, number> = perZone(() => 0);
    const visitorIds = new Set<string>();
    state.monks.forEach((monk) => {
      views.push({
        id: monk.id,
        hue: monk.hue,
        x: monk.x,
        z: monk.z,
        yaw: monk.yaw,
        mode: monk.mode,
        seatId: monk.seatId,
        npc: monk.npc,
        bowCount: monk.bowCount,
        emote: monk.emote,
        emoteSeq: monk.emoteSeq,
        knockSeq: monk.knockSeq,
        chanting: monk.chanting,
        item: monk.item,
        jumpSeq: monk.jumpSeq,
        bite: monk.bite,
      });
      // computer-driven monks are drawn but are not visitors: no count, no list row, no greeting
      if (monk.npc) return;
      // Where a monk is decides which zone they count in: the 법당 is whoever stands inside its door.
      const monkZone = venueAt(monk.x, monk.z);
      counts[monkZone] += 1;
      visitorIds.add(monk.id);
      watched.push({ id: monk.id, slot: monk.slot, x: monk.x, z: monk.z, mode: monk.mode });
      rows.push({
        id: monk.id,
        slot: monk.slot,
        mode: monk.mode,
        zone: monkZone,
        seatId: monk.seatId,
        bowCount: monk.bowCount,
        isSelf: monk.id === selfId,
      });
      if (monk.id === selfId) {
        this.self = { x: monk.x, z: monk.z, mode: monk.mode, seatId: monk.seatId, chanting: monk.chanting, item: monk.item };
        this.prediction.reconcile({ x: monk.x, z: monk.z, mode: monk.mode, ackSeq: monk.ackSeq });
        this.hud.setSelf({ mode: monk.mode, seatId: monk.seatId, chanting: monk.chanting, item: monk.item, x: monk.x, z: monk.z, bite: monk.bite });
        this.noteFishing(monk);
        this.creditBows(monk.bowCount);
        for (const quest of this.quests.observe(selfId, { bowCount: monk.bowCount, zone: monkZone, seatId: monk.seatId }, state)) this.hud.toast(`퀘스트를 끝냈어요: ${quest.text}`);
      }
    });
    this.hud.setQuests(this.quests.view(state.serverTime));
    this.lastViews = views;
    this.visitorTitles.retain(visitorIds);

    const owners: Record<Zone, Map<number, string>> = perZone(() => new Map());
    const occupied: Record<Zone, Set<number>> = perZone(() => new Set());
    state.seats.forEach((seat) => {
      if (!isZone(seat.zone) || seat.occupantId === "") return;
      occupied[seat.zone].add(seat.id);
      if (!state.monks.get(seat.occupantId)?.npc) owners[seat.zone].set(seat.id, seat.occupantId);
    });
    this.seatOwners = owners;

    this.world.setSelfPrediction(this.prediction.display());
    this.playKnocks(this.world.applyMonks(views, now, state.serverTime));
    for (const zone of ZONES) this.world.setOccupancy(zone, occupied[zone]);

    rows.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.slot - b.slot);
    this.hud.setVisitors(rows);
    this.syncWorldCount(rows.length, counts);

    const report = this.bowWatch.update(watched, selfId, now);
    if (report.selfStarted) this.audio.knock();
    for (const slot of report.greeters) this.hud.toast(`${seatLabel(slot)}님이 인사했어요`);
  }

  private noteFishing(monk: { bite: boolean; catchSeq: number; lastCatch: number }): void {
    const report = this.catchWatch.observe(monk);
    if (report.bitten) this.hud.toast("입질이 왔어요! 낚싯줄을 당겨요");
    if (report.caught !== null) this.hud.toast(catchMessage(report.caught));
  }

  private creditBows(current: number): void {
    const gained = gainedBows(this.lastSelfBows, current);
    this.lastSelfBows = current;
    if (gained <= 0) return;
    const before = this.bows;
    this.bows += gained;
    saveBows(this.bows);
    this.hud.setCollection(this.bows);
    for (const title of titlesCrossed(before, this.bows)) this.hud.toast(`‘${title.name}’ 칭호를 얻었어요`);
    this.payBows(gained);
  }

  // The bank decides what the bows pay (see payBows in shared); here the visitor is told: the first payment of a run, and the day's cap.
  private payBows(bows: number): void {
    const { paid, capped } = this.casinoBank.rewardBows(bows);
    if (paid <= 0) return;
    this.casino.coinsAdded();
    const now = performance.now();
    const text = capped ? `절 +${paid} 엽전 · 오늘 절 보상 한도에 도달했어요` : now >= this.nextRewardToastAt ? `절 +${paid} 엽전` : null;
    if (text === null) return;
    this.hud.toast(text);
    this.nextRewardToastAt = now + REWARD_TOAST_QUIET_MS;
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

  // The camera went in at the 법당's door or out of it: the seat hints, the label and the sounds follow it.
  private setZone(zone: Zone): void {
    if (zone === this.zone) return;
    this.zone = zone;
    this.seatHints.hideAll();
    this.syncZoneSound();
  }

  private clearSeatOwners(): void {
    this.seatOwners = perZone(() => new Map());
  }

  // The concert video waits (poster on the screen) in a live world until the visitor plays it, and the sutra runs for as long as
  // they are in the world; where they stand (see tickMix) only decides which of the two is heard. The wind belongs to the open air.
  private syncZoneSound(): void {
    const outdoors = !INDOOR[this.zone];
    const live = this.isLive();
    if (live && !this.stage.mounted && this.stage.status !== "blocked") this.stage.mount();
    else if (!live && this.stage.mounted) this.stage.unmount();
    this.world.setScreenMode(screenModeFor(this.stage.playback, this.settings.reduceMotion));
    this.sutra.setActive(this.session !== null);
    this.audio.setWindAllowed(outdoors && !this.videoAudible);
  }

  private handleLink(link: LinkState): void {
    this.hud.setLink(link);
    if (link !== "lost") return;
    this.lost = true;
    this.session = null;
    this.syncZoneSound();
    this.casino.close();
    this.stopWalking();
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

  // Space and the action button both land here: the held item's action when seated with one, else a bow.
  private act(): void {
    const action = heldAction(this.self);
    if (action === "knock") this.knock();
    else if (action === "chant") this.chant(!this.self?.chanting);
    else if (action === "cast") this.cast();
    else if (action === "reel") this.reel();
    else this.bow();
  }

  // The line goes out toward the sea from where the visitor stands at the water's edge.
  private cast(): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    if (heldAction(this.self) !== "cast") return;
    this.stopWalking();
    session.cast();
  }

  private reel(): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    if (this.self?.mode !== "fish") return;
    session.reel();
  }

  private knock(): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    const self = this.self;
    if (!self || self.item !== ITEM_MOKT || !isSeated(self)) return;
    const now = performance.now();
    if (self.mode !== "kneel" || now < this.nextKnockAt) return;
    this.nextKnockAt = now + KNOCK_COOLDOWN_MS;
    session.knock();
    this.world.knock(session.sessionId, now);
    this.audio.knock();
  }

  private chant(on: boolean): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    const self = this.self;
    if (!self || !isSeated(self) || (on && self.item !== ITEM_CHANT)) return;
    session.chant(on);
  }

  private equip(item: number): void {
    const session = this.session;
    if (!session) return;
    this.audio.unlock();
    session.equip(item);
    if (item === ITEM_ROD) this.hud.toast("바닷가에서 낚싯대를 던질 수 있어요");
    else if (item !== ITEM_NONE && !(this.self && isSeated(this.self))) this.hud.toast("방석에 앉으면 쓸 수 있어요");
  }

  // The player's own knock already sounded on the click; only other monks' knocks reach here, quieter with distance.
  private playKnocks(knockers: readonly MonkView[]): void {
    const self = this.self;
    if (!self) return;
    for (const knocker of knockers) {
      const gain = knockGain(Math.hypot(knocker.x - self.x, knocker.z - self.z));
      if (gain > KNOCK_AUDIBLE_GAIN) this.audio.knock(gain);
    }
  }

  private jump(): void {
    const session = this.session;
    const now = performance.now();
    if (!session || !this.self || this.self.seatId >= 0 || now < this.nextJumpAt) return;
    this.audio.unlock();
    this.nextJumpAt = now + JUMP_COOLDOWN_MS;
    this.world.hopSelf(now);
    session.jump();
  }

  private stand(): void {
    this.stopWalking();
    if (this.self && this.self.mode !== "stand") this.session?.stand();
  }

  private sitAt(seatId: number): void {
    this.stopWalking();
    this.session?.sit(this.zone, seatId);
  }

  private stopWalking(): void {
    this.prediction.cancel();
    this.tapPath = [];
    this.pendingMachine = null;
  }

  // The panel takes the keys and the monk stands still until it closes, however it is closed.
  private openMachine(spot: MachineSpot): void {
    if (!this.session || !this.self || this.casino.isOpen) return;
    this.stopWalking();
    this.keyboard.blocked = true;
    this.machineHint.hide();
    this.backGuard.engage();
    this.casino.open(spot);
  }

  private closedCasino(): void {
    this.keyboard.blocked = false;
    this.backGuard.release();
  }

  // A tap on a machine plays it from where the visitor stands, or walks them to its front first.
  private tapMachine(spot: MachineSpot): void {
    const at = this.world.selfPosition;
    if (at && Math.hypot(spot.frontX - at.x, spot.frontZ - at.z) <= MACHINE_REACH) {
      this.openMachine(spot);
      return;
    }
    this.walkTo(spot.frontX, spot.frontZ);
    if (this.tapPath.length > 0) this.pendingMachine = spot;
  }

  private arriveAtMachine(): void {
    const spot = this.pendingMachine;
    this.pendingMachine = null;
    const at = this.world.selfPosition;
    if (spot && at && Math.hypot(spot.frontX - at.x, spot.frontZ - at.z) <= MACHINE_REACH) this.openMachine(spot);
  }

  // A tap on the floor walks the monk there (never sits them); the path bends through the doorway when the spot is in the other part of the world.
  private walkTo(x: number, z: number): void {
    const at = this.prediction.display() ?? this.world.selfPosition;
    if (!this.session || !this.self || !at) return;
    this.pendingMachine = null;
    this.tapPath = planPath(at, { x, z });
  }

  private updateSettings(next: Settings): void {
    this.settings = next;
    saveSettings(next);
    this.settingsPanel.sync(next);
    this.hud.setReduceMotion(next.reduceMotion);
    this.world.setReduceMotion(next.reduceMotion);
    this.stage.setReduceMotion(next.reduceMotion);
    this.casino.setReduceMotion(next.reduceMotion);
    this.applyAudio();
    this.syncZoneSound();
  }

  private applyAudio(): void {
    this.audio.configure(this.settings.ambientVolume, this.settings.effectVolume);
    this.stage.setSound(true, this.settings.ambientVolume);
  }

  private bindAudioUnlock(): void {
    let stageReady = false;
    // Every gesture stays bound: a context the browser suspended or interrupted later is resumed by the next tap.
    const unlock = (): void => {
      this.audio.unlock();
      if (!stageReady) {
        this.stage.userGesture();
        stageReady = this.audio.unlocked;
      }
      this.sutra.prime();
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
      if (document.visibilityState === "visible" && this.lost) void this.enter(this.currentWorld || null);
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
      stage: () => ({ status: this.stage.status, playback: this.stage.playback, mounted: this.stage.mounted, audible: this.videoAudible }),
      sutraPlaying: () => this.sutra.playing,
      sutraMix: () => this.sutra.mix,
      zone: () => this.zone,
      sit: (zone: Zone, seatId: number) => this.session?.sit(zone, seatId),
      serverNow: () => this.world.serverNowAt(performance.now()),
      walkTo: (x: number, z: number) => this.walkTo(x, z),
      casino: (id: string) => {
        const spot = machineSpot(id);
        if (spot) this.openMachine(spot);
      },
      wallet: () => this.casinoBank.wallet,
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
      this.tickMix();
    }
    if (nowMs >= this.nextSkyTick) {
      this.nextSkyTick = nowMs + SKY_TICK_MS;
      this.tickSky();
    }
  }

  // Where the visitor stands sets the two soundtracks: the sutra only inside the 법당, the concert by its areaMix share.
  private tickMix(): void {
    const at = this.world.selfPosition;
    const mix = this.session !== null && at ? areaMix(at.x, at.z) : 0;
    this.sutra.setMix(this.session !== null && at ? chantMix(at.x, at.z) : 0);
    this.stage.setLevel(1 - mix);
    this.audio.setSeaLevel(this.session !== null && at ? seaLevel(at.x, at.z) : 0);
  }

  private driveMovement(dt: number, realDt: number, nowMs: number): void {
    const turn = this.keyboard.rotation();
    if (turn !== 0) this.world.rig.orbit(turn * dt * 1.8, 0);

    const session = this.session;
    const displayed = this.world.selfPosition;
    if (!session || !this.self || !displayed) {
      this.tapPath = [];
      this.pendingMachine = null;
      return;
    }
    const axes = this.casino.isOpen ? { forward: 0, right: 0 } : combineAxes(this.keyboard.axes(), this.joystick.axes());
    const moving = axes.forward !== 0 || axes.right !== 0;
    let dir = moving ? floorDirection(axes, this.world.rig.forward) : null;
    if (moving) {
      this.tapPath = [];
      this.pendingMachine = null;
    } else if (this.tapPath.length > 0) {
      const reach = Math.max(TAP_ARRIVE_DISTANCE, WALK_SPEED * Math.min(MAX_FRAME_DT_S, realDt));
      const heading = headingAlong(this.tapPath, this.prediction.display() ?? displayed, reach);
      dir = heading.dir;
      this.tapPath = heading.rest;
    }
    const target = this.prediction.frame(realDt, nowMs, dir, displayed);
    this.world.setSelfPrediction(this.prediction.display());
    if (target) session.move(target.x, target.z, target.seq);
    if (this.pendingMachine && !moving && this.tapPath.length === 0) this.arriveAtMachine();
  }

  // The "플레이" hint floats over the machine the visitor stands at, while they are on their feet.
  private updateMachineHint(): void {
    const self = this.self;
    const at = this.world.selfPosition;
    const idle = this.session && self && at && self.seatId < 0 && (self.mode === "stand" || self.mode === "walk") && !this.casino.isOpen;
    const spot = idle && at ? machineNear(at.x, at.z) : undefined;
    this.nearMachine = spot ?? null;
    if (spot && this.world.projectToScreen(spot.x, machineHeight(spot.kind) + MACHINE_HINT_LIFT, spot.z, this.hintPoint)) {
      this.machineHint.place(this.hintPoint.x, this.hintPoint.y);
    } else {
      this.machineHint.hide();
    }
  }

  private updateSeatHints(): void {
    const self = this.self;
    if (!this.session || !self || self.seatId >= 0) {
      this.seatHints.hideAll();
      return;
    }
    for (const spot of ZONE_SEATS[this.zone]) {
      const reachable = !this.seatOwners[this.zone].has(spot.id) && Math.hypot(spot.x - self.x, spot.z - self.z) <= SEAT_HINT_REACH;
      if (reachable && this.world.projectToScreen(spot.x, SEAT_HINT_HEIGHT, spot.z, this.hintPoint)) {
        this.seatHints.place(spot.id, this.hintPoint.x, this.hintPoint.y);
      } else {
        this.seatHints.hide(spot.id);
      }
    }
  }

  private updateStageHint(quad: Quad | null): void {
    const at = quad ? this.world.selfPosition : null;
    const action = hintAction({
      live: this.isLive(),
      distance: at ? Math.hypot(at.x - STAGE.x, at.z - STAGE.z) : null,
      status: this.stage.status,
      playback: this.stage.playback,
    });
    if (!quad || !action) {
      this.stageHint.hide();
      return;
    }
    const left = quad[0];
    const right = quad[1];
    this.stageHint.place(action, (left.x + right.x) / 2, (left.y + right.y) / 2);
  }

  private updateVisitorTitles(): void {
    const selfId = this.world.selfId;
    if (!this.session || !selfId || !this.world.displayedPosition(selfId, this.titleSelf)) {
      this.visitorTitles.hideAll();
      return;
    }
    for (const view of this.lastViews) {
      if (view.npc || view.id === selfId) continue;
      const title = visitorTitle(view.bowCount);
      let shown = false;
      if (title !== null && this.world.displayedPosition(view.id, this.titleOther)) {
        const { x, z } = this.titleOther;
        const headTop = Math.hypot(x - this.titleSelf.x, z - this.titleSelf.z) <= TITLE_REACH ? this.world.headTopOf(view.id) : null;
        if (headTop !== null && this.world.projectToScreen(x, headTop + TITLE_GAP, z, this.hintPoint)) {
          this.visitorTitles.place(view.id, title, this.hintPoint.x, this.hintPoint.y);
          shown = true;
        }
      }
      if (!shown) this.visitorTitles.hide(view.id);
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
      this.audio.bell(this.sutra.mix);
      this.hud.toast(`${chant.label}이 시작됐어요`);
    }
    const status = describeChant(chant, now);
    this.hud.setChant(status.phase === "ended" ? null : status);
  }
}
