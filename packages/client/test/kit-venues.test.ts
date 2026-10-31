import { readFileSync } from "node:fs";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { AVENUE, type Bounds, CHURCH_CANDLES, CHURCH_PEWS, SEAT_TOPS, SEAT_YAWS, SLOT_A1, SLOT_A2, VENUES, ZONE_SEATS, venueById } from "@dongjane/shared";
import { BUDGET, KIT_MESHES, KIT_PROTOTYPES } from "../src/assets/contract.ts";
import { REST_MAT } from "../src/game/kits/bathhouse.ts";
import { KNEELER } from "../src/game/kits/church.ts";
import { KITS, KIT_IDS, KIT_PADS, type KitPiece, type KitSpec, kitById, meshNames } from "../src/game/kits/index.ts";
import { PAD_HEIGHT } from "../src/game/kits/kit.ts";
import { PAD_FALLOFF, levelGround, padWeight } from "../src/game/ground-pads.ts";
import { KEEP_OUTS, WORLD_KEEP_OUTS, regionFor, startViewFor, viewFor, DHARMA_CAMERA_BOUNDS } from "../src/game/camera-rig.ts";
import { type ModelLoader, loadVenueKit, venueModelIds } from "../src/assets/registry.ts";
import { THEME } from "../src/theme.ts";
import { type Glb, type GlbNode, colors, loadGlb, rootNodes } from "./glb.ts";

const MODELS = new URL("../src/assets/models/", import.meta.url);
const TOLERANCE = 0.03;
// A cylinder or a sphere is a polygon, so the model's extent falls this short of the spec's at most.
const FACET_SLACK = 0.12;
const COLOR_TOLERANCE = 0.004;
// How far a window frame stands out of the wall's face.
const PROUD = 0.1 + 1e-6;

interface Box3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function extentOf(pieces: readonly KitPiece[]): Box3 {
  const box: Box3 = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const take = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    box.minX = Math.min(box.minX, x0);
    box.maxX = Math.max(box.maxX, x1);
    box.minY = Math.min(box.minY, y0);
    box.maxY = Math.max(box.maxY, y1);
    box.minZ = Math.min(box.minZ, z0);
    box.maxZ = Math.max(box.maxZ, z1);
  };
  for (const piece of pieces) {
    switch (piece.shape) {
      case "box":
        take(piece.min[0], piece.max[0], piece.min[1], piece.max[1], piece.min[2], piece.max[2]);
        break;
      case "cylinder": {
        const r = Math.max(piece.radius, piece.radiusTo ?? piece.radius);
        take(Math.min(piece.from[0], piece.to[0]) - r, Math.max(piece.from[0], piece.to[0]) + r, Math.min(piece.from[1], piece.to[1]), Math.max(piece.from[1], piece.to[1]), Math.min(piece.from[2], piece.to[2]) - r, Math.max(piece.from[2], piece.to[2]) + r);
        break;
      }
      case "sphere":
        take(piece.at[0] - piece.radii[0], piece.at[0] + piece.radii[0], piece.at[1] - piece.radii[1], piece.at[1] + piece.radii[1], piece.at[2] - piece.radii[2], piece.at[2] + piece.radii[2]);
        break;
      case "floor":
        take(piece.area.minX, piece.area.maxX, piece.y, piece.y, piece.area.minZ, piece.area.maxZ);
        break;
      case "gable":
        take(Math.min(piece.from[0], piece.to[0]), Math.max(piece.from[0], piece.to[0]), Math.min(piece.from[1], piece.to[1]), piece.ridge, Math.min(piece.from[2], piece.to[2]), Math.max(piece.from[2], piece.to[2]));
        break;
    }
  }
  return box;
}

function paintsOf(piece: KitPiece): string[] {
  return typeof piece.paint === "string" ? [piece.paint] : [...piece.paint];
}

const venueColors = new Set<string>(Object.values(THEME.venue));

function floorsOf(spec: KitSpec): Array<Extract<KitPiece, { shape: "floor" }>> {
  return (spec.meshes.floor ?? []).filter((piece): piece is Extract<KitPiece, { shape: "floor" }> => piece.shape === "floor");
}

// The venues that are a building with a door on the avenue, their slots and the pad a visitor kneels on in each.
const BUILDINGS = [
  { id: "bathhouse", slot: SLOT_A1, pad: REST_MAT, signature: "plaster" },
  { id: "church", slot: SLOT_A2, pad: KNEELER, signature: "brick" },
] as const;

const within = (box: Bounds, x: number, z: number): boolean => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;

function grid(area: Bounds, inset: number, step: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const x0 = area.minX + inset;
  const x1 = area.maxX - inset;
  const z0 = area.minZ + inset;
  const z1 = area.maxZ - inset;
  for (let x = x0; x <= x1 + 1e-9; x += step) for (let z = z0; z <= z1 + 1e-9; z += step) points.push([x, z]);
  return points;
}

describe("the kit venues", () => {
  it("are the street, the bathhouse and the church, each a venue of the registry", () => {
    expect(KIT_IDS).toEqual(["street", "bathhouse", "church"]);
    for (const kit of KITS) expect(venueById(kit.id), kit.id).toBeDefined();
    expect(kitById("street")?.look, "the street is only drawn: no light or camera of its own").toBeUndefined();
    expect(kitById("street")?.camera).toBeUndefined();
    for (const { id } of BUILDINGS) {
      expect(kitById(id)?.look, id).toBeDefined();
      expect(kitById(id)?.camera, id).toBeDefined();
    }
    expect(kitById("nowhere")).toBeUndefined();
  });

  it("have one model each under venues/, found by the registry", () => {
    expect(venueModelIds()).toEqual([...KIT_IDS].sort());
  });

  it("draw only the meshes the contract names, at least one each", () => {
    for (const kit of KITS) {
      const names = meshNames(kit);
      expect(names.length, kit.id).toBeGreaterThan(0);
      for (const name of names) expect(KIT_MESHES, `${kit.id}.${name}`).toContain(name);
    }
    expect(KIT_PROTOTYPES).toEqual(["seat"]);
  });

  it("paint with the theme's venue colours and nothing else", () => {
    for (const kit of KITS) {
      for (const pieces of Object.values(kit.meshes)) {
        for (const piece of pieces) {
          for (const paint of paintsOf(piece)) expect(venueColors.has(paint), `${kit.id}: ${paint}`).toBe(true);
        }
      }
    }
  });

  it("level the ground under every pad, and the pads cover each venue's footprint", () => {
    expect(KIT_PADS).toEqual(KITS.flatMap((kit) => kit.pads));
    expect(PAD_HEIGHT).toBeLessThan(0);
    for (const { id, slot } of BUILDINGS) {
      const kit = kitById(id) as KitSpec;
      for (const [x, z] of [[slot.minX, slot.minZ], [slot.maxX, slot.maxZ], [slot.minX, slot.maxZ], [slot.maxX, slot.minZ]] as const) {
        expect(kit.pads.some((pad) => within(pad, x, z)), `${id}: corner ${x}, ${z}`).toBe(true);
      }
    }
    const street = kitById("street") as KitSpec;
    expect(street.pads.some((pad) => pad.minX <= AVENUE.minX && pad.maxX >= AVENUE.maxX && pad.minZ <= AVENUE.minZ && pad.maxZ >= AVENUE.maxZ), "the avenue is one pad").toBe(true);
  });
});

describe("the street kit", () => {
  const street = kitById("street") as KitSpec;

  it("paves the avenue exactly", () => {
    const floors = floorsOf(street);
    expect(floors).toHaveLength(1);
    expect(floors[0]?.area).toEqual(AVENUE);
  });

  it("leaves the kerb open at every venue's apron and puts no lamp post in front of one", () => {
    const aprons = VENUES.flatMap((venue) => (venue.id === "street" ? [] : venue.areas.filter((area) => Math.abs(area.minZ - AVENUE.maxZ) < 1e-6)));
    expect(aprons.length, "every building's apron meets the avenue").toBeGreaterThanOrEqual(BUILDINGS.length);
    const shell = extentPieces(street, "shell");
    for (const apron of aprons) {
      for (const piece of shell) {
        if (piece.shape !== "box") continue;
        const crossesGap = piece.min[0] < apron.maxX - 1e-6 && piece.max[0] > apron.minX + 1e-6 && piece.min[2] < AVENUE.maxZ + 1e-6 && piece.max[2] > AVENUE.maxZ - 0.3 - 1e-6;
        expect(crossesGap, `a ${piece.min.join(",")} piece stands in the apron at ${apron.minX}..${apron.maxX}`).toBe(false);
      }
    }
  });
});

function extentPieces(spec: KitSpec, name: keyof KitSpec["meshes"]): readonly KitPiece[] {
  return spec.meshes[name] ?? [];
}

describe.each(BUILDINGS)("the $id kit against the shared layout", ({ id, slot, pad: size }) => {
  const spec = kitById(id) as KitSpec;
  const venue = venueById(id);
  if (!venue) throw new Error(`no ${id} venue`);
  const slotWithApron: Bounds = { minX: slot.minX, maxX: slot.maxX, minZ: AVENUE.maxZ, maxZ: slot.maxZ };
  const nearBy = 0.25;

  it("keeps every floor inside its slot and the apron before it", () => {
    for (const floor of floorsOf(spec)) {
      expect(floor.area.minX, JSON.stringify(floor.area)).toBeGreaterThanOrEqual(slotWithApron.minX);
      expect(floor.area.maxX).toBeLessThanOrEqual(slotWithApron.maxX);
      expect(floor.area.minZ).toBeGreaterThanOrEqual(slotWithApron.minZ);
      expect(floor.area.maxZ).toBeLessThanOrEqual(slotWithApron.maxZ);
    }
  });

  it("keeps the whole building, up to its eaves and the lit panes, inside the slot and the room round it", () => {
    for (const name of ["shell", "roof", "glow"] as const) {
      const extent = extentOf(extentPieces(spec, name));
      expect(extent.minX, name).toBeGreaterThanOrEqual(slot.minX - 0.6);
      expect(extent.maxX, name).toBeLessThanOrEqual(slot.maxX + 0.6);
      expect(extent.minZ, name).toBeGreaterThanOrEqual(slot.minZ - 0.6);
      expect(extent.maxZ, name).toBeLessThanOrEqual(slot.maxZ + 0.6);
    }
    const panes = extentOf(extentPieces(spec, "glow"));
    expect(panes.minX, "the panes stand out of the wall by a hand, no more").toBeGreaterThanOrEqual(slot.minX - nearBy);
    expect(panes.maxX).toBeLessThanOrEqual(slot.maxX + nearBy);
  });

  it("lays a floor at walking height under every walkable area, and none of them in the water", () => {
    const floors = floorsOf(spec);
    for (const area of venue.areas) {
      for (const [x, z] of grid(area, 0.05, 0.5)) {
        const here = floors.filter((floor) => within(floor.area, x, z));
        expect(
          here.some((floor) => floor.y >= 0 && floor.y <= 0.05),
          `no floor at walking height at ${x.toFixed(2)}, ${z.toFixed(2)}`,
        ).toBe(true);
      }
    }
    const water = extentOf(extentPieces(spec, "water"));
    for (const area of venue.areas) {
      const overlapsWater = area.minX < water.maxX - 1e-6 && area.maxX > water.minX + 1e-6 && area.minZ < water.maxZ - 1e-6 && area.maxZ > water.minZ + 1e-6;
      expect(overlapsWater, `walkable ${JSON.stringify(area)} dips into the water`).toBe(false);
    }
  });

  it("stands no wall, rim or bench where a visitor can walk, and leaves the doorway open", () => {
    for (const piece of extentPieces(spec, "shell")) {
      if (piece.shape !== "box") continue;
      const wallLike = piece.max[1] > 0.5 && piece.min[1] < 2.5;
      if (!wallLike) continue;
      for (const area of venue.areas) {
        // The plinth and the beam stand 0.04 proud of the wall and the window frames 0.1, on both sides: the rooms' inset covers that.
        const apart = piece.max[0] <= area.minX + PROUD || piece.min[0] >= area.maxX - PROUD || piece.max[2] <= area.minZ + PROUD || piece.min[2] >= area.maxZ - PROUD;
        expect(apart, `${JSON.stringify(piece)} stands in ${JSON.stringify(area)}`).toBe(true);
      }
    }
    const door = venue.areas.find((area) => area.maxX - area.minX < 2.5 && area.minZ <= slot.minZ);
    expect(door, "the doorway is an area through the north wall").toBeDefined();
    if (!door) return;
    const middle = (door.minX + door.maxX) / 2;
    for (const piece of extentPieces(spec, "shell")) {
      if (piece.shape !== "box") continue;
      const crosses = piece.min[0] < middle && piece.max[0] > middle && piece.min[2] < slot.minZ + 0.4 && piece.max[2] > slot.minZ && piece.min[1] < 2.0;
      expect(crosses, `${JSON.stringify(piece)} stands in the doorway`).toBe(false);
    }
  });

  it("draws the pad the layout seats, at the seat's height, inside the area it kneels in", () => {
    const seat = extentOf(extentPieces(spec, "seat"));
    expect(seat.minX).toBeCloseTo(-size.width / 2, 6);
    expect(seat.maxX).toBeCloseTo(size.width / 2, 6);
    expect(seat.minZ).toBeCloseTo(-size.depth / 2, 6);
    expect(seat.maxZ).toBeCloseTo(size.depth / 2, 6);
    expect(seat.maxY, "the top of the pad is where a seated monk rests").toBeCloseTo(SEAT_TOPS[id], 6);
    const yaw = SEAT_YAWS[id];
    const [halfX, halfZ] = [Math.abs(Math.cos(yaw)) * size.width / 2 + Math.abs(Math.sin(yaw)) * size.depth / 2, Math.abs(Math.sin(yaw)) * size.width / 2 + Math.abs(Math.cos(yaw)) * size.depth / 2];
    const pads = ZONE_SEATS[id];
    expect(pads.length).toBeLessThanOrEqual(40);
    for (const pad of pads) {
      expect(venue.areas.some((area) => pad.x - halfX >= area.minX - 1e-6 && pad.x + halfX <= area.maxX + 1e-6 && pad.z - halfZ >= area.minZ - 1e-6 && pad.z + halfZ <= area.maxZ + 1e-6), `pad ${pad.id} lies inside one area`).toBe(true);
      for (const other of pads.filter((candidate) => candidate.id > pad.id)) {
        const apart = Math.abs(pad.x - other.x) >= 2 * halfX - 1e-6 || Math.abs(pad.z - other.z) >= 2 * halfZ - 1e-6;
        expect(apart, `pads ${pad.id} and ${other.id} do not overlap`).toBe(true);
      }
    }
  });

  it("lights the room from lamps inside it, under the roof", () => {
    const look = spec.look;
    expect(look).toBeDefined();
    for (const lamp of look?.lamps ?? []) {
      expect(within(slot, lamp.at[0], lamp.at[2]), `lamp at ${lamp.at.join(",")}`).toBe(true);
      expect(lamp.at[1]).toBeGreaterThan(1);
      expect(lamp.at[1]).toBeLessThan(extentOf(extentPieces(spec, "roof")).maxY);
    }
    expect(look?.lamps.length, "two lamps at most: every light costs every material").toBeLessThanOrEqual(2);
    expect(look?.fog.near).toBeLessThan(look?.fog.far ?? 0);
  });

  it("holds the camera inside the walls, over the floor, with a view it can start in", () => {
    const camera = spec.camera;
    expect(camera).toBeDefined();
    if (!camera) return;
    const { bounds, limits, view, keepOut } = camera;
    expect(bounds.minX).toBeGreaterThanOrEqual(slot.minX);
    expect(bounds.maxX).toBeLessThanOrEqual(slot.maxX);
    expect(bounds.minZ).toBeGreaterThanOrEqual(slot.minZ);
    expect(bounds.maxZ).toBeLessThanOrEqual(slot.maxZ);
    expect(bounds.minY).toBeGreaterThan(0);
    expect(limits.minDistance).toBeLessThan(limits.maxDistance);
    expect(limits.minPitch).toBeLessThan(limits.maxPitch);
    expect(view.distance).toBeGreaterThanOrEqual(limits.minDistance);
    expect(view.distance).toBeLessThanOrEqual(limits.maxDistance);
    expect(view.pitch).toBeGreaterThanOrEqual(limits.minPitch);
    expect(view.pitch).toBeLessThanOrEqual(limits.maxPitch);
    const solid = extentOf([...extentPieces(spec, "shell"), ...extentPieces(spec, "roof")]);
    expect(keepOut.minX).toBeLessThanOrEqual(solid.minX);
    expect(keepOut.maxX).toBeGreaterThanOrEqual(solid.maxX);
    expect(keepOut.minZ).toBeLessThanOrEqual(solid.minZ);
    expect(keepOut.maxZ).toBeGreaterThanOrEqual(solid.maxZ);
    expect(keepOut.maxY, "over the tallest point of the building").toBeGreaterThanOrEqual(solid.maxY);
  });
});

describe("the church kit's furnishings", () => {
  const spec = kitById("church") as KitSpec;
  const boxes = (name: keyof KitSpec["meshes"]): Array<Extract<KitPiece, { shape: "box" }>> => extentPieces(spec, name).filter((piece): piece is Extract<KitPiece, { shape: "box" }> => piece.shape === "box");

  it("sets a bench in front of every strip a visitor kneels on, over the bench's whole length", () => {
    const shell = boxes("shell");
    for (const pew of CHURCH_PEWS) {
      const here = shell.filter((piece) => piece.min[2] >= pew.bench.minZ - 1e-6 && piece.max[2] <= pew.bench.maxZ + 1e-6 && piece.min[0] >= pew.bench.minX - 1e-6 && piece.max[0] <= pew.bench.maxX + 1e-6 && piece.max[1] > 0.7);
      expect(here.length, `pew ${pew.row} ${pew.side}`).toBeGreaterThan(0);
      expect(Math.min(...here.map((piece) => piece.min[0])), `pew ${pew.row} ${pew.side} starts at its bench's end`).toBeCloseTo(pew.bench.minX, 6);
      expect(Math.max(...here.map((piece) => piece.max[0])), `pew ${pew.row} ${pew.side} runs to its bench's end`).toBeCloseTo(pew.bench.maxX, 6);
    }
  });

  it("stands a rack on every candle's spot, with a lit flame above it", () => {
    for (const candle of CHURCH_CANDLES) {
      const stand = boxes("shell").find((piece) => piece.min[0] < candle.x && piece.max[0] > candle.x && piece.min[2] < candle.z && piece.max[2] > candle.z && piece.max[1] > 0.7);
      expect(stand, candle.id).toBeDefined();
      const flames = extentPieces(spec, "glow").filter((piece) => piece.shape === "cylinder" && Math.abs(piece.from[2] - candle.z) < 1e-6 && Math.abs(piece.from[0] - candle.x) < 0.5);
      expect(flames.length, `${candle.id} has flames`).toBeGreaterThan(0);
    }
  });

  it("keeps the tower and the roof out of the shell, which stays on while the camera is inside", () => {
    const shell = extentOf(extentPieces(spec, "shell"));
    expect(shell.maxY, "the walls and the beam under the eaves are the tallest part").toBeLessThanOrEqual(4.3);
    expect(extentOf(extentPieces(spec, "roof")).maxY, "the tower rises above the nave's roof").toBeGreaterThan(8);
  });
});

describe("the camera's regions", () => {
  it.each(BUILDINGS)("give the $id the kit's own box, zoom range and views", ({ id }) => {
    const camera = (kitById(id) as KitSpec).camera;
    expect(camera).toBeDefined();
    if (!camera) return;
    const region = regionFor(id);
    expect(region.bounds).toBe(camera.bounds);
    expect(region.limits).toBe(camera.limits);
    for (const aspect of [0.5, 1.6]) {
      expect(viewFor(id, aspect)).toEqual(camera.view);
      expect(startViewFor(id, aspect)).toEqual(camera.view);
    }
  });

  it("leave the 법당's and the open ground's regions as they were", () => {
    expect(regionFor("dharma").bounds).toBe(DHARMA_CAMERA_BOUNDS);
    expect(regionFor("gatbawi").bounds).not.toBe(regionFor("bathhouse").bounds);
    expect(viewFor("gatbawi", 1.6).distance).toBe(12);
    expect(viewFor("gatbawi", 0.5).distance).toBe(16);
    expect(startViewFor("gatbawi", 1.6).distance).toBe(7);
  });

  it("hold the world's camera out of every building as well as the 법당 and the casino, and keep the older boxes as they were", () => {
    expect(WORLD_KEEP_OUTS.slice(0, KEEP_OUTS.length)).toEqual(KEEP_OUTS);
    for (const { id } of BUILDINGS) expect(WORLD_KEEP_OUTS, id).toContainEqual((kitById(id) as KitSpec).camera?.keepOut);
    expect(WORLD_KEEP_OUTS).toHaveLength(KEEP_OUTS.length + BUILDINGS.length);
  });
});

describe("level ground", () => {
  const pad: Bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

  it("weighs 1 on a pad, 0 past the falloff and in between on the way out, following the nearest pad", () => {
    expect(padWeight([pad], 0, 0)).toBe(1);
    expect(padWeight([pad], 2, 0)).toBe(1);
    expect(padWeight([pad], 2 + PAD_FALLOFF, 0)).toBe(0);
    expect(padWeight([pad], 40, 40)).toBe(0);
    const near = padWeight([pad], 2.5, 0);
    const far = padWeight([pad], 3, 0);
    expect(near).toBeLessThan(1);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    const other: Bounds = { minX: 10, maxX: 12, minZ: -2, maxZ: 2 };
    expect(padWeight([pad, other], 11, 0)).toBe(1);
    expect(padWeight([pad, other], 2.5, 0)).toBe(near);
    expect(padWeight([], 0, 0)).toBe(0);
  });

  function hillside(): BufferGeometry {
    const geometry = new PlaneGeometry(20, 20, 20, 20);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) position.setY(i, 1 + position.getX(i) * 0.2);
    geometry.computeVertexNormals();
    return geometry;
  }

  it("presses the pad flat to the height, eases the hillside back round it and leaves the rest as it was", () => {
    const geometry = hillside();
    const before = {
      y: Float32Array.from(geometry.getAttribute("position").array).filter((_, i) => i % 3 === 1),
      normal: Float32Array.from(geometry.getAttribute("normal").array),
    };
    expect(levelGround(geometry, [pad], PAD_HEIGHT)).toBe(geometry);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    let flat = 0;
    let eased = 0;
    let untouched = 0;
    for (let i = 0; i < position.count; i += 1) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      const weight = padWeight([pad], x, z);
      expect(y, `vertex ${i}`).toBeCloseTo((before.y[i] as number) + (PAD_HEIGHT - (before.y[i] as number)) * weight, 4);
      if (weight === 1) {
        flat += 1;
        expect(y).toBeCloseTo(PAD_HEIGHT, 5);
        if (Math.abs(x) <= 1 && Math.abs(z) <= 1) expect(normal.getY(i), "the middle of a flat patch faces up").toBeGreaterThan(0.99);
      } else if (weight > 0) eased += 1;
      else {
        untouched += 1;
      }
    }
    expect(flat).toBeGreaterThan(10);
    expect(eased).toBeGreaterThan(5);
    expect(untouched).toBeGreaterThan(100);
    // Vertices that no triangle of the changed ones touches keep the baked normal exactly.
    const [farX, farZ] = [-9, -9];
    for (let i = 0; i < position.count; i += 1) {
      if (position.getX(i) !== farX || position.getZ(i) !== farZ) continue;
      for (let c = 0; c < 3; c += 1) expect(normal.array[i * 3 + c]).toBe(before.normal[i * 3 + c]);
    }
  });

  it("measures the geometry again, so culling follows the levelled ground", () => {
    const geometry = hillside();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.max.y).toBeCloseTo(3, 5);
    levelGround(geometry, [{ minX: 5, maxX: 10, minZ: -10, maxZ: 10 }], PAD_HEIGHT);
    expect(geometry.boundingBox?.max.y, "the crest is pressed down").toBeLessThan(2.1);
    expect(geometry.boundingBox?.min.y).toBeCloseTo(-1, 5);
  });

  it("leaves a geometry alone when there are no pads or no vertex is near one", () => {
    const geometry = hillside();
    const before = Float32Array.from(geometry.getAttribute("position").array);
    levelGround(geometry, [], PAD_HEIGHT);
    levelGround(geometry, [{ minX: 100, maxX: 101, minZ: 100, maxZ: 101 }], PAD_HEIGHT);
    expect(Float32Array.from(geometry.getAttribute("position").array)).toEqual(before);
  });

  it("does nothing to an unindexed geometry's normals but still lowers its pad", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 1, 0, 1, 1, 0, 0, 1, 1], 3));
    geometry.setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    levelGround(geometry, [{ minX: -1, maxX: 2, minZ: -1, maxZ: 2 }], PAD_HEIGHT);
    expect(geometry.getAttribute("position").getY(0)).toBeCloseTo(PAD_HEIGHT, 6);
  });
});

function checkModel(glb: Glb, spec: KitSpec): GlbNode[] {
  expect(glb.version).toBe(2);
  const nodes = rootNodes(glb);
  expect(nodes.map((node) => node.name).sort(), `${spec.id}.glb holds exactly the meshes its spec draws`).toEqual([...meshNames(spec)].sort());
  for (const node of nodes) {
    expect(node.identity, `${node.name} is a root node with an identity transform`).toBe(true);
    expect(node.primitives, `${node.name} primitives`).toBe(1);
    expect(node.attributes, node.name).toEqual(expect.arrayContaining(["POSITION", "NORMAL", "COLOR_0"]));
    expect(node.hasTexture, `${node.name} is vertex coloured`).toBe(false);
  }
  const { json } = glb;
  for (const primitive of json.meshes?.flatMap((mesh) => mesh.primitives) ?? []) expect(primitive.mode ?? 4).toBe(4);
  expect(json.images ?? []).toEqual([]);
  expect(json.skins ?? []).toEqual([]);
  expect(json.animations ?? []).toEqual([]);
  expect(json.cameras ?? []).toEqual([]);
  expect(json.extensionsUsed ?? []).toEqual([]);
  expect(json.extensionsRequired ?? []).toEqual([]);
  return nodes;
}

function linearOf(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
}

function carries(glb: Glb, mesh: string, target: readonly number[]): number {
  const { values, size, count } = colors(glb, mesh);
  let found = 0;
  for (let i = 0; i < count; i += 1) {
    if (target.every((channel, c) => Math.abs((values[i * size + c] as number) - channel) <= COLOR_TOLERANCE)) found += 1;
  }
  return found;
}

describe.each(KITS.map((kit) => [kit.id, kit] as const))("venues/%s.glb", (id, spec) => {
  const glb = loadGlb(new URL(`venues/${id}.glb`, MODELS));
  const nodes = checkModel(glb, spec);

  it("stays inside the kit's size budget", () => {
    expect(nodes.reduce((sum, node) => sum + node.triangles, 0)).toBeLessThanOrEqual(BUDGET.kit.tris);
    expect(glb.bytes).toBeLessThanOrEqual(BUDGET.kit.bytes);
  });

  it("draws every mesh where its spec's pieces put it, in the world's own metres", () => {
    for (const node of nodes) {
      const expected = extentOf(spec.meshes[node.name as keyof typeof spec.meshes] ?? []);
      const [min, max] = [node.positions.min, node.positions.max];
      const label = `${id}.${node.name}`;
      if (node.name === "seat") continue;
      expect(min[0], label).toBeGreaterThanOrEqual(expected.minX - TOLERANCE);
      expect(max[0], label).toBeLessThanOrEqual(expected.maxX + TOLERANCE);
      expect(min[1], label).toBeGreaterThanOrEqual(expected.minY - TOLERANCE);
      expect(max[1], label).toBeLessThanOrEqual(expected.maxY + TOLERANCE);
      expect(min[2], label).toBeGreaterThanOrEqual(expected.minZ - TOLERANCE);
      expect(max[2], label).toBeLessThanOrEqual(expected.maxZ + TOLERANCE);
      expect(min[0], label).toBeLessThanOrEqual(expected.minX + FACET_SLACK);
      expect(max[0], label).toBeGreaterThanOrEqual(expected.maxX - FACET_SLACK);
      expect(min[1], label).toBeLessThanOrEqual(expected.minY + FACET_SLACK);
      expect(max[1], label).toBeGreaterThanOrEqual(expected.maxY - FACET_SLACK);
      expect(min[2], label).toBeLessThanOrEqual(expected.minZ + FACET_SLACK);
      expect(max[2], label).toBeGreaterThanOrEqual(expected.maxZ - FACET_SLACK);
    }
  });

  it("paints vertices in linear light, never as sRGB", () => {
    for (const node of nodes) {
      const { values } = colors(glb, node.name);
      expect(Math.min(...values), `${node.name} darkest`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...values), `${node.name} brightest`).toBeLessThanOrEqual(1 + 1e-6);
    }
    const signature = { mesh: "shell", token: BUILDINGS.find((building) => building.id === id)?.signature ?? "kerb" };
    const hex = THEME.venue[signature.token as keyof typeof THEME.venue];
    const linear = linearOf(hex);
    const srgb = [1, 2, 3].map((_, c) => Number.parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255);
    expect(Math.max(...linear.map((channel, c) => Math.abs(channel - (srgb[c] as number)))), `${signature.token} tells linear from sRGB`).toBeGreaterThan(0.05);
    expect(carries(glb, signature.mesh, linear), `${signature.mesh} carries ${signature.token} in linear light`).toBeGreaterThan(0);
    expect(carries(glb, signature.mesh, srgb), `${signature.mesh} never carries ${signature.token} as sRGB`).toBe(0);
  });
});

describe.each(BUILDINGS)("venues/$id.glb's seat", ({ id, pad }) => {
  const glb = loadGlb(new URL(`venues/${id}.glb`, MODELS));
  const seat = rootNodes(glb).find((node) => node.name === "seat");

  it("is authored at the origin, as large as the layout seats, with its top at the seat's height", () => {
    expect(seat).toBeDefined();
    if (!seat) return;
    const { min, max } = seat.positions;
    expect(Math.abs((min[0] + max[0]) / 2)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs((min[2] + max[2]) / 2)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(max[0] - min[0] - pad.width)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(max[2] - min[2] - pad.depth)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(max[1] - SEAT_TOPS[id])).toBeLessThanOrEqual(0.005);
    expect(min[1]).toBeGreaterThanOrEqual(-0.01);
  });
});

// Node has no image decoding, but a kit model holds no picture, so the real files parse as they are.
function diskLoader(serve: (id: string) => Group): { loader: ModelLoader; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    loader: {
      async loadAsync(url) {
        const id = /([^/\\]+)\.glb(?:\?.*)?$/.exec(url)?.[1] ?? "";
        asked.push(id);
        return { scene: serve(id) };
      },
    },
  };
}

async function parsed(id: string): Promise<Group> {
  const file = readFileSync(new URL(`venues/${id}.glb`, MODELS));
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
  return gltf.scene;
}

function groupOf(names: readonly string[]): Group {
  const root = new Group();
  for (const name of names) {
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    mesh.name = name;
    root.add(mesh);
  }
  return root;
}

describe("loadVenueKit", () => {
  it("loads each kit's real model with exactly the meshes its spec draws", async () => {
    const scenes = new Map<string, Group>();
    for (const id of KIT_IDS) scenes.set(id, await parsed(id));
    for (const kit of KITS) {
      const { loader, asked } = diskLoader((id) => scenes.get(id) as Group);
      const model = await loadVenueKit(kit, loader);
      expect(asked).toEqual([kit.id]);
      expect(model.id).toBe(kit.id);
      expect(Object.keys(model.meshes).sort()).toEqual([...meshNames(kit)].sort());
      for (const name of meshNames(kit)) {
        const mesh = model.meshes[name];
        expect(mesh?.isMesh, `${kit.id}.${name}`).toBe(true);
        expect(mesh?.geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
      expect(() => model.dispose()).not.toThrow();
    }
  });

  it("says which model has no such file", async () => {
    const { loader } = diskLoader(() => groupOf([]));
    await expect(loadVenueKit({ id: "nowhere", meshes: {}, pads: [] }, loader)).rejects.toThrow("venues/nowhere.glb: there is no such model");
  });

  it("names a model that could not be loaded", async () => {
    const failing: ModelLoader = { loadAsync: () => Promise.reject(new Error("offline")) };
    await expect(loadVenueKit(kitById("bathhouse") as KitSpec, failing)).rejects.toThrow("venues/bathhouse.glb: could not be loaded");
  });

  it("rejects a mesh the contract does not know, one the spec needs that is missing, and one the spec does not draw", async () => {
    const bathhouse = kitById("bathhouse") as KitSpec;
    const names = meshNames(bathhouse);
    await expect(loadVenueKit(bathhouse, diskLoader(() => groupOf([...names, "banana"])).loader)).rejects.toThrow('unexpected mesh "banana"');
    await expect(loadVenueKit(bathhouse, diskLoader(() => groupOf(names.filter((name) => name !== "roof"))).loader)).rejects.toThrow('missing mesh "roof"');
    const street = kitById("street") as KitSpec;
    const drawn = meshNames(street);
    const spare = KIT_MESHES.find((name) => !drawn.includes(name));
    expect(spare, "the street leaves some mesh undrawn").toBeDefined();
    await expect(loadVenueKit(street, diskLoader(() => groupOf([...drawn, spare as string])).loader)).rejects.toThrow(`has mesh "${spare}", which its spec does not draw`);
  });
});
