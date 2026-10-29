function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveServerHttpBase(
  env: string | undefined,
  location: { protocol: string; hostname: string; origin: string },
  dev: boolean,
): string {
  if (env) {
    return trimSlash(env.replace(/^ws(s?):/, "http$1:"));
  }
  if (dev) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export function toWebSocketBase(httpBase: string): string {
  return httpBase.replace(/^http(s?):/, "ws$1:");
}

export function serverHttpBase(): string {
  return resolveServerHttpBase(import.meta.env.VITE_SERVER_URL as string | undefined, window.location, import.meta.env.DEV);
}
