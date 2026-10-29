import { type BlockReason, PLAYER_ORIGIN, StageVideoController, type StageStatus, TAP_WINDOW_MS, embedUrl, listeningMessage, parsePlayerMessage, playerCommand } from "./stage-video.ts";
import { type Quad, quadTransform } from "./stage-quad.ts";
import { h } from "./dom.ts";

const TICK_MS = 500;
// A quad this far off the canvas is a screen seen from a hair's breadth; the matrix would only lose precision.
const FAR_PIXELS = 20_000;

export interface StageScreenHooks {
  onStatus(status: StageStatus, reason?: BlockReason): void;
  onTapNeeded(needed: boolean): void;
  onPlayNeeded(needed: boolean): void;
  onAudible(audible: boolean): void;
}

export interface StageScreenSize {
  width: number;
  height: number;
}

// The concert video: a YouTube embed that sits behind the transparent canvas and is warped onto the 3D LED screen,
// whose pixels the renderer leaves empty. The page never loads YouTube's script; the embed is steered by postMessage.
export class StageScreen {
  private readonly box = h("div", "stage-video");
  private readonly controller: StageVideoController;
  private frame: HTMLIFrameElement | null = null;
  private timer: number | undefined;
  private tapTimer: number | undefined;
  private loaded = false;
  private heard = false;
  private lastTransform = "";
  private reduceMotion = false;
  private onMessage: ((event: MessageEvent) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly size: StageScreenSize,
    serverNow: () => number | null,
    private readonly hooks: StageScreenHooks,
  ) {
    this.box.style.width = `${size.width}px`;
    this.box.style.height = `${size.height}px`;
    this.box.setAttribute("aria-hidden", "true");
    canvas.before(this.box);
    this.controller = new StageVideoController(
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
        playNeeded: (needed) => hooks.onPlayNeeded(needed),
        audible: (audible) => hooks.onAudible(audible),
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

  mount(): void {
    if (this.frame) return;
    const frame = document.createElement("iframe");
    frame.className = "stage-frame";
    frame.src = embedUrl(window.location.origin);
    frame.title = "무대 영상";
    frame.tabIndex = -1;
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.addEventListener("load", () => {
      this.loaded = true;
      frame.contentWindow?.postMessage(listeningMessage(), PLAYER_ORIGIN);
    });
    this.frame = frame;
    this.loaded = false;
    this.heard = false;
    this.box.append(frame);
    this.box.style.opacity = this.reduceMotion ? "0" : "";
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
    if (this.onMessage) window.removeEventListener("message", this.onMessage);
    this.onMessage = null;
    this.frame?.remove();
    this.frame = null;
    this.lastTransform = "";
    if (this.controller.status !== "blocked") this.controller.close();
  }

  // Lays the video over the screen's corners as the camera sees them, or hides it when they cannot be placed.
  place(quad: Quad | null): void {
    const matrix = quad && this.reachable(quad) ? quadTransform(this.size.width, this.size.height, quad) : null;
    if (matrix === null) {
      this.box.classList.remove("placed");
      this.lastTransform = "";
      return;
    }
    if (matrix === this.lastTransform) return;
    this.lastTransform = matrix;
    this.box.style.transform = matrix;
    this.box.classList.add("placed");
  }

  setSound(on: boolean, volume: number): void {
    this.controller.setSound(on, volume);
  }

  setLevel(level: number): void {
    this.controller.setLevel(level);
  }

  userGesture(): void {
    this.controller.userGesture();
  }

  resume(): void {
    this.controller.resume();
  }

  setHidden(hidden: boolean): void {
    this.controller.setHidden(hidden);
  }

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
    this.box.style.opacity = value ? "0" : "";
  }

  // iOS lets sound out only from a tap inside the player itself, so for a few seconds the video takes the taps.
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

  private reachable(quad: Quad): boolean {
    return quad.every((point) => Math.abs(point.x) < FAR_PIXELS && Math.abs(point.y) < FAR_PIXELS);
  }

  private tick(): void {
    if (this.loaded && !this.heard) this.frame?.contentWindow?.postMessage(listeningMessage(), PLAYER_ORIGIN);
    this.controller.tick();
  }
}
