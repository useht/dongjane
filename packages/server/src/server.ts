import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  type Server,
  createEndpoint,
  createRouter,
  defineRoom,
  defineServer,
  matchMaker,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  HALLS_PATH,
  HALL_COUNT,
  ROOM_NAME,
  type HallInfo,
  type HallListResponse,
  emptyHall,
  isValidHall,
} from "@dongjane/shared";
import { HallRoom, hallCreationKey } from "./hall-room.ts";

export interface GameServerOptions {
  port?: number;
  hostname?: string;
  reconnectSeconds?: number;
  handleSignals?: boolean;
  greet?: boolean;
}

export interface GameServer {
  server: Server;
  port: number;
  stop(): Promise<void>;
}

export async function listHalls(): Promise<HallInfo[]> {
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  const byHall = new Map<number, (typeof rooms)[number]>();
  for (const room of rooms) {
    const hall = room.metadata?.hall;
    if (isValidHall(hall)) byHall.set(hall, room);
  }
  return Array.from({ length: HALL_COUNT }, (_, index) => {
    const hall = index + 1;
    const room = byHall.get(hall);
    if (!room) return emptyHall(hall);
    return {
      hall,
      roomId: room.roomId,
      clients: room.clients,
      capacity: room.maxClients,
      full: room.clients >= room.maxClients,
    };
  });
}

const hallsEndpoint = createEndpoint(HALLS_PATH, { method: "GET" }, async () => {
  const body: HallListResponse = { halls: await listHalls() };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
});

export async function startGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  hallCreationKey.value = randomBytes(16).toString("hex");
  let stopping = false;

  const handler = defineRoom(HallRoom).filterBy(["hall"]);
  const server = defineServer({
    rooms: { [ROOM_NAME]: handler },
    routes: createRouter({ hallsEndpoint }, { openapi: { disabled: true } }),
    transport: new WebSocketTransport(),
    gracefullyShutdown: options.handleSignals ?? false,
    greet: options.greet ?? false,
  });

  const ensureHalls = async () => {
    const existing = new Set((await matchMaker.query({ name: ROOM_NAME })).map((room) => room.metadata?.hall));
    for (let hall = 1; hall <= HALL_COUNT; hall += 1) {
      if (existing.has(hall)) continue;
      await matchMaker.createRoom(ROOM_NAME, {
        hall,
        key: hallCreationKey.value,
        reconnectSeconds: options.reconnectSeconds,
      });
    }
  };

  handler.on("dispose", () => {
    if (!stopping) void ensureHalls().catch(() => undefined);
  });

  await server.listen(options.port ?? 0, options.hostname);
  await ensureHalls();

  const address = server.transport.server?.address() as AddressInfo | null | undefined;
  const port = address?.port ?? options.port ?? 0;

  return {
    server,
    port,
    async stop() {
      stopping = true;
      await server.gracefullyShutdown(false);
    },
  };
}
