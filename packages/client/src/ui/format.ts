import { type MonkMode, chantEndsAt, chantPhase } from "@dongjane/shared";

export function modeLabel(mode: string, matId: number): string {
  switch (mode as MonkMode) {
    case "walk":
      return matId >= 0 ? "돗자리로 가는 중" : "걷는 중";
    case "kneel":
      return "앉아 있어요";
    case "bow":
      return "절하는 중";
    default:
      return "서 있어요";
  }
}

export interface ChantStatus {
  phase: "upcoming" | "active" | "ended";
  text: string;
  imminent: boolean;
}

export function describeChant(
  chant: { label: string; startsAt: number; durationMs: number },
  now: number,
): ChantStatus {
  const phase = chantPhase(chant, now);
  if (phase === "active") {
    const left = Math.max(0, Math.ceil((chantEndsAt(chant) - now) / 1000));
    return { phase, text: `${chant.label} 중 · ${formatSpan(left)} 남았어요`, imminent: true };
  }
  if (phase === "upcoming") {
    const wait = Math.max(0, Math.ceil((chant.startsAt - now) / 1000));
    return { phase, text: `다음 ${chant.label} · ${formatSpan(wait)} 뒤`, imminent: wait <= 60 };
  }
  return { phase, text: chant.label, imminent: false };
}

export function formatSpan(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}초`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
