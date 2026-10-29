import { button, h } from "./dom.ts";

export interface OverlayAction {
  label: string;
  run(): void;
}

// Full-screen status layer: loading, connection errors and the retry button. Never leaves the screen blank.
export class Overlay {
  readonly root = h("div", "overlay hidden");
  private readonly title = h("h2", "overlay-title");
  private readonly body = h("p", "overlay-body");
  private readonly actions = h("div", "overlay-actions");
  private readonly spinner = h("div", "overlay-lamp");

  constructor(host: HTMLElement) {
    this.root.setAttribute("role", "alert");
    this.root.append(h("div", "overlay-card", this.spinner, this.title, this.body, this.actions));
    host.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  loading(title: string, body = ""): void {
    this.show(title, body, [], true);
  }

  problem(title: string, body: string, actions: OverlayAction[]): void {
    this.show(title, body, actions, false);
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  private show(title: string, body: string, actions: OverlayAction[], busy: boolean): void {
    this.title.textContent = title;
    this.body.textContent = body;
    this.body.hidden = body === "";
    this.spinner.classList.toggle("busy", busy);
    this.actions.replaceChildren(...actions.map((action) => button(action.label, "primary", action.run)));
    this.root.classList.remove("hidden");
    this.actions.querySelector("button")?.focus();
  }
}
