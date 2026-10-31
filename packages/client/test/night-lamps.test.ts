import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";
import { LAMP_REACH, LANTERN_GLOW, NightLamps, type NightLampsSpec, STREET_LAMP_GLOW, nightGlow } from "../src/game/night-lamps.ts";

describe("nightGlow", () => {
  const range = { day: 0.2, night: 1.4 };

  it("is the day's glow at 0, the night's at 1, and a straight line between", () => {
    expect(nightGlow(range, 0)).toBe(range.day);
    expect(nightGlow(range, 1)).toBeCloseTo(range.night, 12);
    expect(nightGlow(range, 0.5)).toBeCloseTo(0.8, 12);
    expect(nightGlow(range, 0.25)).toBeCloseTo(0.5, 12);
  });

  it("gives the paper lanterns the glow they always had, and the street lamps the same night glow from a brighter day", () => {
    expect(LANTERN_GLOW).toEqual({ day: 0.12, night: 1.1 });
    for (const sky of [0, 0.3, 0.7, 1]) expect(nightGlow(LANTERN_GLOW, sky)).toBeCloseTo(0.12 + (1.1 - 0.12) * sky, 12);
    expect(STREET_LAMP_GLOW.night).toBe(LANTERN_GLOW.night);
    expect(STREET_LAMP_GLOW.day).toBeGreaterThan(LANTERN_GLOW.day);
    expect(STREET_LAMP_GLOW.day).toBeLessThan(STREET_LAMP_GLOW.night);
  });
});

describe("NightLamps", () => {
  const spots = [
    [1, 3.5, 2],
    [9, 3.5, 2],
    [17, 3.5, 2],
  ] as const;

  function spec(texture = new Texture()): NightLampsSpec {
    return { spots, groundY: 0.03, haloRadius: 1.1, poolRadius: 3.5, color: "#ffd9a0", texture };
  }

  const halosOf = (lamps: NightLamps): Sprite[] => lamps.group.children.filter((child): child is Sprite => child instanceof Sprite);
  const poolsOf = (lamps: NightLamps): Mesh[] => lamps.group.children.filter((child): child is Mesh => child instanceof Mesh);

  it("hangs one halo at each globe and lays one pool on the ground under it", () => {
    const lamps = new NightLamps(spec());
    expect(halosOf(lamps)).toHaveLength(spots.length);
    expect(poolsOf(lamps)).toHaveLength(spots.length);
    halosOf(lamps).forEach((halo, index) => {
      expect(halo.position.toArray()).toEqual(spots[index]);
      expect(halo.scale.x).toBeCloseTo(2.2, 9);
      expect(halo.scale.y).toBeCloseTo(2.2, 9);
    });
    poolsOf(lamps).forEach((pool, index) => {
      const [x, , z] = spots[index] as readonly [number, number, number];
      expect(pool.position.x).toBe(x);
      expect(pool.position.z).toBe(z);
      expect(pool.position.y, "a hair over the paving").toBeGreaterThan(0.03);
      expect(pool.position.y).toBeLessThan(0.06);
    });
    const geometry = poolsOf(lamps)[0]?.geometry as PlaneGeometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.max.x).toBeCloseTo(3.5, 9);
    expect(geometry.boundingBox?.max.y, "flat").toBeCloseTo(0, 9);
    expect(poolsOf(lamps).every((pool) => pool.geometry === geometry), "the pools share one plane").toBe(true);
  });

  it("draws both as an additive glow that no fog, tone mapping or depth write changes", () => {
    const texture = new Texture();
    const lamps = new NightLamps(spec(texture));
    const halo = halosOf(lamps)[0]?.material as SpriteMaterial;
    const pool = poolsOf(lamps)[0]?.material as MeshBasicMaterial;
    for (const material of [halo, pool]) {
      expect(material.map).toBe(texture);
      expect(material.blending).toBe(AdditiveBlending);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.fog).toBe(false);
      expect(material.toneMapped).toBe(false);
      expect(material.color.getHexString()).toBe("ffd9a0");
    }
    expect(pool.polygonOffset, "the pool never fights the paving").toBe(true);
    expect(halosOf(lamps).every((sprite) => sprite.material === halo), "the halos share one material").toBe(true);
  });

  it("is lit by no light of its own", () => {
    const lamps = new NightLamps(spec());
    let lights = 0;
    lamps.group.traverse((object) => {
      if ((object as { isLight?: boolean }).isLight) lights += 1;
    });
    expect(lights).toBe(0);
  });

  it("starts out of sight and brings the halos and pools up in step with the night, the pool the fainter", () => {
    const lamps = new NightLamps(spec());
    const halo = halosOf(lamps)[0]?.material as SpriteMaterial;
    const pool = poolsOf(lamps)[0]?.material as MeshBasicMaterial;
    expect(lamps.group.visible).toBe(false);
    expect(halo.opacity).toBe(0);
    lamps.setNight(1);
    expect(lamps.group.visible).toBe(true);
    expect(halo.opacity).toBeGreaterThan(0.5);
    expect(halo.opacity).toBeLessThanOrEqual(1);
    expect(pool.opacity).toBeGreaterThan(0);
    expect(pool.opacity).toBeLessThan(halo.opacity);
    const [fullHalo, fullPool] = [halo.opacity, pool.opacity];
    lamps.setNight(0.5);
    expect(halo.opacity).toBeCloseTo(fullHalo / 2, 9);
    expect(pool.opacity).toBeCloseTo(fullPool / 2, 9);
    expect(lamps.group.visible).toBe(true);
    lamps.setNight(0);
    expect(halo.opacity).toBe(0);
    expect(pool.opacity).toBe(0);
    expect(lamps.group.visible, "nothing to draw by day").toBe(false);
  });

  it("makes nothing for a street with no lamps", () => {
    const lamps = new NightLamps({ ...spec(), spots: [] });
    expect(lamps.group.children).toHaveLength(0);
    expect(() => lamps.setNight(1)).not.toThrow();
    expect(() => lamps.dispose()).not.toThrow();
  });

  it("releases its own materials and plane, leaves the glow texture to its owner, and leaves the scene", () => {
    const texture = new Texture();
    const lamps = new NightLamps(spec(texture));
    const root = new Group();
    root.add(lamps.group);
    const halo = halosOf(lamps)[0]?.material as SpriteMaterial;
    const pool = poolsOf(lamps)[0]?.material as MeshBasicMaterial;
    const geometry = poolsOf(lamps)[0]?.geometry as PlaneGeometry;
    const released: string[] = [];
    halo.addEventListener("dispose", () => released.push("halo"));
    pool.addEventListener("dispose", () => released.push("pool"));
    geometry.addEventListener("dispose", () => released.push("plane"));
    texture.addEventListener("dispose", () => released.push("texture"));
    lamps.dispose();
    expect(released.sort()).toEqual(["halo", "plane", "pool"]);
    expect(lamps.group.parent).toBeNull();
    expect(root.children).toHaveLength(0);
  });

  it("reaches a lamp's halo a little past its globe and its pool across the kerb and the lane", () => {
    expect(LAMP_REACH.halo).toBeGreaterThan(0.5);
    expect(LAMP_REACH.halo).toBeLessThan(LAMP_REACH.pool);
    expect(LAMP_REACH.pool).toBeLessThan(5);
  });
});
