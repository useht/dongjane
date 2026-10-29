import { Client, type Room } from "@colyseus/sdk";
import { type BowMessage, type JoinOptions, MSG, TempleState, isHallFullError, parseRelocate } from "@dongjane/shared";
import { toWebSocketBase } from "../config.ts";

export type JoinFailure = "full" | "gone" | "offline";
export type LinkState = "online" | "reconnecting" | "lost";

export class JoinError extends Error {
  constructor(
    readonly reason: JoinFailure,
    options?: { cause?: unknown },
  ) {
    super(`join failed: ${reason}`, options);
    this.name = "JoinError";
  }
}

export function classifyJoinError(error: unknown): JoinFailure {
  if (isHallFullError(error)) return "full";
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|no room|expired|invalid (room|seat)/i.test(message)) return "gone";
  return "offline";
}

export interface SessionHandlers {
  onState(state: TempleState): void;
  onLink(link: LinkState): void;
  onRelocate(hall: number): void;
}

const MIN_UPTIME_MS = 1000;

export class HallSession {
  private closed = false;

  private constructor(
    readonly hall: number,
    private readonly room: Room<any, TempleState>,
    private readonly handlers: SessionHandlers,
  ) {
    room.reconnection.minUptime = MIN_UPTIME_MS;
    room.onStateChange(() => {
      if (!this.closed) handlers.onState(room.state);
    });
    room.onDrop(() => {
      if (!this.closed) handlers.onLink("reconnecting");
    });
    room.onReconnect(() => {
      if (!this.closed) handlers.onLink("online");
    });
    room.onMessage(MSG.relocate, (payload: unknown) => {
      const move = parseRelocate(payload);
      if (move && !this.closed) handlers.onRelocate(move.hall);
    });
    room.onLeave(() => {
      if (this.closed) return;
      this.closed = true;
      handlers.onLink("lost");
    });
  }

  static async join(
    httpBase: string,
    roomId: string,
    hall: number,
    options: JoinOptions,
    handlers: SessionHandlers,
  ): Promise<HallSession> {
    try {
      const client = new Client(toWebSocketBase(httpBase));
      const room = await client.joinById<TempleState>(roomId, options, TempleState);
      return new HallSession(hall, room, handlers);
    } catch (error) {
      throw new JoinError(classifyJoinError(error), { cause: error });
    }
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get state(): TempleState {
    return this.room.state;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  move(x: number, z: number, seq?: number): void {
    this.send(MSG.move, seq === undefined ? { x, z } : { x, z, seq });
  }

  sit(cushionId: number): void {
    this.send(MSG.sit, { cushionId });
  }

  stand(): void {
    this.send(MSG.stand, {});
  }

  bow(times: BowMessage["times"]): void {
    this.send(MSG.bow, { times });
  }

  emote(id: number): void {
    this.send(MSG.emote, { id });
  }

  knock(): void {
    this.send(MSG.knock, {});
  }

  chant(on: boolean): void {
    this.send(MSG.chant, { on });
  }

  equip(item: number): void {
    this.send(MSG.equip, { item });
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.room.leave(true);
    } catch {
      // the socket may already be gone
    }
  }

  private send(type: string, payload: unknown): void {
    if (this.closed) return;
    try {
      this.room.send(type, payload);
    } catch {
      // a send during a dropped connection is buffered or discarded by the SDK
    }
  }
}
