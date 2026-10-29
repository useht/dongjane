import { Client, type Room } from "@colyseus/sdk";
import {
  type HallInfo,
  type HallListResponse,
  type SeatResponse,
  HALLS_PATH,
  SEAT_PATH,
  TempleState,
} from "@dongjane/shared";

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
    if (!info) throw new Error(`hall ${hall} is not open`);
    return info;
  }

  async seat(hall: number | null): Promise<SeatResponse> {
    const response = await fetch(`http://127.0.0.1:${this.port}${SEAT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hall }),
    });
    if (!response.ok) throw new Error(`seat request failed with ${response.status}`);
    return (await response.json()) as SeatResponse;
  }

  async join(seat: SeatResponse, options: { name?: string; hue?: number } = {}): Promise<HallClientRoom> {
    const room = await this.client.joinById<TempleState>(seat.roomId, options, TempleState);
    room.reconnection.minUptime = 0;
    this.rooms.push(room);
    await waitFor(() => room.state.monks.has(room.sessionId), "own monk in state");
    return room;
  }

  // Asks for a seat the way the page does and reports where the server actually put the visitor.
  async arrive(requested: number | null, options: { name?: string; hue?: number } = {}) {
    const seat = await this.seat(requested);
    return { seat, room: await this.join(seat, options) };
  }

  // Enters a hall that must already be open (or be the next one to open).
  async enter(hall: number, options: { name?: string; hue?: number } = {}): Promise<HallClientRoom> {
    const { seat, room } = await this.arrive(hall, options);
    if (seat.hall !== hall) throw new Error(`asked for hall ${hall} but was seated in hall ${seat.hall}`);
    return room;
  }

  // Brings a hall to `count` visitors, opening it if it is the next hall.
  async fill(hall: number, count: number): Promise<HallClientRoom[]> {
    const rooms: HallClientRoom[] = [];
    for (let i = 0; i < count; i += 1) rooms.push(await this.enter(hall));
    return rooms;
  }

  async closeAll(): Promise<void> {
    const open = this.rooms.splice(0);
    await Promise.all(open.map((room) => room.leave(true).catch(() => undefined)));
  }
}
