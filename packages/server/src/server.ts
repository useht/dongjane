import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  type Server,
  createEndpoint,
  createRouter,
  defineRoom,
  defineServer,
  logger,
  matchMaker,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  HALLS_PATH,
  ROOM_NAME,
  SEAT_PATH,
  type HallListResponse,
  parseSeatRequest,
} from "@dongjane/shared";
import { HallDirectory, HallsBusyError } from "./hall-directory.ts";
import { HallRoom, hallHost } from "./hall-room.ts";
import { createStaticHandler } from "./static.ts";

export interface GameServerOptions {
  port?: number;
  hostname?: string;
  reconnectSeconds?: number;
  /** How long a handed-out seat keeps its hall alive while the client connects. */
  seatReservationMs?: number;
  /** How long a hall being merged waits for its visitors to move before it closes. */
  relocationGraceMs?: number;
  handleSignals?: boolean;
  greet?: boolean;
  /** Directory of the built client to serve on the same origin (e.g. packages/client/dist). */
  clientDir?: string;
}

export interface GameServer {
  server: Server;
  port: number;
  stop(): Promise<void>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function createHallEndpoints(directory: HallDirectory) {
  const hallsEndpoint = createEndpoint(HALLS_PATH, { method: "GET" }, async () => {
    const body: HallListResponse = { halls: directory.list() };
    return json(body);
  });

  const seatEndpoint = createEndpoint(SEAT_PATH, { method: "POST" }, async (ctx) => {
    try {
      return json(await directory.seat(parseSeatRequest(ctx.body as unknown).hall));
    } catch (error) {
      if (error instanceof HallsBusyError) return json({ error: "busy" }, 503);
      throw error;
    }
  });

  return { hallsEndpoint, seatEndpoint };
}

export async function startGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  hallHost.key = randomBytes(16).toString("hex");
  const directory = new HallDirectory({
    create: (hall) =>
      matchMaker.createRoom(ROOM_NAME, {
        hall,
        key: hallHost.key,
        reconnectSeconds: options.reconnectSeconds,
        relocationGraceMs: options.relocationGraceMs,
      }),
    onError: (error) => logger.error("hall directory failed", error),
    reservationMs: options.seatReservationMs,
  });
  hallHost.directory = directory;

  const clientDir = options.clientDir;
  const server = defineServer({
    rooms: { [ROOM_NAME]: defineRoom(HallRoom) },
    routes: createRouter(createHallEndpoints(directory), { openapi: { disabled: true } }),
    transport: new WebSocketTransport(),
    gracefullyShutdown: options.handleSignals ?? false,
    greet: options.greet ?? false,
    ...(clientDir ? { express: (app) => void app.use(createStaticHandler(clientDir)) } : {}),
  });

  server.onBeforeShutdown(() => directory.close());
  await server.listen(options.port ?? 0, options.hostname);

  const address = server.transport.server?.address() as AddressInfo | null | undefined;
  const port = address?.port ?? options.port ?? 0;

  return {
    server,
    port,
    async stop() {
      await server.gracefullyShutdown(false);
    },
  };
}
