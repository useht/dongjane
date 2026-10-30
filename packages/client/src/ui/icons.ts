// Inline 24px stroke icons. They draw with currentColor, so a theme token on the parent is all they need.
const PATHS = {
  world: '<path d="M3 10.5 12 4l9 6.5M5.5 9.5V19h13V9.5M9.5 19v-5h5v5"/>',
  people:
    '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.2c2.4-.2 4 1.2 4.4 3.8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m14.5 6-6 6 6 6"/>',
  book: '<path d="M4.5 5.5C7.5 4.5 10 5 12 7c2-2 4.5-2.5 7.5-1.5V18c-3-1-5.5-.5-7.5 1.5-2-2-4.5-2.5-7.5-1.5z"/><path d="M12 7v12.5"/>',
  sit: '<circle cx="12" cy="6" r="2.2"/><path d="M8.5 15c0-3.2 1.4-5 3.5-5s3.5 1.8 3.5 5"/><ellipse cx="12" cy="18.5" rx="8" ry="2.5"/>',
  play: '<path d="M8.5 5.5v13L19 12z" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4"/>',
  moon: '<path d="M20.5 12.8A8.6 8.6 0 1 1 11.2 3.5 6.8 6.8 0 0 0 20.5 12.8z"/>',
  cloud: '<path d="M7.5 18.5a4.5 4.5 0 0 1-.7-8.95 6 6 0 0 1 11.4 1.1A3.9 3.9 0 0 1 17.5 18.5z"/>',
  rain: '<path d="M7.5 14a4 4 0 0 1-.6-7.95 5.4 5.4 0 0 1 10.3 1A3.5 3.5 0 0 1 17 14z"/><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>',
  snow: '<path d="M7.5 14a4 4 0 0 1-.6-7.95 5.4 5.4 0 0 1 10.3 1A3.5 3.5 0 0 1 17 14z"/><circle cx="8" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="20.2" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="18" r="1" fill="currentColor" stroke="none"/>',
  stand: '<circle cx="12" cy="5" r="2.2"/><path d="M12 8.4v6.6M8 11.6l4-2 4 2M12 15l-2.6 6M12 15l2.6 6"/>',
  jump: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M6.5 19.5h11"/>',
  check: '<path d="m5.5 12.5 4.2 4.2L18.5 7.8"/>',
  putDown: '<circle cx="12" cy="6" r="2.8"/><path d="M12 11v6M9.2 14.4l2.8 2.8 2.8-2.8"/><path d="M5 20.5h14"/>',
  equip: '<path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/><path d="M6 8h12l1.2 12H4.8z"/><path d="M9.5 13h5"/>',
  emote:
    '<circle cx="12" cy="12" r="9"/><path d="M8.2 14.2a4.6 4.6 0 0 0 7.6 0"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as readonly IconName[];

export function iconMarkup(name: IconName, size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

export function icon(name: IconName): SVGSVGElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = iconMarkup(name);
  return wrapper.firstElementChild as SVGSVGElement;
}
