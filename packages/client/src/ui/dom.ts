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

export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const node = h("button", "icon-button", icon(name));
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  node.addEventListener("click", onClick);
  return node;
}

export function swapIcon(buttonNode: HTMLButtonElement, name: IconName): void {
  buttonNode.replaceChildren(icon(name));
}
