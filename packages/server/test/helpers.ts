import { Client, type Room } from "@colyseus/sdk";
import { type HallInfo, type HallListResponse, HALLS_PATH, TempleState } from "@dongjane/shared";

export type HallClientRoom = Room<any, TempleState>;

export async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 1500,
  stepMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

export async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TestRig {
  readonly client: Client;
  readonly rooms: HallClientRoom[] = [];

  constructor(readonly port: number) {
    this.client = new Client(`ws://127.0.0.1:${port}`);
  }

  async halls(): Promise<HallInfo[]> {
    const response = await fetch(`http://127.0.0.1:${this.port}${HALLS_PATH}`);
    return ((await response.json()) as HallListResponse).halls;
  }

  async hall(hall: number): Promise<HallInfo> {
    const info = (await this.halls()).find((entry) => entry.hall === hall);
    if (!info?.roomId) throw new Error(`hall ${hall} has no room`);
    return info;
  }

  async enter(hall: number, options: { name?: string; hue?: number } = {}): Promise<HallClientRoom> {
    const info = await this.hall(hall);
    const room = await this.client.joinById<TempleState>(info.roomId as string, options, TempleState);
    room.reconnection.minUptime = 0;
    this.rooms.push(room);
    await waitFor(() => room.state.monks.has(room.sessionId), "own monk in state");
    return room;
  }

  async closeAll(): Promise<void> {
    const open = this.rooms.splice(0);
    await Promise.all(open.map((room) => room.leave(true).catch(() => undefined)));
  }
}
