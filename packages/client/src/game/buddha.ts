import { AdditiveBlending, type BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Texture, Vector3 } from "three";
import type { ModelMeshes } from "../assets/registry.ts";
import { THEME } from "../theme.ts";

export interface BuddhaPieces {
  group: Group;
  glow: Mesh;
  dispose(): void;
}

// The glow breathes by scale, so it needs its own origin at the middle of the disc.
function centredGlow(source: Mesh): { geometry: BufferGeometry; centre: Vector3 } {
  const geometry = source.geometry.clone();
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
  geometry.translate(-centre.x, -centre.y, -centre.z);
  return { geometry, centre };
}

export function buildBuddha(meshes: ModelMeshes<"buddha">, envMap: Texture | null): BuddhaPieces {
  const { scene } = THEME;
  const group = new Group();
  group.name = "buddha";

  const gold = new MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.62,
    roughness: 0.36,
    emissive: scene.goldGlow,
    emissiveIntensity: 0.55,
    envMap,
    envMapIntensity: 1.1,
  });
  const lotusMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, emissive: scene.lotusGlow, emissiveIntensity: 0.25 });

  for (const [source, material] of [
    [meshes.figure, gold],
    [meshes.lotus, lotusMaterial],
    [meshes.halo, gold],
  ] as const) {
    const mesh = new Mesh(source.geometry, material);
    mesh.name = source.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const { geometry: glowGeometry, centre } = centredGlow(meshes.glow);
  const glowMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const glow = new Mesh(glowGeometry, glowMaterial);
  glow.name = meshes.glow.name;
  glow.position.copy(centre);
  group.add(glow);

  return {
    group,
    glow,
    dispose(): void {
      gold.dispose();
      lotusMaterial.dispose();
      glowMaterial.dispose();
      glowGeometry.dispose();
      group.removeFromParent();
    },
  };
}
