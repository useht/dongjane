// Inline 24px stroke icons. They draw with currentColor, so a theme token on the parent is all they need.
const PATHS = {
  hall: '<path d="M3 10.5 12 4l9 6.5M5.5 9.5V19h13V9.5M9.5 19v-5h5v5"/>',
  people:
    '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.2c2.4-.2 4 1.2 4.4 3.8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  soundOn: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sit: '<circle cx="12" cy="6" r="2.2"/><path d="M8.5 15c0-3.2 1.4-5 3.5-5s3.5 1.8 3.5 5"/><ellipse cx="12" cy="18.5" rx="8" ry="2.5"/>',
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
