import "./style.css";
import { App } from "./app.ts";
import { type GameAssets, loadGameAssets } from "./assets/registry.ts";
import { type MonkAssets, loadMonkAssets } from "./game/monk-assets.ts";
import { captureInstallPrompt } from "./install.ts";
import { registerServiceWorker } from "./pwa.ts";

function showFatal(message: string): void {
  const ui = document.getElementById("ui");
  if (!ui) return;
  ui.replaceChildren();
  const card = document.createElement("div");
  card.className = "overlay";
  card.innerHTML = '<div class="overlay-card"><h2 class="overlay-title"></h2><p class="overlay-body"></p></div>';
  (card.querySelector("h2") as HTMLElement).textContent = "월드가 열리지 않아요";
  (card.querySelector("p") as HTMLElement).textContent = message;
  const retry = document.createElement("button");
  retry.className = "primary";
  retry.type = "button";
  retry.textContent = "다시 시도";
  retry.addEventListener("click", () => window.location.reload());
  card.querySelector(".overlay-card")?.append(retry);
  ui.append(card);
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  let assets: GameAssets;
  let monkAssets: MonkAssets;
  try {
    [assets, monkAssets] = await Promise.all([loadGameAssets(), loadMonkAssets()]);
  } catch (error) {
    console.error(error);
    showFatal("월드를 불러오지 못했어요. 다시 시도해 주세요.");
    return;
  }
  document.getElementById("boot")?.remove();
  try {
    await new App(assets, monkAssets).start();
  } catch (error) {
    console.error(error);
    showFatal("예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.");
  }
}

registerServiceWorker();
captureInstallPrompt(window);

if (!webglAvailable()) {
  showFatal("이 기기에서는 3D 화면을 열 수 없어요. 다른 브라우저로 열어 보세요.");
} else {
  void boot();
}
