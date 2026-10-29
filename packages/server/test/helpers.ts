import { Client, type Room } from "@colyseus/sdk";
import {
  type WorldInfo,
  type WorldListResponse,
  type SeatResponse,
  WORLDS_PATH,
  SEAT_PATH,
  TempleState,
} from "@dongjane/shared";

export type WorldClientRoom = Room<any, TempleState>;

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
  readonly rooms: WorldClientRoom[] = [];

  constructor(readonly port: number) {
    this.client = new Client(`ws://127.0.0.1:${port}`);
  }

  async worlds(): Promise<WorldInfo[]> {
    const response = await fetch(`http://127.0.0.1:${this.port}${WORLDS_PATH}`);
    return ((await response.json()) as WorldListResponse).worlds;
  }

  async world(world: number): Promise<WorldInfo> {
    const info = (await this.worlds()).find((entry) => entry.world === world);
    if (!info) throw new Error(`world ${world} is not open`);
    return info;
  }

  async seat(world: number | null): Promise<SeatResponse> {
    const response = await fetch(`http://127.0.0.1:${this.port}${SEAT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ world }),
    });
    if (!response.ok) throw new Error(`seat request failed with ${response.status}`);
    return (await response.json()) as SeatResponse;
  }

  async join(seat: SeatResponse, options: { hue?: number } = {}): Promise<WorldClientRoom> {
    const room = await this.client.joinById<TempleState>(seat.roomId, options, TempleState);
    room.reconnection.minUptime = 0;
    this.rooms.push(room);
    await waitFor(() => room.state.monks.has(room.sessionId), "own monk in state");
    return room;
  }

  // Asks for a seat the way the page does and reports where the server actually put the visitor.
  async arrive(requested: number | null, options: { hue?: number } = {}) {
    const seat = await this.seat(requested);
    return { seat, room: await this.join(seat, options) };
  }

  // Enters a world that must already be open (or be the next one to open).
  async enter(world: number, options: { hue?: number } = {}): Promise<WorldClientRoom> {
    const { seat, room } = await this.arrive(world, options);
    if (seat.world !== world) throw new Error(`asked for world ${world} but was seated in world ${seat.world}`);
    return room;
  }

  // Brings a world to `count` visitors, opening it if it is the next world.
  async fill(world: number, count: number): Promise<WorldClientRoom[]> {
    const rooms: WorldClientRoom[] = [];
    for (let i = 0; i < count; i += 1) rooms.push(await this.enter(world));
    return rooms;
  }

  async closeAll(): Promise<void> {
    const open = this.rooms.splice(0);
    await Promise.all(open.map((room) => room.leave(true).catch(() => undefined)));
  }
}
