import { h, iconButton } from "./dom.ts";

// A bottom sheet on phones and a centred panel on desktop; only one is open at a time.
export class Sheet {
  readonly body = h("div", "sheet-body");
  private readonly backdrop = h("div", "sheet-backdrop hidden");
  private readonly panel = h("section", "sheet");
  private static current: Sheet | null = null;

  constructor(host: HTMLElement, title: string) {
    const close = iconButton("close", "닫기", () => this.close());
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", title);
    this.panel.append(h("header", "sheet-header", h("h2", "sheet-title", title), close), this.body);
    this.backdrop.append(this.panel);
    this.backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === this.backdrop) this.close();
    });
    host.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.classList.contains("hidden");
  }

  open(): void {
    if (Sheet.current && Sheet.current !== this) Sheet.current.close();
    Sheet.current = this;
    this.backdrop.classList.remove("hidden");
  }

  close(): void {
    this.backdrop.classList.add("hidden");
    if (Sheet.current === this) Sheet.current = null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  static closeOpen(): boolean {
    const open = Sheet.current;
    if (!open) return false;
    open.close();
    return true;
  }
}
