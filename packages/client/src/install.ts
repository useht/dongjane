export const STANDALONE_QUERY = "(display-mode: standalone)";

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallHint = "prompt" | "ios";

export function isStandalone(displayModeStandalone: boolean, navigatorStandalone: boolean | undefined): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return ios && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

export function installHint(state: { installed: boolean; hasPrompt: boolean; iosSafari: boolean }): InstallHint | null {
  if (state.installed) return null;
  if (state.hasPrompt) return "prompt";
  return state.iosSafari ? "ios" : null;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function captureInstallPrompt(target: EventTarget): void {
  target.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  target.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function getInstallPrompt(): InstallPromptEvent | null {
  return deferred;
}

export function takeInstallPrompt(): InstallPromptEvent | null {
  const event = deferred;
  deferred = null;
  if (event) notify();
  return event;
}

export function onInstallChange(listener: () => void): void {
  listeners.add(listener);
}
