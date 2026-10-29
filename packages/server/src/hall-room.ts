import { type Client, Room, ServerError } from "@colyseus/core";
import {
  type JoinOptions,
  HALL_CAPACITY,
  HALL_COUNT,
  MESSAGE_RATE_PER_SECOND,
  MSG,
  RECONNECT_SECONDS,
  TICK_MS,
  type TempleState,
  defaultName,
  hallName,
  normalizeHue,
  parseBow,
  parseMove,
  parseSetName,
  parseSit,
  randomHue,
  sanitizeName,
} from "@dongjane/shared";
import { TempleSim } from "./sim.ts";

export interface HallCreateOptions {
  hall: number;
  key: string;
  reconnectSeconds?: number;
}

export interface HallMetadata {
  hall: number;
  name: string;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export const hallCreationKey = { value: "" };

export class HallRoom extends Room<{ state: TempleState; metadata: HallMetadata }> {
  override maxClients = HALL_CAPACITY;
  override autoDispose = false;
  override patchRate = TICK_MS;
  override maxMessagesPerSecond = MESSAGE_RATE_PER_SECOND * 4;

  private sim!: TempleSim;
  private reconnectSeconds = RECONNECT_SECONDS;
  private readonly buckets = new Map<string, Bucket>();

  override async onCreate(options: HallCreateOptions): Promise<void> {
    const hall = options?.hall;
    const validHall = Number.isInteger(hall) && hall >= 1 && hall <= HALL_COUNT;
    if (!validHall || options.key !== hallCreationKey.value) {
      throw new ServerError(403, "halls are created by the server only");
    }

    this.reconnectSeconds = options.reconnectSeconds ?? RECONNECT_SECONDS;
    this.sim = new TempleSim();
    this.state = this.sim.state;
    await this.setMetadata({ hall, name: hallName(hall) });

    this.setTimestep((deltaMs) => this.sim.tick(deltaMs), TICK_MS);
    this.scheduleChant();

    this.onMessage(MSG.move, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseMove(payload);
      if (message) this.sim.move(client.sessionId, message.x, message.z);
    });
    this.onMessage(MSG.sit, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseSit(payload);
      if (message) this.sim.sit(client.sessionId, message.cushionId);
    });
    this.onMessage(MSG.stand, (client) => {
      if (this.allow(client)) this.sim.stand(client.sessionId);
    });
    this.onMessage(MSG.bow, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseBow(payload);
      if (message) this.sim.bow(client.sessionId, message.times);
    });
    this.onMessage(MSG.setName, (client, payload) => {
      if (!this.allow(client)) return;
      const message = parseSetName(payload);
      if (message) this.sim.setName(client.sessionId, message.name);
    });
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    const name = sanitizeName(options?.name) || defaultName();
    const hue = normalizeHue(options?.hue) ?? randomHue();
    this.sim.join(client.sessionId, name, hue);
  }

  override onDrop(client: Client): void {
    this.allowReconnection(client, this.reconnectSeconds);
  }

  override onLeave(client: Client): void {
    this.sim.leave(client.sessionId);
    this.buckets.delete(client.sessionId);
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
