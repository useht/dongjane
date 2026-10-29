import {
  type MonkMode,
  type SkyPeriod,
  type SkyState,
  type Weather,
  SEAT_NAMES,
  type Zone,
  ZONE_NAMES,
  chantEndsAt,
  chantPhase,
  isZone,
} from "@dongjane/shared";
import type { IconName } from "./icons.ts";

// 갓바위 has 돗자리 and the 법당 has 방석; the particle follows the last sound of the word.
export function seatName(zone: string): string {
  return SEAT_NAMES[isZone(zone) ? zone : "gatbawi"];
}

export function seatDirection(zone: string): string {
  return isZone(zone) && zone === "dharma" ? `${SEAT_NAMES.dharma}으로` : `${SEAT_NAMES.gatbawi}로`;
}

export function zoneName(zone: string): string {
  return ZONE_NAMES[isZone(zone) ? zone : "gatbawi"];
}

// "갓바위가 가득 차서 법당에 있어요": the zone the visitor asked for was full, so they stay in (or land in) the other one.
export function zoneFullNote(full: Zone, other: Zone): string {
  const subject = full === "dharma" ? `${ZONE_NAMES.dharma}이` : `${ZONE_NAMES.gatbawi}가`;
  return `${subject} 가득 차서 ${ZONE_NAMES[other]}에 있어요`;
}

export function modeLabel(mode: string, seatId: number, zone: string): string {
  switch (mode as MonkMode) {
    case "walk":
      return seatId >= 0 ? `${seatDirection(zone)} 가는 중` : "걷는 중";
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

const DAY_MINUTES = 24 * 60;

// Korean 12-hour clock for the KST hour skyAt() reports (fractional, 0..24).
export function formatClockTime(hour: number): string {
  if (!Number.isFinite(hour)) return "--:--";
  const wrapped = ((hour % 24) + 24) % 24;
  const total = Math.floor(wrapped * 60 + 1e-6) % DAY_MINUTES;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const meridiem = hours < 12 ? "오전" : "오후";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${meridiem} ${display}:${String(minutes).padStart(2, "0")}`;
}

const PERIOD_LABELS: Record<SkyPeriod, string> = { night: "밤", dawn: "새벽", day: "낮", dusk: "저녁" };
const WEATHER_LABELS: Record<Weather, string> = { clear: "맑음", cloudy: "흐림", rain: "비", snow: "눈" };
const WEATHER_NOTES: Record<Weather, string> = {
  clear: "하늘이 맑아요",
  cloudy: "구름이 끼었어요",
  rain: "비가 내리고 있어요",
  snow: "눈이 내리고 있어요",
};

// A clear sky shows the sun while the day is more than half lit, the moon otherwise.
export function weatherIconName(weather: Weather, daylight: number): IconName {
  if (weather === "clear") return daylight >= 0.5 ? "sun" : "moon";
  return weather === "cloudy" ? "cloud" : weather;
}

export interface ClockView {
  time: string;
  weather: string;
  note: string;
  icon: IconName;
}

export function describeSky(sky: SkyState | null): ClockView {
  if (!sky) return { time: "--:--", weather: "확인 중", note: "하늘을 확인하는 중이에요", icon: "cloud" };
  return {
    time: formatClockTime(sky.hour),
    weather: WEATHER_LABELS[sky.weather],
    note: `${PERIOD_LABELS[sky.period]} · ${WEATHER_NOTES[sky.weather]}`,
    icon: weatherIconName(sky.weather, sky.daylight),
  };
}
