import { fileURLToPath } from "node:url";
import { startGameServer } from "./server.ts";
import { hasClientBuild } from "./static.ts";

const port = Number(process.env.PORT ?? 2567);
const clientDir = process.env.CLIENT_DIR ?? fileURLToPath(new URL("../../client/dist", import.meta.url));
const dev = process.argv.includes("--dev");
const serveClient = !dev && hasClientBuild(clientDir);

const game = await startGameServer({ port, handleSignals: true, greet: false, clientDir: serveClient ? clientDir : undefined });
console.log(`동자네 server listening on :${game.port}`);
if (dev) console.log("dev mode: the client is served by the Vite dev server on :5173");
else if (serveClient) console.log(`serving client from ${clientDir}`);
else console.log(`client build not found at ${clientDir} — run \`pnpm build\` to serve the page from this server`);
