import {
  AdditiveBlending,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Texture,
  BoxGeometry,
} from "three";
import { GeometryBuilder } from "./geometry.ts";
import { flameGlowTexture } from "./textures.ts";

const GOLD = 0xe2b441;
const GOLD_DEEP = 0xb98427;
const GOLD_PALE = 0xf3d77f;
const PINK = 0xf0a6b8;
const PINK_DEEP = 0xd9728f;

function profile(points: ReadonlyArray<readonly [number, number]>): Vector2[] {
  return points.map(([r, y]) => new Vector2(r, y));
}

function buildFigure(): BufferGeometry {
  const b = new GeometryBuilder();

  b.add(
    new LatheGeometry(
      profile([
        [0.001, 0],
        [1.0, 0.0],
        [1.12, 0.12],
        [1.0, 0.3],
        [0.78, 0.46],
        [0.6, 0.62],
        [0.56, 0.95],
        [0.62, 1.3],
        [0.7, 1.55],
        [0.52, 1.8],
        [0.2, 1.93],
        [0.001, 1.96],
      ]),
      40,
    ),
    GOLD,
    { sz: 0.78 },
  );

  b.add(new TorusGeometry(0.86, 0.09, 10, 36), GOLD_DEEP, { y: 0.3, rx: Math.PI / 2, sy: 0.9 });
  b.add(new SphereGeometry(0.4, 28, 20), GOLD_PALE, { y: 2.3 });
  b.add(new SphereGeometry(0.17, 16, 12), GOLD_PALE, { y: 2.66, sy: 0.9 });
  b.add(new SphereGeometry(0.045, 8, 6), 0xd23a3a, { y: 2.72, z: 0.05 });

  const curls = 46;
  for (let i = 0; i < curls; i += 1) {
    const ring = i % 3;
    const around = (i / curls) * Math.PI * 2 * 3;
    const lift = 0.4 + ring * 0.2;
    const radius = 0.4 * Math.cos(lift * 0.9) + 0.01;
    b.add(new SphereGeometry(0.052, 6, 5), 0x3c4a8a, {
      x: Math.sin(around) * radius,
      y: 2.3 + Math.sin(lift) * 0.4,
      z: Math.cos(around) * radius * 0.92,
    });
  }

  for (const side of [-1, 1]) {
    b.add(new CapsuleGeometry(0.06, 0.34, 4, 8), GOLD_PALE, { x: side * 0.41, y: 2.2, rz: side * 0.12 });
    b.add(new BoxGeometry(0.1, 0.018, 0.02), 0x3a2418, { x: side * 0.14, y: 2.36, z: 0.37, rz: -side * 0.16 });
    b.add(new SphereGeometry(0.05, 8, 6), 0xf0948a, { x: side * 0.2, y: 2.2, z: 0.33, sz: 0.35 });
    b.add(new CapsuleGeometry(0.16, 0.8, 4, 10), GOLD, { x: side * 0.72, y: 1.5, z: 0.08, rz: side * 0.28 });
    b.add(new CapsuleGeometry(0.13, 0.62, 4, 10), GOLD, { x: side * 0.5, y: 0.94, z: 0.5, rx: -1.15, rz: side * 0.5 });
  }
  b.add(new BoxGeometry(0.03, 0.05, 0.02), 0x8a4a2a, { y: 2.2, z: 0.39 });
  b.add(new TorusGeometry(0.035, 0.007, 5, 10, Math.PI), 0x9a4a3c, { y: 2.1, z: 0.385, rz: Math.PI });

  b.add(new SphereGeometry(0.2, 14, 10), GOLD_PALE, { y: 0.78, z: 0.62, sy: 0.55, sx: 1.5 });
  b.add(new BoxGeometry(1.5, 0.05, 0.05), 0xc13b2e, { y: 1.52, z: 0.4, rz: -0.55 });
  return b.build();
}

function buildLotus(): BufferGeometry {
  const b = new GeometryBuilder();
  const petals = 18;
  for (let ring = 0; ring < 2; ring += 1) {
    const count = petals + ring * 6;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + ring * 0.2;
      const radius = 1.18 + ring * 0.22;
      b.add(new SphereGeometry(0.2, 8, 6), ring === 0 ? PINK : PINK_DEEP, {
        x: Math.sin(angle) * radius,
        y: -0.06 - ring * 0.12,
        z: Math.cos(angle) * radius * 0.78,
        sx: 0.55,
        sy: 0.45,
        sz: 1.3,
        ry: angle,
        rx: -0.35,
      });
    }
  }
  b.add(new CylinderGeometry(1.05, 1.3, 0.3, 32), GOLD_DEEP, { y: -0.3, sz: 0.8 });
  return b.build();
}

function buildHalo(): BufferGeometry {
  const b = new GeometryBuilder();
  b.add(new TorusGeometry(1.62, 0.06, 8, 56), GOLD, { y: 2.45, z: -0.55 });
  b.add(new TorusGeometry(1.2, 0.04, 8, 48), GOLD_PALE, { y: 2.45, z: -0.55 });
  b.add(new TorusGeometry(0.86, 0.035, 8, 40), GOLD_DEEP, { y: 2.45, z: -0.55 });
  const rays = 36;
  for (let i = 0; i < rays; i += 1) {
    const angle = (i / rays) * Math.PI * 2;
    const long = i % 2 === 0;
    const length = long ? 0.5 : 0.3;
    const radius = 1.62 + length / 2;
    b.add(new ConeGeometry(0.05, length, 5), long ? GOLD : GOLD_PALE, {
      x: Math.sin(angle) * radius,
      y: 2.45 + Math.cos(angle) * radius,
      z: -0.55,
      rz: -angle,
    });
  }
  return b.build();
}

export interface BuddhaPieces {
  group: Group;
  glow: Mesh;
  dispose(): void;
}

export function buildBuddha(envMap: Texture | null): BuddhaPieces {
  const group = new Group();
  group.name = "buddha";

  const gold = new MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.62,
    roughness: 0.36,
    emissive: 0x4a2a00,
    emissiveIntensity: 0.55,
    envMap,
    envMapIntensity: 1.1,
  });
  const lotusMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, emissive: 0x3a1020, emissiveIntensity: 0.25 });

  const figure = new Mesh(buildFigure(), gold);
  const lotus = new Mesh(buildLotus(), lotusMaterial);
  const halo = new Mesh(buildHalo(), gold);
  for (const mesh of [figure, lotus, halo]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  lotus.position.y = 0;
  figure.position.y = 0.05;

  const glowTexture = flameGlowTexture();
  const glowMaterial = new MeshBasicMaterial({
    map: glowTexture,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const glow = new Mesh(new CircleGeometry(2.3, 40), glowMaterial);
  glow.position.set(0, 2.45, -0.62);
  group.add(glow);

  return {
    group,
    glow,
    dispose(): void {
      for (const mesh of [figure, lotus, halo, glow]) mesh.geometry.dispose();
      gold.dispose();
      lotusMaterial.dispose();
      glowMaterial.dispose();
      glowTexture.dispose();
    },
  };
}
