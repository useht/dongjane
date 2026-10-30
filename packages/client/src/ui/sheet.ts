import { h, iconButton } from "./dom.ts";

export interface SheetOptions {
  phone?: boolean;
}

// A bottom sheet on phones and a centred panel on desktop; only one is open at a time.
// The phone variant fills the screen on small displays and becomes a device frame on desktop.
export class Sheet {
  readonly body = h("div", "sheet-body");
  private readonly backdrop = h("div", "sheet-backdrop hidden");
  private readonly panel = h("section", "sheet");
  private readonly header = h("header", "sheet-header");
  private readonly heading = h("h2", "sheet-title");
  private back: HTMLButtonElement | null = null;
  private onBack: (() => void) | null = null;
  private static current: Sheet | null = null;

  constructor(host: HTMLElement, title: string, options: SheetOptions = {}) {
    const close = iconButton("close", "닫기", () => this.close());
    this.panel.setAttribute("role", "dialog");
    if (options.phone) {
      this.backdrop.classList.add("phone-backdrop");
      this.panel.classList.add("phone");
    }
    this.header.append(this.heading, close);
    this.panel.append(this.header, this.body);
    this.setTitle(title);
    this.backdrop.append(this.panel);
    this.backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === this.backdrop) this.close();
    });
    host.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.classList.contains("hidden");
  }

  setTitle(title: string): void {
    this.heading.textContent = title;
    this.panel.setAttribute("aria-label", title);
  }

  // A header back button on the left; null hides it.
  setBack(handler: (() => void) | null): void {
    this.onBack = handler;
    if (!this.back && handler) {
      this.back = iconButton("back", "뒤로", () => this.onBack?.(), "icon-button sheet-back");
      this.header.prepend(this.back);
    }
    this.back?.classList.toggle("hidden", !handler);
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
