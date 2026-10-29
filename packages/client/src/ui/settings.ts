import type { Settings } from "../storage.ts";
import { h } from "./dom.ts";
import { Sheet } from "./sheet.ts";

export interface SettingsHandlers {
  onChange(settings: Settings): void;
}

function toggleRow(label: string, hint: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const input = h("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", "row toggle", h("span", "row-text", h("strong", "", label), h("small", "", hint)), input, h("span", "switch"));
}

export class SettingsSheet {
  readonly sheet: Sheet;
  private readonly volume = h("input");
  private readonly sound: HTMLInputElement;
  private readonly wind: HTMLInputElement;
  private readonly reduce: HTMLInputElement;
  private current: Settings;

  constructor(
    host: HTMLElement,
    initial: Settings,
    private readonly handlers: SettingsHandlers,
  ) {
    this.current = { ...initial };
    this.sheet = new Sheet(host, "설정");

    this.volume.type = "range";
    this.volume.min = "0";
    this.volume.max = "100";
    this.volume.step = "1";
    this.volume.setAttribute("aria-label", "소리 크기");
    this.volume.addEventListener("input", () => this.update({ volume: Number(this.volume.value) / 100 }));
    const volumeRow = h("div", "row", h("span", "row-text", h("strong", "", "소리 크기")), this.volume);

    const soundRow = toggleRow("소리", "종소리와 절하는 소리", initial.sound, (sound) => this.update({ sound }));
    const windRow = toggleRow("바람 소리", "월드에 부는 잔잔한 바람", initial.wind, (wind) => this.update({ wind }));
    const reduceRow = toggleRow("움직임 줄이기", "카메라 흔들림과 부드러운 절 동작을 꺼요", initial.reduceMotion, (reduceMotion) =>
      this.update({ reduceMotion }),
    );
    this.sound = soundRow.querySelector("input") as HTMLInputElement;
    this.wind = windRow.querySelector("input") as HTMLInputElement;
    this.reduce = reduceRow.querySelector("input") as HTMLInputElement;

    this.sheet.body.append(volumeRow, soundRow, windRow, reduceRow, h("p", "fine-print", "설정은 이 기기에만 저장돼요."));
    this.sync(initial);
  }

  sync(settings: Settings): void {
    this.current = { ...settings };
    this.volume.value = String(Math.round(settings.volume * 100));
    this.sound.checked = settings.sound;
    this.wind.checked = settings.wind;
    this.reduce.checked = settings.reduceMotion;
  }

  private update(patch: Partial<Settings>): void {
    this.current = { ...this.current, ...patch };
    this.handlers.onChange({ ...this.current });
  }
}
