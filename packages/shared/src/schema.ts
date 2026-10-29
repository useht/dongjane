import { schema, t, type SchemaType } from "@colyseus/schema";

export const Monk = schema(
  {
    id: t.string().default(""),
    slot: t.uint8().default(0),
    hue: t.uint16().default(0),
    x: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    mode: t.string().default("stand"),
    cushionId: t.int8().default(-1),
    bowCount: t.uint32().default(0),
  },
  "Monk",
);
export type Monk = SchemaType<typeof Monk>;

export const Cushion = schema(
  {
    id: t.uint8().default(0),
    occupantId: t.string().default(""),
  },
  "Cushion",
);
export type Cushion = SchemaType<typeof Cushion>;

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
    cushions: t.map(Cushion),
    chant: t.ref(Chant).default(() => new Chant()),
  },
  "TempleState",
);
export type TempleState = SchemaType<typeof TempleState>;
