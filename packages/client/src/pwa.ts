import { registerSW } from "virtual:pwa-register";

const UPDATE_CHECK_MS = 5 * 60 * 1000;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return;
      // Browsers only re-fetch sw.js on navigation, so an open tab must ask; autoUpdate reloads on activation.
      const check = (): void => {
        registration.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
}
