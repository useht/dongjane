import { type BufferGeometry, BoxGeometry, CylinderGeometry, SphereGeometry } from "three";
import { THEME } from "../theme.ts";
import { GeometryBuilder } from "./geometry.ts";
import type { ItemPartName } from "./monk-model.ts";

const WOOD = THEME.scene.moktWood;
const WOOD_DARK = THEME.scene.moktWoodDark;
const BEAD = THEME.scene.prayerBead;
const BEAD_MARK = THEME.scene.prayerBeadMark;
const BEAD_COUNT = 11;

// The things a monk holds. They are small props attached to the hand, so they are built here and not baked into monk.glb.
export function buildItemGeometries(): Record<ItemPartName, BufferGeometry> {
  const mokt = new GeometryBuilder()
    .add(new SphereGeometry(0.064, 14, 10), WOOD, { y: -0.078, sx: 1, sy: 0.82, sz: 1.12 })
    .add(new BoxGeometry(0.09, 0.012, 0.014), WOOD_DARK, { y: -0.07, z: 0.068 })
    .add(new BoxGeometry(0.09, 0.012, 0.014), WOOD_DARK, { y: -0.07, z: -0.068 })
    .add(new CylinderGeometry(0.011, 0.014, 0.05, 6), WOOD, { y: -0.012, z: 0.02, rx: 0.4 })
    .build();

  const beadRing = new GeometryBuilder();
  for (let i = 0; i < BEAD_COUNT; i += 1) {
    const angle = (i / BEAD_COUNT) * Math.PI * 2;
    beadRing.add(new SphereGeometry(i === 0 ? 0.024 : 0.018, 7, 5), i === 0 ? BEAD_MARK : BEAD, {
      x: Math.cos(angle) * 0.055,
      y: Math.sin(angle) * 0.055,
    });
  }

  return { mokt, beads: beadRing.build() };
}
