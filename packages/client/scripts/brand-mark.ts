import { THEME } from "../src/theme.ts";

const b = THEME.brand;

// The monk face used by the favicon and the PWA icons. `scale` shrinks the artwork inside a
// full-bleed background so the maskable icon keeps its safe zone.
export function brandMarkSvg(scale: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="36%" r="78%">
      <stop offset="0" stop-color="${b.glowCore}"/>
      <stop offset="0.5" stop-color="${b.glowMid}"/>
      <stop offset="1" stop-color="${b.glowEdge}"/>
    </radialGradient>
    <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${b.robeTop}"/>
      <stop offset="1" stop-color="${b.robeBottom}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#glow)"/>
  <g transform="translate(256 272) scale(${scale}) translate(-256 -272)">
    <ellipse cx="256" cy="452" rx="150" ry="22" fill="${b.shadow}" opacity="0.28"/>
    <path d="M104 470 C112 382 184 346 256 346 C328 346 400 382 408 470 Z" fill="url(#robe)"/>
    <path d="M214 352 L256 410 L298 352" fill="none" stroke="${b.collar}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="150" cy="244" r="23" fill="${b.ear}"/>
    <circle cx="362" cy="244" r="23" fill="${b.ear}"/>
    <circle cx="256" cy="232" r="112" fill="${b.skin}"/>
    <ellipse cx="214" cy="160" rx="38" ry="22" fill="${b.shine}" opacity="0.55" transform="rotate(-28 214 160)"/>
    <circle cx="232" cy="148" r="6.5" fill="${b.mark}" opacity="0.8"/>
    <circle cx="256" cy="140" r="6.5" fill="${b.mark}" opacity="0.8"/>
    <circle cx="280" cy="148" r="6.5" fill="${b.mark}" opacity="0.8"/>
    <path d="M200 240 Q218 222 236 240" fill="none" stroke="${b.line}" stroke-width="9" stroke-linecap="round"/>
    <path d="M276 240 Q294 222 312 240" fill="none" stroke="${b.line}" stroke-width="9" stroke-linecap="round"/>
    <ellipse cx="188" cy="278" rx="22" ry="13" fill="${b.cheek}" opacity="0.55"/>
    <ellipse cx="324" cy="278" rx="22" ry="13" fill="${b.cheek}" opacity="0.55"/>
    <path d="M238 286 Q256 304 274 286" fill="none" stroke="${b.mouth}" stroke-width="8" stroke-linecap="round"/>
  </g>
</svg>
`;
}
