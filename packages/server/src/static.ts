import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
};

// Mirrors navigateFallbackDenylist in packages/client/vite.config.ts.
const NO_FALLBACK = /^\/(api|matchmake)\/|^\/__/;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function hasClientBuild(root: string): boolean {
  return isFile(join(root, "index.html"));
}

// Serves the built client (packages/client/dist) from the game server so one
// public origin carries both the page and the matchmaking/WebSocket traffic.
export function createStaticHandler(root: string) {
  const base = resolve(root);

  return function serveClient(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      return next();
    }

    let file = resolve(base, `.${pathname}`);
    if (file !== base && !file.startsWith(base + sep)) return next();
    if (!isFile(file)) {
      // Unknown extension-less paths fall back to the app shell; missing assets 404 via next().
      if (extname(pathname) !== "" || NO_FALLBACK.test(pathname)) return next();
      file = join(base, "index.html");
    }

    const relative = file.slice(base.length + 1).split(sep).join("/");
    const immutable = relative.startsWith("assets/");
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": statSync(file).size,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
