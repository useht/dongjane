import { schema, t, type SchemaType } from "@colyseus/schema";

export const Monk = schema(
  {
    id: t.string().default(""),
    slot: t.uint8().default(0),
    hue: t.uint16().default(0),
    x: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    zone: t.string().default("gatbawi"),
    mode: t.string().default("stand"),
    seatId: t.int8().default(-1),
    bowCount: t.uint32().default(0),
    ackSeq: t.uint32().default(0),
  },
  "Monk",
);
export type Monk = SchemaType<typeof Monk>;

// One seat of one zone; the state keeps one entry per seat, keyed "gatbawi:12".
export const Seat = schema(
  {
    zone: t.string().default("gatbawi"),
    id: t.uint8().default(0),
    occupantId: t.string().default(""),
  },
  "Seat",
);
export type Seat = SchemaType<typeof Seat>;

export const Chant = schema(
  {
    label: t.string().default(""),
    startsAt: t.float64().default(0),
    durationMs: t.uint32().default(0),
  },
  "Chant",
);
export type Chant = SchemaType<typeof Chant>;

export const TempleState = schema(
  {
    monks: t.map(Monk),
    seats: t.map(Seat),
    chant: t.ref(Chant).default(() => new Chant()),
    serverTime: t.float64().default(0),
  },
  "TempleState",
);
export type TempleState = SchemaType<typeof TempleState>;
