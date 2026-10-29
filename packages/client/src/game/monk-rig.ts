import type { MonkPart } from "../assets/contract.ts";

// The skeleton the avatar animates and the monk.glb parts are authored around: each part's origin
// is its joint pivot (neck, hips, shoulder, elbow, wrist, ankle).
export const HIP_STAND = 0.4;
export const HIP_KNEEL = 0.2;
export const SKIRT_DROP = 0.36;
export const TORSO_HEIGHT = 0.38;
export const NECK_Y = TORSO_HEIGHT;
export const SHOULDER_X = 0.165;
export const SHOULDER_Y = 0.33;
export const UPPER_ARM = 0.18;
export const FORE_ARM = 0.16;
export const FOOT_X = 0.085;
export const FOOT_Y = 0.045;
export const CUSHION_TOP = 0.13;

export const MONK_RIG = {
  HIP_STAND,
  HIP_KNEEL,
  SKIRT_DROP,
  TORSO_HEIGHT,
  NECK_Y,
  SHOULDER_X,
  SHOULDER_Y,
  UPPER_ARM,
  FORE_ARM,
  FOOT_X,
  FOOT_Y,
  CUSHION_TOP,
} as const;

// Instances per monk: arms and feet are drawn twice from one mesh.
export const PART_COPIES: Readonly<Record<MonkPart, number>> = {
  head: 1,
  face: 1,
  skirt: 1,
  torso: 1,
  trim: 1,
  sleeveUpper: 2,
  sleeveLower: 2,
  hand: 2,
  foot: 2,
};
