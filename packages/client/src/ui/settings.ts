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
  private readonly ambientVolume = h("input");
  private readonly effectVolume = h("input");
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

    for (const slider of [this.ambientVolume, this.effectVolume]) {
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
    }
    this.ambientVolume.setAttribute("aria-label", "배경 소리 크기");
    this.ambientVolume.addEventListener("input", () => this.update({ ambientVolume: Number(this.ambientVolume.value) / 100 }));
    this.effectVolume.setAttribute("aria-label", "효과음 크기");
    this.effectVolume.addEventListener("input", () => this.update({ effectVolume: Number(this.effectVolume.value) / 100 }));
    const ambientRow = h("div", "row", h("span", "row-text", h("strong", "", "배경 소리 크기")), this.ambientVolume);
    const effectRow = h("div", "row", h("span", "row-text", h("strong", "", "효과음 크기")), this.effectVolume);

    const soundRow = toggleRow("소리", "종소리와 절하는 소리", initial.sound, (sound) => this.update({ sound }));
    const windRow = toggleRow("바람 소리", "법당 밖에서 부는 잔잔한 바람", initial.wind, (wind) => this.update({ wind }));
    const reduceRow = toggleRow("움직임 줄이기", "카메라 흔들림과 부드러운 절 동작을 꺼요", initial.reduceMotion, (reduceMotion) =>
      this.update({ reduceMotion }),
    );
    this.sound = soundRow.querySelector("input") as HTMLInputElement;
    this.wind = windRow.querySelector("input") as HTMLInputElement;
    this.reduce = reduceRow.querySelector("input") as HTMLInputElement;

    this.sheet.body.append(ambientRow, effectRow, soundRow, windRow, reduceRow, h("p", "fine-print", "설정은 이 기기에만 저장돼요."));
    this.sync(initial);
  }

  sync(settings: Settings): void {
    this.current = { ...settings };
    this.ambientVolume.value = String(Math.round(settings.ambientVolume * 100));
    this.effectVolume.value = String(Math.round(settings.effectVolume * 100));
    this.sound.checked = settings.sound;
    this.wind.checked = settings.wind;
    this.reduce.checked = settings.reduceMotion;
  }

  private update(patch: Partial<Settings>): void {
    this.current = { ...this.current, ...patch };
    this.handlers.onChange({ ...this.current });
  }
}
