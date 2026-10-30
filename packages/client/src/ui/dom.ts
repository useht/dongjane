import { type IconName, icon } from "./icons.ts";

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = h("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

export function iconButton(name: IconName, label: string, onClick: () => void, className = "icon-button"): HTMLButtonElement {
  const node = h("button", className, icon(name));
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  node.addEventListener("click", onClick);
  return node;
}

export function swapIcon(holder: HTMLElement, name: IconName): void {
  holder.replaceChildren(icon(name));
}
