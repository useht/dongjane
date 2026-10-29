import {
  type InstallHint,
  STANDALONE_QUERY,
  getInstallPrompt,
  installHint,
  isIosSafari,
  isStandalone,
  onInstallChange,
  takeInstallPrompt,
} from "../install.ts";
import { button, h, iconButton } from "./dom.ts";

const HINT_TEXT: Record<InstallHint, string> = {
  prompt: "동자네를 홈 화면에 설치하면 더 빠르게 열 수 있어요",
  ios: "공유 버튼을 누르고 '홈 화면에 추가'를 선택하면 설치할 수 있어요",
};

export class InstallBanner {
  private readonly root = h("div", "install-banner hidden");
  private readonly text = h("span", "install-text");
  private readonly action = button("설치하기", "install-action", () => this.install());
  private readonly standalone = window.matchMedia(STANDALONE_QUERY);
  private dismissed = false;
  private open = false;

  constructor(
    host: HTMLElement,
    private readonly onLayout: () => void,
  ) {
    const close = iconButton("close", "닫기", () => this.dismiss(), "install-close");
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "앱 설치 안내");
    this.root.append(this.text, this.action, close);
    host.append(this.root);

    onInstallChange(() => this.update());
    this.standalone.addEventListener("change", () => this.update());
    this.update();
  }

  private install(): void {
    const event = takeInstallPrompt();
    if (event) void event.prompt().catch(() => undefined);
  }

  private dismiss(): void {
    this.dismissed = true;
    this.update();
  }

  private update(): void {
    const installed = isStandalone(this.standalone.matches, (navigator as Navigator & { standalone?: boolean }).standalone);
    const hint = this.dismissed
      ? null
      : installHint({
          installed,
          hasPrompt: getInstallPrompt() !== null,
          iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
        });
    if (hint) this.text.textContent = HINT_TEXT[hint];
    this.action.classList.toggle("hidden", hint !== "prompt");
    this.root.classList.toggle("hidden", hint === null);

    const open = hint !== null;
    if (open === this.open) return;
    this.open = open;
    document.documentElement.classList.toggle("has-install-banner", open);
    this.onLayout();
  }
}
