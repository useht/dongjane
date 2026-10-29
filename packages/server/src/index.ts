import { fileURLToPath } from "node:url";
import { startGameServer } from "./server.ts";
import { hasClientBuild } from "./static.ts";

const port = Number(process.env.PORT ?? 2567);
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL("../../client/dist", import.meta.url));
const serveClient = hasClientBuild(clientDir);

const game = await startGameServer({ port, handleSignals: true, greet: false, clientDir: serveClient ? clientDir : undefined });
console.log(`동자네 server listening on :${game.port}`);
if (serveClient) console.log(`serving client from ${clientDir}`);
else console.log(`client build not found at ${clientDir} — run \`pnpm build\` to serve the page from this server`);
