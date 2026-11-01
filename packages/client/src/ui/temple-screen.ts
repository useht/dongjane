import { ScreenHold } from "../audio/screen-hold.ts";
import { type BlockReason, PLAYER_ORIGIN, type StageStatus, TAP_WINDOW_MS, embedUrl, listeningMessage, parsePlayerMessage, playerCommand } from "./stage-video.ts";
import { TEMPLE_VIDEO_ID, TempleVideoController } from "./temple-video.ts";
import { h } from "./dom.ts";

const TICK_MS = 500;

export interface TempleScreenHooks {
  onStatus(status: StageStatus, reason?: BlockReason): void;
  onTapNeeded(needed: boolean): void;
}

// The 법당's sound: a YouTube embed nobody sees, played only while the visitor is inside the room. It is kept on the page
// (not display:none, which iOS will not play) but invisible; it takes the taps only while the sound chip asks for one.
export class TempleScreen {
  private readonly box = h("div", "temple-video");
  private readonly controller: TempleVideoController;
  private readonly hold = new ScreenHold();
  private frame: HTMLIFrameElement | null = null;
  private timer: number | undefined;
  private tapTimer: number | undefined;
  private loaded = false;
  private heard = false;
  private onMessage: ((event: MessageEvent) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    serverNow: () => number | null,
    hooks: TempleScreenHooks,
  ) {
    this.box.setAttribute("aria-hidden", "true");
    canvas.before(this.box);
    this.controller = new TempleVideoController(
      {
        send: (func, args) => {
          if (this.loaded) this.frame?.contentWindow?.postMessage(playerCommand(func, args), PLAYER_ORIGIN);
        },
        status: (status, reason) => {
          if (status === "blocked") this.unmount();
          hooks.onStatus(status, reason);
        },
        tapNeeded: (needed) => {
          if (!needed) this.closeTapWindow();
          hooks.onTapNeeded(needed);
        },
      },
      () => performance.now(),
      () => serverNow() ?? Date.now(),
    );
  }

  get status(): StageStatus {
    return this.controller.status;
  }

  get mounted(): boolean {
    return this.frame !== null;
  }

  get playing(): boolean {
    return this.controller.playing;
  }

  mount(): void {
    if (this.frame) return;
    const frame = document.createElement("iframe");
    frame.className = "temple-frame";
    frame.src = embedUrl(window.location.origin, TEMPLE_VIDEO_ID);
    frame.title = "법당 소리";
    frame.tabIndex = -1;
    frame.allow = "autoplay; encrypted-media";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.addEventListener("load", () => {
      this.loaded = true;
      frame.contentWindow?.postMessage(listeningMessage(), PLAYER_ORIGIN);
    });
    this.frame = frame;
    this.loaded = false;
    this.heard = false;
    this.box.append(frame);
    this.onMessage = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== PLAYER_ORIGIN) return;
      const parsed = parsePlayerMessage(event.data);
      if (!parsed) return;
      this.heard = true;
      this.controller.receive(parsed);
    };
    window.addEventListener("message", this.onMessage);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.controller.open();
  }

  unmount(): void {
    window.clearInterval(this.timer);
    this.closeTapWindow();
    this.hold.set(false);
    if (this.onMessage) window.removeEventListener("message", this.onMessage);
    this.onMessage = null;
    this.frame?.remove();
    this.frame = null;
    if (this.controller.status !== "blocked") this.controller.close();
  }

  setInside(inside: boolean): void {
    this.controller.setInside(inside);
    this.hold.set(this.controller.playing);
  }

  setVolume(volume: number): void {
    this.controller.setVolume(volume);
  }

  userGesture(): void {
    this.controller.userGesture();
  }

  // iOS lets sound out only from a tap inside the player itself, so for a few seconds the invisible video takes the taps.
  openTapWindow(): void {
    if (!this.frame) return;
    this.box.classList.add("tap");
    window.clearTimeout(this.tapTimer);
    this.tapTimer = window.setTimeout(() => this.closeTapWindow(), TAP_WINDOW_MS);
  }

  dispose(): void {
    this.unmount();
    this.box.remove();
  }

  private closeTapWindow(): void {
    window.clearTimeout(this.tapTimer);
    this.box.classList.remove("tap");
  }

  private tick(): void {
    if (this.loaded && !this.heard) this.frame?.contentWindow?.postMessage(listeningMessage(), PLAYER_ORIGIN);
    this.controller.tick();
    this.hold.set(this.controller.playing);
  }
}
