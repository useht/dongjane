export const ROOM_NAME = "world";
export const WORLD_CAPACITY = 12;
export const WORLD_SPARE_AT = 10;

export const TICK_MS = 50;
export const WALK_SPEED = 2.4;
export const BOW_MS = 2400;
export const BOW_COOLDOWN_MS = 600;
export const BOW_MAX_TIMES = 3;

export const CHANT_EVERY_MS = 30 * 60 * 1000;
export const CHANT_MS = 3 * 60 * 1000;

export const RECONNECT_SECONDS = 20;
export const MESSAGE_RATE_PER_SECOND = 20;
export const ARRIVE_DISTANCE = 0.04;

export const WORLDS_PATH = "/api/worlds";
export const SEAT_PATH = "/api/worlds/seat";

export const MONK_MODES = ["stand", "walk", "kneel", "bow"] as const;
export type MonkMode = (typeof MONK_MODES)[number];
