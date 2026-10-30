export const ROOM_NAME = "world";
// One world holds a hundred visitors, who walk freely between its two zones; each zone has fifty seats.
export const ZONE_CAPACITY = 50;
export const WORLD_CAPACITY = 100;
export const WORLD_SPARE_AT = 90;
// Computer-driven monks who start in the 법당 and wander the whole world; they never count toward a capacity.
export const NPC_COUNT = 50;

export const TICK_MS = 50;
export const WALK_SPEED = 2.4;
export const BOW_MS = 2400;
export const BOW_COOLDOWN_MS = 600;
export const BOW_MAX_TIMES = 3;
export const EMOTE_COOLDOWN_MS = 1500;
export const KNOCK_COOLDOWN_MS = 300;
export const JUMP_COOLDOWN_MS = 700;
export const JUMP_MS = 600;
export const FISH_WAIT_MIN_MS = 3000;
export const FISH_WAIT_MAX_MS = 9000;
export const FISH_BITE_MS = 2500;

export const CHANT_EVERY_MS = 30 * 60 * 1000;
export const CHANT_MS = 3 * 60 * 1000;

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const RECONNECT_SECONDS = 180;
export const MESSAGE_RATE_PER_SECOND = 20;
export const ARRIVE_DISTANCE = 0.04;

export const WORLDS_PATH = "/api/worlds";
export const SEAT_PATH = "/api/worlds/seat";

export const MONK_MODES = ["stand", "walk", "kneel", "bow", "fish"] as const;
export type MonkMode = (typeof MONK_MODES)[number];
