import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  registerSW({ immediate: true });
}
