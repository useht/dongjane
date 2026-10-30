import { type Client, Room, ServerError, logger } from "@colyseus/core";
import {
  type JoinOptions,
  WORLD_CAPACITY,
  MESSAGE_RATE_PER_SECOND,
  MSG,
  NPC_COUNT,
  RECONNECT_SECONDS,
  TICK_MS,
  TempleSim,
  type RelocateMessage,
  type TempleState,
  type Zone,
  ZONES,
  worldName,
  isValidWorld,
  normalizeHue,
  parseBow,
  parseChant,
  parseEmote,
  parseEquip,
  parseMove,
  parseSit,
  randomHue,
} from "@dongjane/shared";
import { type DirectoryRoom, type WorldDirectory, RELOCATION_GRACE_MS } from "./world-directory.ts";

export interface WorldCreateOptions {
  world: number;
  key: string;
  reconnectSeconds?: number;
  relocationGraceMs?: number;
}

export interface WorldMetadata {
  world: number;
  name: string;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export const worldHost: { key: string; directory: WorldDirectory | null } = { key: "", directory: null };

export class WorldRoom extends Room<{ state: TempleState; metadata: WorldMetadata }> implements DirectoryRoom {
  override maxClients = WORLD_CAPACITY;
  override autoDispose = false;
  override patchRate = TICK_MS;
  override maxMessagesPerSecond = MESSAGE_RATE_PER_SECOND * 4;

  private sim!: TempleSim;
  private reconnectSeconds = RECONNECT_SECONDS;
  private relocationGraceMs = RELOCATION_GRACE_MS;
  private directory: WorldDirectory | null = null;
  private worldNumber = 0;
  private drainTarget: number | null = null;
  private readonly buckets = new Map<string, Bucket>();

  get world(): number {
    return this.worldNumber;
  }

  get population(): number {
    return this.sim.humanCount;
  }

  get npcs(): number {
    return this.sim.npcCount;
  }

  get zones(): Record<Zone, number> {
    return Object.fromEntries(ZONES.map((zone) => [zone, this.sim.zoneCount(zone)])) as Record<Zone, number>;
  }

  get draining(): boolean {
    return this.drainTarget !== null;
  }

  override async onCreate(options: WorldCreateOptions): Promise<void> {
    const world = options?.world;
    const directory = worldHost.directory;
    if (!directory || !isValidWorld(world) || options.key !== worldHost.key) {
      throw new ServerError(403, "worlds are created by the server only");
    }

    this.reconnectSeconds = options.reconnectSeconds ?? RECONNECT_SECONDS;
    this.relocationGraceMs = options.relocationGraceMs ?? RELOCATION_GRACE_MS;
    this.sim = new TempleSim({ npcCount: NPC_COUNT });
    this.state = this.sim.state;
    await this.setMetadata({ world, name: worldName(world) });

    this.setTimestep((deltaMs) => this.sim.tick(deltaMs), TICK_MS);
    this.scheduleChant();

    this.onMessage(MSG.move, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseMove(payload);
      if (message) this.sim.move(client.sessionId, message.x, message.z, message.seq);
    });
    this.onMessage(MSG.sit, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseSit(payload);
      if (message) this.sim.sit(client.sessionId, message.zone, message.seatId);
    });
    this.onMessage(MSG.stand, (client) => {
      if (this.allow(client)) this.sim.stand(client.sessionId);
    });
    this.onMessage(MSG.jump, (client) => {
      if (this.allow(client)) this.sim.jump(client.sessionId);
    });
    this.onMessage(MSG.bow, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseBow(payload);
      if (message) this.sim.bow(client.sessionId, message.times);
    });
    this.onMessage(MSG.emote, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseEmote(payload);
      if (message) this.sim.emote(client.sessionId, message.id);
    });
    this.onMessage(MSG.knock, (client) => {
      if (this.allow(client)) this.sim.knock(client.sessionId);
    });
    this.onMessage(MSG.chant, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseChant(payload);
      if (message) this.sim.chant(client.sessionId, message.on);
    });
    this.onMessage(MSG.equip, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseEquip(payload);
      if (message) this.sim.equip(client.sessionId, message.item);
    });

    this.worldNumber = world;
    this.directory = directory;
    directory.register(this);
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    const hue = normalizeHue(options?.hue) ?? randomHue();
    this.sim.join(client.sessionId, hue);
    this.sendRelocation(client);
    this.directory?.joined(this);
  }

  override onDrop(client: Client): void {
    this.allowReconnection(client, this.reconnectSeconds);
  }

  override onReconnect(client: Client): void {
    this.sendRelocation(client);
  }

  override onLeave(client: Client): void {
    this.sim.leave(client.sessionId);
    this.buckets.delete(client.sessionId);
    this.directory?.changed();
  }

  override onDispose(): void {
    this.directory?.unregister(this);
  }

  close(): Promise<unknown> {
    return this.disconnect();
  }

  async drain(target: number): Promise<void> {
    if (this.drainTarget !== null) return;
    this.drainTarget = target;
    try {
      await this.lock();
      this.broadcast(MSG.relocate, { world: target } satisfies RelocateMessage);
      this.clock.setTimeout(() => {
        if (this.population === 0) return;
        this.disconnect().catch(async (error: unknown) => {
          logger.error("closing merged world failed", error);
          await this.abortDrain();
          this.directory?.changed();
        });
      }, this.relocationGraceMs);
    } catch (error) {
      await this.abortDrain();
      throw error;
    }
  }

  private async abortDrain(): Promise<void> {
    this.drainTarget = null;
    await this.unlock().catch(() => undefined);
  }

  private sendRelocation(client: Client): void {
    if (this.drainTarget !== null) client.send(MSG.relocate, { world: this.drainTarget } satisfies RelocateMessage);
  }

  private scheduleChant(): void {
    const delay = this.sim.updateChant();
    this.clock.setTimeout(() => this.scheduleChant(), delay);
  }

  private allow(client: Client): boolean {
    const now = this.clock.currentTime;
    const bucket = this.buckets.get(client.sessionId) ?? { tokens: MESSAGE_RATE_PER_SECOND, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(MESSAGE_RATE_PER_SECOND, bucket.tokens + (elapsed / 1000) * MESSAGE_RATE_PER_SECOND);
    bucket.updatedAt = now;
    this.buckets.set(client.sessionId, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
