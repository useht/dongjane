import { describe, expect, it } from "vitest";
import { TICK_MS } from "../src/constants.ts";
import { ARRIVAL, type Bounds, WORLD_BOUNDS } from "../src/layout.ts";
import { TempleSim } from "../src/sim.ts";
import { BATHHOUSE_LANES, BATHHOUSE_MATS, BATHHOUSE_POOL } from "../src/venues/bathhouse.ts";
import {
  BONFIRE_FIRE,
  BONFIRE_FIRES,
  BONFIRE_GATE,
  BONFIRE_LANE_WIDTH,
  BONFIRE_LOGS,
  BONFIRE_LOG_COUNT,
  BONFIRE_PIT,
  BONFIRE_PLACES,
  BONFIRE_ROOMS,
  BONFIRE_SEATS,
  CHURCH_CANDLES,
  CHURCH_KNEELERS,
  CHURCH_PEWS,
  CHURCH_ROOMS,
  SEAT_YAWS,
  type VenueDef,
  VENUES,
  DOOR_WIDTH,
  ZONE_SEATS,
  pickSeat,
  seatYaw,
  venueById,
} from "../src/venues/index.ts";
import { AVENUE } from "../src/venues/street.ts";
import { touches } from "../src/walk-graph.ts";
import { COURT_AREA, PLAZA_AREA, planPath, venueAt } from "../src/walk.ts";

// The venues that stand south of the plaza, along the avenue: what every one of them must keep, and the bathhouse in particular.
const FIRST_IDS: readonly string[] = ["gatbawi", "dharma", "shore", "casino"];
const NEW_VENUES: readonly VenueDef[] = VENUES.filter((venue: VenueDef) => !FIRST_IDS.includes(venue.id));
const BUILDINGS: readonly VenueDef[] = NEW_VENUES.filter((venue) => venue.id !== "street");
const ALL: readonly VenueDef[] = VENUES;

const overlaps = (a: Bounds, b: Bounds): boolean =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-6 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1e-6;
const holds = (area: Bounds, x: number, z: number, margin = 0): boolean =>
  x >= area.minX + margin && x <= area.maxX - margin && z >= area.minZ + margin && z <= area.maxZ - margin;
const middleOf = (area: Bounds): { x: number; z: number } => ({ x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 });

describe("the venues south of the plaza", () => {
  it("opens the street along the plaza's south edge, for walking and nothing else", () => {
    const street = venueById("street") as VenueDef;
    expect(street.footprint).toEqual(AVENUE);
    expect(AVENUE.minZ).toBe(WORLD_BOUNDS.maxZ);
    expect(touches(AVENUE, PLAZA_AREA)).toBe(true);
    expect(touches(AVENUE, COURT_AREA)).toBe(true);
    expect(street.seats).toBeUndefined();
    expect(street.indoor).toBe(false);
    expect(street.npc).toEqual({ stroll: false, seatWeight: 0 });
    expect(street.links).toContain("gatbawi");
    for (const venue of BUILDINGS) expect(street.links, venue.id).toContain(venue.id);
  });

  it("keeps the computer-driven monks and the daily quests out of every new venue, and joins each building to the street alone", () => {
    for (const venue of NEW_VENUES) {
      expect(venue.npc, venue.id).toEqual({ stroll: false, seatWeight: 0 });
      expect(venue.quests, venue.id).toBe(false);
    }
    for (const venue of BUILDINGS) expect(venue.links, venue.id).toEqual(["street"]);
  });

  it("gives each building a footprint clear of all other ground, the 법당, the plaza and the casino among it", () => {
    for (const venue of BUILDINGS) {
      for (const other of ALL) {
        if (other.id === venue.id) continue;
        for (const area of other.areas) expect(overlaps(venue.footprint, area), `${venue.id} and an area of ${other.id}`).toBe(false);
        if (other.seats || other.id === "casino") expect(overlaps(venue.footprint, other.footprint), `${venue.id} and ${other.id}`).toBe(false);
      }
    }
  });

  it("keeps the seats of every venue inside that venue's own areas, with room for a body, and apart from other seats", () => {
    const seated = ALL.filter((venue) => venue.seats);
    for (const venue of seated) {
      for (const spot of venue.seats?.spots ?? []) {
        expect(
          venue.areas.some((area) => holds(area, spot.x, spot.z, 0.3)),
          `${venue.id} seat ${spot.id}`,
        ).toBe(true);
        expect(venueAt(spot.x, spot.z), `${venue.id} seat ${spot.id}`).toBe(venue.id);
      }
    }
    const all = seated.flatMap((venue) => (venue.seats?.spots ?? []).map((spot) => ({ venue: venue.id, spot })));
    for (let a = 0; a < all.length; a += 1) {
      for (let b = a + 1; b < all.length; b += 1) {
        const one = all[a] as (typeof all)[number];
        const two = all[b] as (typeof all)[number];
        const apart = Math.hypot(one.spot.x - two.spot.x, one.spot.z - two.spot.z);
        expect(apart, `${one.venue}:${one.spot.id} and ${two.venue}:${two.spot.id}`).toBeGreaterThan(0.7);
      }
    }
  });

  it("puts the front of every activity on ground of the venue it belongs to", () => {
    for (const venue of ALL) {
      for (const spot of venue.activities ?? []) {
        expect(
          venue.areas.some((area) => holds(area, spot.frontX, spot.frontZ)),
          `${venue.id} ${spot.id}`,
        ).toBe(true);
      }
    }
  });

  it("walks from the arrival to every seat and every activity without leaving the ground", () => {
    const grounds = ALL.flatMap((venue) => venue.areas);
    const onGround = (x: number, z: number): boolean => grounds.some((area) => holds(area, x, z, -1e-4));
    const targets = [
      ...ALL.flatMap((venue) => (venue.seats?.spots ?? []).map((spot) => ({ name: `${venue.id}:${spot.id}`, x: spot.x, z: spot.z }))),
      ...ALL.flatMap((venue) => (venue.activities ?? []).map((spot) => ({ name: `${venue.id}/${spot.id}`, x: spot.frontX, z: spot.frontZ }))),
    ];
    for (const target of targets) {
      const path = planPath(ARRIVAL, target);
      const end = path[path.length - 1] as { x: number; z: number };
      expect(Math.hypot(end.x - target.x, end.z - target.z), target.name).toBeLessThan(1e-3);
      let from: { x: number; z: number } = ARRIVAL;
      for (const corner of path) {
        for (let step = 0; step <= 20; step += 1) {
          const x = from.x + ((corner.x - from.x) * step) / 20;
          const z = from.z + ((corner.z - from.z) * step) / 20;
          expect(onGround(x, z), `${target.name} at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
        }
        from = corner;
      }
    }
  });

  it("walks from the arrival into the middle of every building and back to the arrival", () => {
    for (const venue of BUILDINGS) {
      const last = venue.areas[venue.areas.length - 1] as Bounds;
      const middle = middleOf(last);
      expect(planPath(ARRIVAL, middle).at(-1), venue.id).toEqual(middle);
      expect(planPath(middle, ARRIVAL).at(-1), venue.id).toEqual({ x: ARRIVAL.x, z: ARRIVAL.z });
    }
  });
});

describe("the bathhouse", () => {
  const venue = venueById("bathhouse") as VenueDef;

  it("seats forty on mats in the rest room, facing the pool, and gives the pool four swimming lanes", () => {
    expect(BATHHOUSE_MATS).toHaveLength(40);
    expect(venue.seats?.spots).toBe(BATHHOUSE_MATS);
    expect(venue.indoor).toBe(true);
    expect(BATHHOUSE_LANES.map((lane) => lane.kind)).toEqual(["swim", "swim", "swim", "swim"]);
    expect(new Set(BATHHOUSE_LANES.map((lane) => lane.id)).size).toBe(4);
    expect(SEAT_YAWS.bathhouse).toBeCloseTo(Math.PI / 2, 9);
    for (const mat of BATHHOUSE_MATS) expect(mat.x).toBeGreaterThan(BATHHOUSE_POOL.maxX);
  });

  it("fills its slot of 14 by 14 and keeps the water out of the walkable ground", () => {
    expect(venue.footprint.maxX - venue.footprint.minX).toBeCloseTo(14, 9);
    expect(venue.footprint.maxZ - venue.footprint.minZ).toBeCloseTo(14, 9);
    expect(middleOf(venue.footprint)).toEqual({ x: 0, z: 29 });
    expect(holds(venue.footprint, BATHHOUSE_POOL.minX, BATHHOUSE_POOL.minZ)).toBe(true);
    expect(holds(venue.footprint, BATHHOUSE_POOL.maxX, BATHHOUSE_POOL.maxZ)).toBe(true);
    for (const other of ALL) for (const area of other.areas) expect(overlaps(area, BATHHOUSE_POOL), other.id).toBe(false);
    for (const lane of BATHHOUSE_LANES) expect(holds(BATHHOUSE_POOL, lane.x, lane.z)).toBe(true);
  });

  it("is entered from the avenue by a door in the wall facing it", () => {
    const [apron, door] = venue.areas as readonly [Bounds, Bounds];
    expect(touches(AVENUE, apron)).toBe(true);
    expect(touches(apron, door)).toBe(true);
    expect(door.minZ).toBe(venue.footprint.minZ);
    expect(apron.maxZ).toBe(venue.footprint.minZ);
  });
});

describe("the church", () => {
  const venue = venueById("church") as VenueDef;
  const { aisle, chancel, narthex } = CHURCH_ROOMS;

  it("seats forty on kneelers in five rows of pews, facing the altar, the front row first", () => {
    expect(CHURCH_KNEELERS).toHaveLength(40);
    expect(venue.seats?.spots).toBe(CHURCH_KNEELERS);
    expect(venue.indoor).toBe(true);
    expect(Math.abs(SEAT_YAWS.church)).toBeCloseTo(Math.PI, 9);
    expect(new Set(CHURCH_KNEELERS.map((spot) => spot.row))).toEqual(new Set([0, 1, 2, 3, 4]));
    for (const spot of CHURCH_KNEELERS) expect(spot.id).toBe(spot.row * 8 + spot.column);
    const rowZ = (row: number): number => CHURCH_KNEELERS.find((spot) => spot.row === row)?.z ?? Number.NaN;
    for (let row = 1; row < 5; row += 1) expect(rowZ(row), `row ${row} is further from the altar`).toBeLessThan(rowZ(row - 1));
    for (const spot of CHURCH_KNEELERS) expect(spot.z, `seat ${spot.id} is before the altar`).toBeLessThan(chancel.minZ);
    const first = pickSeat("church", () => false);
    expect(first?.row).toBe(0);
    expect(Math.abs((first?.x ?? 0) - middleOf(venue.footprint).x)).toBeLessThan(2);
    expect(pickSeat("church", (id) => id < 8)?.row).toBe(1);
  });

  it("opens each pew onto the aisle alone, and leaves the bench in front of it out of the walkable ground", () => {
    expect(CHURCH_PEWS).toHaveLength(10);
    for (const pew of CHURCH_PEWS) {
      const label = `row ${pew.row} ${pew.side}`;
      const joined = venue.areas.filter((area) => area !== pew.strip && touches(area, pew.strip));
      expect(joined, label).toEqual([aisle]);
      for (const area of venue.areas) expect(overlaps(area, pew.bench), `${label} bench and ${JSON.stringify(area)}`).toBe(false);
      expect(holds(venue.footprint, pew.bench.minX, pew.bench.minZ), label).toBe(true);
      expect(holds(venue.footprint, pew.bench.maxX, pew.bench.maxZ), label).toBe(true);
    }
    expect(touches(aisle, narthex)).toBe(true);
    expect(touches(aisle, chancel)).toBe(true);
    for (const pew of CHURCH_PEWS) expect(touches(narthex, pew.strip) || touches(chancel, pew.strip), `row ${pew.row} ${pew.side} stays clear of the narthex and the chancel`).toBe(false);
  });

  it("gives the candle racks a place to stand in the chancel, in front of the dais", () => {
    expect(CHURCH_CANDLES).toHaveLength(4);
    expect(CHURCH_CANDLES.every((candle) => candle.kind === "candle")).toBe(true);
    expect(new Set(CHURCH_CANDLES.map((candle) => candle.id)).size).toBe(4);
    for (const candle of CHURCH_CANDLES) {
      expect(holds(chancel, candle.frontX, candle.frontZ, 0.3), candle.id).toBe(true);
      expect(candle.z, `${candle.id} is on the altar side of its front`).toBeGreaterThan(candle.frontZ);
      expect(holds(venue.footprint, candle.x, candle.z), candle.id).toBe(true);
      for (const area of venue.areas) expect(holds(area, candle.x, candle.z), `${candle.id} stands in ${JSON.stringify(area)}`).toBe(false);
    }
  });

  it("walks a visitor from the bathhouse's gap in the avenue to a tap on the church's apron, and back", () => {
    const [apron] = venue.areas as readonly [Bounds];
    const gap = { x: -3, z: AVENUE.maxZ };
    const tap = { x: -18, z: 21.5 };
    expect(holds(apron, tap.x, tap.z)).toBe(true);
    let now = 1_800_000_000_000;
    const sim = new TempleSim({ clock: () => now, random: () => 0.5 });
    sim.join("a", 0);
    const walkTo = (to: { x: number; z: number }): void => {
      expect(sim.move("a", to.x, to.z)).toBe(true);
      for (let elapsed = 0; elapsed < 120_000 && sim.state.monks.get("a")?.mode !== "stand"; elapsed += TICK_MS) {
        now += TICK_MS;
        sim.tick(TICK_MS);
      }
      const monk = sim.state.monks.get("a");
      expect(monk?.mode).toBe("stand");
      expect(monk?.x).toBeCloseTo(to.x, 4);
      expect(monk?.z).toBeCloseTo(to.z, 4);
    };
    walkTo(gap);
    walkTo(tap);
    walkTo(gap);
  });

  it("fills its slot of 14 by 14 and is entered from the avenue by a door in the wall facing it", () => {
    expect(venue.footprint.maxX - venue.footprint.minX).toBeCloseTo(14, 9);
    expect(venue.footprint.maxZ - venue.footprint.minZ).toBeCloseTo(14, 9);
    expect(middleOf(venue.footprint)).toEqual({ x: -18, z: 29 });
    const [apron, door] = venue.areas as readonly [Bounds, Bounds];
    expect(touches(AVENUE, apron)).toBe(true);
    expect(touches(apron, door)).toBe(true);
    expect(door.minZ).toBe(venue.footprint.minZ);
    expect(apron.maxZ).toBe(venue.footprint.minZ);
  });
});

describe("the bonfire", () => {
  const venue = venueById("bonfire") as VenueDef;
  const { lane, turn, west, north, south, east } = BONFIRE_ROOMS;
  const onLog = (log: (typeof BONFIRE_LOGS)[number], share: number): { x: number; z: number } => ({
    x: log.from.x + (log.to.x - log.from.x) * share,
    z: log.from.z + (log.to.z - log.from.z) * share,
  });
  const distanceToLog = (log: (typeof BONFIRE_LOGS)[number], x: number, z: number): number => {
    const dx = log.to.x - log.from.x;
    const dz = log.to.z - log.from.z;
    const share = Math.max(0, Math.min(1, ((x - log.from.x) * dx + (z - log.from.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (log.from.x + dx * share), z - (log.from.z + dz * share));
  };

  it("seats twenty on five logs, four to a log, the places numbered log by log", () => {
    expect(BONFIRE_SEATS).toHaveLength(20);
    expect(BONFIRE_LOGS).toHaveLength(BONFIRE_LOG_COUNT);
    expect(venue.seats?.spots).toBe(BONFIRE_SEATS);
    expect(venue.indoor).toBe(false);
    for (const spot of BONFIRE_SEATS) {
      expect(spot.id).toBe(spot.row * BONFIRE_PLACES + spot.column);
      const log = BONFIRE_LOGS[spot.row] as (typeof BONFIRE_LOGS)[number];
      expect(distanceToLog(log, spot.x, spot.z), `seat ${spot.id} is on its log`).toBeLessThan(0.02);
    }
    for (const log of BONFIRE_LOGS) {
      const places = BONFIRE_SEATS.filter((spot) => spot.row === log.index);
      expect(places.map((spot) => spot.column)).toEqual([0, 1, 2, 3]);
    }
  });

  it("turns every place to the flames, and keeps the pit and the gaps between the logs clear", () => {
    for (const spot of BONFIRE_SEATS) {
      const yaw = seatYaw("bonfire", spot.id);
      const away = Math.hypot(BONFIRE_FIRE.x - spot.x, BONFIRE_FIRE.z - spot.z);
      // yaw is atan2(-dx, -dz): the monk looks along (-sin yaw, -cos yaw).
      expect(-Math.sin(yaw), `seat ${spot.id}`).toBeCloseTo((BONFIRE_FIRE.x - spot.x) / away, 5);
      expect(-Math.cos(yaw), `seat ${spot.id}`).toBeCloseTo((BONFIRE_FIRE.z - spot.z) / away, 5);
      expect(away, `seat ${spot.id}`).toBeGreaterThan(3);
      expect(away, `seat ${spot.id}`).toBeLessThan(4);
      expect(holds(BONFIRE_PIT, spot.x, spot.z, -0.5), `seat ${spot.id} is clear of the pit`).toBe(false);
    }
    expect(seatYaw("bonfire", 0)).not.toBeCloseTo(seatYaw("bonfire", 10), 3);
    expect(seatYaw("gatbawi", 3)).toBe(SEAT_YAWS.gatbawi);
    expect(seatYaw("bonfire", 99)).toBe(SEAT_YAWS.bonfire);
    for (const log of BONFIRE_LOGS) {
      for (let step = 0; step <= 20; step += 1) {
        const at = onLog(log, step / 20);
        expect(holds(BONFIRE_PIT, at.x, at.z, -0.5), `log ${log.index} clears the pit`).toBe(false);
      }
      const next = BONFIRE_LOGS[(log.index + 1) % BONFIRE_LOG_COUNT] as (typeof BONFIRE_LOGS)[number];
      let gap = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 20; step += 1) {
        const at = onLog(log, step / 20);
        gap = Math.min(gap, distanceToLog(next, at.x, at.z));
      }
      expect(gap, `the gap after log ${log.index} can be walked through`).toBeGreaterThan(1);
    }
  });

  it("leaves the gap between the last log and the first facing the lane, and seats a visitor nobody chose for beside it", () => {
    const first = pickSeat("bonfire", () => false);
    expect(first?.row).toBe(BONFIRE_LOG_COUNT - 1);
    const nearest = Math.min(...BONFIRE_SEATS.map((spot) => Math.hypot(spot.x - BONFIRE_GATE.x, spot.z - BONFIRE_GATE.z)));
    expect(Math.hypot((first?.x ?? 0) - BONFIRE_GATE.x, (first?.z ?? 0) - BONFIRE_GATE.z)).toBeCloseTo(nearest, 9);
  });

  it("tends one fire from the lane's side of it, facing it", () => {
    expect(BONFIRE_FIRES).toHaveLength(1);
    const [fire] = BONFIRE_FIRES as readonly [(typeof BONFIRE_FIRES)[number]];
    expect(fire.kind).toBe("fire");
    expect(venue.activities).toBe(BONFIRE_FIRES);
    expect({ x: fire.x, z: fire.z }).toEqual(BONFIRE_FIRE);
    expect(holds(north, fire.frontX, fire.frontZ, 0.3)).toBe(true);
    expect(holds(BONFIRE_PIT, fire.frontX, fire.frontZ)).toBe(false);
    // yaw is atan2(-dx, -dz), so the monk looks along (-sin yaw, -cos yaw): toward +z, at the flames.
    expect(-Math.sin(fire.yaw)).toBeCloseTo(0, 5);
    expect(-Math.cos(fire.yaw)).toBeCloseTo(Math.sign(fire.z - fire.frontZ), 5);
  });

  it("fills its slot of 10 by 14 in the open, with the fire in the middle of its width", () => {
    expect(venue.footprint.maxX - venue.footprint.minX).toBeCloseTo(10, 9);
    expect(venue.footprint.maxZ - venue.footprint.minZ).toBeCloseTo(14, 9);
    expect(middleOf(venue.footprint)).toEqual({ x: -2, z: 49 });
    expect(BONFIRE_FIRE.x).toBe(-2);
    expect(holds(venue.footprint, BONFIRE_PIT.minX, BONFIRE_PIT.minZ)).toBe(true);
    expect(holds(venue.footprint, BONFIRE_PIT.maxX, BONFIRE_PIT.maxZ)).toBe(true);
    for (const other of ALL) for (const area of other.areas) expect(overlaps(area, BONFIRE_PIT), other.id).toBe(false);
    for (const area of [west, north, south, east]) {
      expect(holds(venue.footprint, area.minX, area.minZ) && holds(venue.footprint, area.maxX, area.maxZ)).toBe(true);
    }
    expect(venue.areas).toEqual([lane, turn, west, north, south, east]);
  });

  it("is reached by a lane from the avenue, between the church and the bathhouse, that turns into the clearing", () => {
    expect(venue.areas[0]).toBe(lane);
    expect(touches(AVENUE, lane)).toBe(true);
    expect(touches(lane, turn)).toBe(true);
    expect(touches(turn, west)).toBe(true);
    expect(touches(west, north) && touches(west, south) && touches(north, east) && touches(south, east), "the strips join round the pit").toBe(true);
    expect(lane.maxX - lane.minX).toBeCloseTo(BONFIRE_LANE_WIDTH, 9);
    expect(overlaps(lane, venue.footprint)).toBe(false);
    const church = venueById("church") as VenueDef;
    const bathhouse = venueById("bathhouse") as VenueDef;
    expect(overlaps(lane, church.footprint)).toBe(false);
    expect(overlaps(lane, bathhouse.footprint)).toBe(false);
    expect(lane.minX).toBeGreaterThan(church.footprint.maxX);
    expect(lane.maxX).toBeLessThan(bathhouse.footprint.minX);
    expect(Math.min(turn.maxZ, west.maxZ) - Math.max(turn.minZ, west.minZ)).toBeGreaterThanOrEqual(DOOR_WIDTH - 1e-9);
  });

  it("walks from the arrival to every place and the fire by way of the lane, and back", () => {
    const targets = [...BONFIRE_SEATS, { x: BONFIRE_FIRES[0]?.frontX ?? 0, z: BONFIRE_FIRES[0]?.frontZ ?? 0 }];
    for (const target of targets) {
      const path = planPath(ARRIVAL, target);
      expect(path.at(-1)).toEqual({ x: target.x, z: target.z });
      expect(
        path.some((corner) => holds(lane, corner.x, corner.z)),
        "through the lane",
      ).toBe(true);
      expect(planPath(target, ARRIVAL).at(-1)).toEqual({ x: ARRIVAL.x, z: ARRIVAL.z });
    }
  });

  it("kneels twenty visitors on the logs, each turned to the fire", () => {
    let now = 1_800_000_000_000;
    const sim = new TempleSim({ clock: () => now, random: () => 0.5 });
    for (let i = 0; i < BONFIRE_SEATS.length; i += 1) {
      sim.join(`b${i}`, i * 11);
      expect(sim.sit(`b${i}`, "bonfire", i)).toBe(true);
    }
    for (let elapsed = 0; elapsed < 120_000; elapsed += TICK_MS) {
      now += TICK_MS;
      sim.tick(TICK_MS);
    }
    expect(sim.zoneCount("bonfire")).toBe(20);
    for (let i = 0; i < BONFIRE_SEATS.length; i += 1) {
      const monk = sim.state.monks.get(`b${i}`);
      const spot = ZONE_SEATS.bonfire[i] as (typeof BONFIRE_SEATS)[number];
      expect(monk?.mode, `b${i}`).toBe("kneel");
      expect(monk?.x).toBeCloseTo(spot.x, 4);
      expect(monk?.z).toBeCloseTo(spot.z, 4);
      expect(monk?.yaw).toBeCloseTo(seatYaw("bonfire", i), 5);
      expect(venueAt(monk?.x ?? 0, monk?.z ?? 0)).toBe("bonfire");
    }
  });
});
