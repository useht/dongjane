# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node 24+ and pnpm 12 (`nodeLinker: hoisted`). Install with `pnpm install`.

- `pnpm dev` runs the game server (port 2567) and the Vite client (port 5173). Vite proxies `/__server` to the server.
- `pnpm build` runs `tsc --noEmit` for the client, then `vite build` into `packages/client/dist`.
- `pnpm start` runs the game server. If `packages/client/dist` exists, it serves the client from the same port (`CLIENT_DIR` overrides the path).
- `pnpm test` runs all three vitest projects (shared, server, client) and takes about two minutes.
- Single file: `pnpm test packages/shared/test/sim.test.ts`. Filter by test name with `-t "<name>"`.
- `pnpm typecheck` runs `tsc --noEmit` in each package. There is no lint script and no CI config in the repo.
- `pnpm icons` regenerates the PWA icons. `pnpm assets` regenerates the 3D models with Blender (see Gotchas).

## Architecture

Three workspaces: `packages/shared` (game rules and wire formats), `packages/server` (Colyseus), and `packages/client` (Vite, Three.js).

**The rules run on both sides.** `@dongjane/shared` is consumed as TypeScript source (`main` is `./src/index.ts`, no build step), so its imports use `.ts` extensions. `TempleSim` (`shared/src/sim.ts`) is the whole game simulation: walking, seats, bows, emotes, chanting, and the computer-driven monks. On the server it runs authoritatively inside `WorldRoom` (`server/src/world-room.ts`). When the server is unreachable, the client runs the same class in `SoloSession` (`client/src/net/solo.ts`), so the offline fallback is the same game.

**Joining a world.** The client never picks a Colyseus room itself:
1. `POST /api/worlds/seat` reaches `WorldDirectory.seat` (`server/src/world-directory.ts`). It picks a world with `chooseSeat`, and replies with `{ world, roomId, fellBack }`.
2. The client calls `client.joinById(roomId, ...)` (`client/src/net/session.ts`).

Only the server creates rooms, through `matchMaker`. `WorldRoom.onCreate` rejects any room whose key does not match the in-process `worldHost.key`. `planWorlds` decides when to open a spare world (at `WORLD_SPARE_AT` visitors) and when to move a lone visitor into another world. The server tells the affected visitors where to go with a `relocate` message.

**Authority and prediction.** Clients send messages (`move`, `sit`, `bow`, ...) that the `parse*` functions in `shared/src/messages.ts` validate. The server is authoritative, but keyboard walking runs ahead on the client (`client/src/game/prediction.ts`). Every target sent is derived from the predicted point, and the server's position is never used to correct the local monk. Keep it that way unless you are changing the whole scheme.

**Client assembly.** `client/src/main.ts` loads the assets (`assets/registry.ts` for the glTF models in `src/assets/models/`, `game/monk-assets.ts` for the monk), then starts `App` (`client/src/app.ts`). `App` wires input, the HUD, audio, and the `World` scene (`game/world.ts`). The indoor model `dharma.glb` is fetched lazily when a visitor is about to enter the 법당.

**Models come from Blender scripts.** `packages/client/blender/*.py` build the models. They read a JSON of game data produced by `packages/client/scripts/asset-inputs.ts`, and they spell no dimensions or colours of their own, so a layout change reaches the models. `scripts/build-assets.ts` writes `src/assets/models/stamp.json`, which stores hashes of the scripts, the inputs and the outputs. `packages/client/test/assets-stamp.test.ts` fails when that stamp is stale.

**Static serving.** `server/src/static.ts` serves the built client. Its `NO_FALLBACK` pattern keeps `/api`, `/matchmake` and `/__` paths away from the SPA fallback. The client's `vite.config.ts` uses the same list.

## Gotchas

- Editing a Blender script, a layout constant that `asset-inputs.ts` reads, or the theme makes `pnpm test` fail until `pnpm assets` is run. That needs Blender 5.2, found via `BLENDER_BIN` or the Windows default path. The regenerated `.glb` files and `stamp.json` are committed, so commit them together.
- Client tests run in the `node` environment, with no DOM. UI and rendering changes are not covered by tests. Check them in a browser with `pnpm dev`.
- Capacities are constants in `shared/src/constants.ts`: 100 visitors per world (`WORLD_CAPACITY`), 50 seats per zone (`ZONE_CAPACITY`), and 50 computer-driven monks per world (`NPC_COUNT`) that do not count toward capacity. They start in the 법당 and wander the whole world.
- The chant schedule (every 30 minutes for 3 minutes, KST) is computed in `shared/src/chant.ts`, from the server's clock. Change it there.
- `.gitattributes` keeps `*.py` as LF. The stamp normalises CRLF before hashing, so Windows checkouts hash the same.
- `nixpacks.toml` upgrades corepack before `pnpm i --frozen-lockfile`, because the default corepack cannot launch pnpm 11+.
