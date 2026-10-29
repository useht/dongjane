import { startGameServer } from "./server.ts";

const port = Number(process.env.PORT ?? 2567);

const game = await startGameServer({ port, handleSignals: true, greet: false });
console.log(`동자네 server listening on :${game.port}`);
