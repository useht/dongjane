import { NAME_MAX_LENGTH, sanitizeName } from "@dongjane/shared";
import { type Profile, newHue, saveProfile } from "../storage.ts";
import { h } from "./dom.ts";

const BIRTH_MS = 2200;

// First-run screen: pick a name (up to 8 characters), then a short "birth" moment before entering the hall.
export function runIntro(host: HTMLElement, onGesture: () => void): Promise<Profile> {
  return new Promise((resolve) => {
    const input = h("input", "name-input");
    input.type = "text";
    input.maxLength = NAME_MAX_LENGTH;
    input.placeholder = "이름을 지어 주세요";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "동자승 이름");
    input.enterKeyHint = "go";

    const hint = h("p", "intro-hint", `최대 ${NAME_MAX_LENGTH}글자까지 쓸 수 있어요`);
    const submit = h("button", "primary big", "태어나기");
    submit.type = "submit";
    submit.disabled = true;

    const bud = h("div", "bud", h("span", "bud-glow"), h("span", "bud-petals"));
    const title = h("h1", "intro-title", "동자네");
    const lead = h("p", "intro-lead", "작은 동자승이 되어 법당에서 함께 쉬어가요");
    const form = h("form", "intro-form", input, hint, submit);
    const card = h("div", "intro-card", bud, title, lead, form);
    const root = h("div", "intro", card);
    host.append(root);

    const refresh = (): void => {
      submit.disabled = sanitizeName(input.value) === "";
    };
    input.addEventListener("input", refresh);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = sanitizeName(input.value);
      if (name === "") return;
      onGesture();
      const profile: Profile = { name, hue: newHue() };
      saveProfile(profile);

      form.remove();
      lead.remove();
      title.textContent = "동자승이 태어났어요";
      card.append(h("p", "intro-name", name));
      root.classList.add("born");
      window.setTimeout(() => {
        root.classList.add("leaving");
        window.setTimeout(() => {
          root.remove();
          resolve(profile);
        }, 600);
      }, BIRTH_MS);
    });

    window.setTimeout(() => input.focus({ preventScroll: true }), 120);
  });
}
