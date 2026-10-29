import { homeTitleName } from "../collection/titles.ts";
import { CollectionApp } from "./collection.ts";
import { type IconName, button, h, icon, swapIcon } from "./dom.ts";
import type { ClockView } from "./format.ts";
import { Sheet } from "./sheet.ts";

export interface PhoneHandlers {
  onInvite(): void;
  onToggleSound(): void;
}

export interface PhoneContents {
  visitors: HTMLElement;
  settings: HTMLElement;
}

type AppId = "collection" | "visitors" | "settings";

interface AppScreen {
  title: string;
  root: HTMLElement;
}

interface AppTile {
  node: HTMLButtonElement;
  iconHolder: HTMLElement;
  label: HTMLElement;
}

const HOME_TITLE = "동자네";

function appTile(name: IconName, label: string, onClick: () => void): AppTile {
  const iconHolder = h("span", "app-tile-icon", icon(name));
  const labelNode = h("span", "app-tile-label", label);
  const node = h("button", "app-tile", iconHolder, labelNode);
  node.type = "button";
  node.addEventListener("click", onClick);
  return { node, iconHolder, label: labelNode };
}

// The top-right clock opens this: a home screen with the sky clock and an app grid.
export class Phone {
  readonly collection = new CollectionApp();
  private readonly sheet: Sheet;
  private readonly screens: Record<AppId, AppScreen>;
  private readonly home: HTMLElement;
  private readonly heroIcon = h("span", "clock-hero-icon");
  private readonly heroTime = h("strong", "clock-hero-time");
  private readonly heroNote = h("p", "clock-hero-note");
  private readonly visitorBadge = h("span", "badge", "0");
  private readonly sound: AppTile;
  private lastIcon: IconName | null = null;
  private homeTitle = HOME_TITLE;
  private current: AppId | null = null;

  constructor(host: HTMLElement, handlers: PhoneHandlers, contents: PhoneContents) {
    this.sheet = new Sheet(host, HOME_TITLE, { phone: true });

    this.screens = {
      collection: { title: "도감", root: h("div", "phone-screen hidden", this.collection.root) },
      visitors: {
        title: "방문객",
        root: h("div", "phone-screen hidden", contents.visitors, button("초대 링크 복사", "primary wide", () => handlers.onInvite())),
      },
      settings: { title: "설정", root: h("div", "phone-screen hidden", contents.settings) },
    };

    const collectionTile = appTile("book", "도감", () => this.show("collection"));
    const visitorsTile = appTile("people", "방문객", () => this.show("visitors"));
    visitorsTile.iconHolder.append(this.visitorBadge);
    const inviteTile = appTile("link", "초대 링크", () => {
      this.sheet.close();
      handlers.onInvite();
    });
    this.sound = appTile("soundOn", "소리 끄기", () => handlers.onToggleSound());
    const settingsTile = appTile("gear", "설정", () => this.show("settings"));

    this.home = h(
      "div",
      "phone-home",
      h("div", "clock-hero", this.heroIcon, this.heroTime, this.heroNote),
      h("div", "app-grid", collectionTile.node, visitorsTile.node, inviteTile.node, this.sound.node, settingsTile.node),
    );
    this.sheet.body.append(this.home, this.screens.collection.root, this.screens.visitors.root, this.screens.settings.root);
  }

  toggle(): void {
    if (this.sheet.isOpen) {
      this.sheet.close();
      return;
    }
    this.show(null);
    this.sheet.open();
  }

  setSky(view: ClockView): void {
    this.heroTime.textContent = view.time;
    this.heroNote.textContent = view.note;
    if (view.icon !== this.lastIcon) {
      this.lastIcon = view.icon;
      swapIcon(this.heroIcon, view.icon);
    }
  }

  setBows(total: number): void {
    this.collection.setBows(total);
    this.homeTitle = homeTitleName(total) ?? HOME_TITLE;
    if (this.current === null) this.sheet.setTitle(this.homeTitle);
  }

  setVisitorCount(count: number): void {
    this.visitorBadge.textContent = String(count);
  }

  setSoundOn(on: boolean): void {
    swapIcon(this.sound.iconHolder, on ? "soundOn" : "soundOff");
    this.sound.label.textContent = on ? "소리 끄기" : "소리 켜기";
  }

  private show(app: AppId | null): void {
    this.current = app;
    this.home.classList.toggle("hidden", app !== null);
    for (const id of Object.keys(this.screens) as AppId[]) this.screens[id].root.classList.toggle("hidden", id !== app);
    this.sheet.setTitle(app ? this.screens[app].title : this.homeTitle);
    this.sheet.setBack(app ? () => this.show(null) : null);
    this.sheet.body.scrollTop = 0;
  }
}
