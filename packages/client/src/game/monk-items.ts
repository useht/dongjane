import { type BufferGeometry, BoxGeometry, CylinderGeometry, Euler, Quaternion, SphereGeometry, Vector3 } from "three";
import { THEME } from "../theme.ts";
import { GeometryBuilder } from "./geometry.ts";
import type { ItemPartName } from "./monk-model.ts";

const WOOD = THEME.scene.moktWood;
const WOOD_DARK = THEME.scene.moktWoodDark;
const BEAD = THEME.scene.prayerBead;
const BEAD_MARK = THEME.scene.prayerBeadMark;
const CANE = THEME.scene.rodCane;
const BOBBER_RED = THEME.scene.bobberRed;
const WHITE = THEME.scene.white;
const BEAD_COUNT = 11;

// How a monk fishing holds the rod, in the angles MonkAvatar.animate gives the arms: the lead hand (the one the rod is built on)
// grips it, the rear hand steadies the butt, and both roll in toward the middle of the chest.
export const ROD_POSE = {
  lean: 0.06,
  roll: 0.3,
  lead: { shoulder: 0.9, elbow: 0.9 },
  rear: { shoulder: 0.35, elbow: 1.05 },
  elevation: 0.8,
} as const;

const ROD_GRIP_Y = -0.04;
const ROD_BUTT = 0.2;
const ROD_GRIP_END = 0.12;
const ROD_REACH = 1.2;
// Carried at the side, the rod stands in the hand and leans forward by this much.
const ROD_CARRY_TILT = -0.7;
const UP = new Vector3(0, 1, 0);

// The rod is modelled standing up from its grip (+y, tip last) and turned as a whole: `aim` turns it to rise toward the sea at
// ROD_POSE.elevation when fished (in the hand's own frame it points down the forearm and a little away from the palm; the frame is
// found by running the pose's rotations backwards), `carry` leans it forward while the monk walks or stands with it.
function rodLayout(): { axis: Vector3; aim: Quaternion; carry: Quaternion; grip: Vector3; tip: Vector3; reach: number } {
  const lead = ROD_POSE.lead;
  const hand = new Quaternion()
    .setFromEuler(new Euler(ROD_POSE.lean + lead.shoulder, 0, ROD_POSE.roll))
    .multiply(new Quaternion().setFromEuler(new Euler(lead.elbow, 0, 0)));
  const axis = new Vector3(0, Math.sin(ROD_POSE.elevation), -Math.cos(ROD_POSE.elevation)).applyQuaternion(hand.invert());
  const grip = new Vector3(0, ROD_GRIP_Y, 0);
  return {
    axis,
    aim: new Quaternion().setFromUnitVectors(UP, axis),
    carry: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), ROD_CARRY_TILT),
    grip,
    tip: grip.clone().addScaledVector(axis, ROD_REACH),
    reach: ROD_REACH,
  };
}

export const ROD = rodLayout();

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

  const rod = new GeometryBuilder()
    .add(new CylinderGeometry(0.016, 0.019, ROD_BUTT + ROD_GRIP_END, 6), WOOD_DARK, { y: (ROD_GRIP_END - ROD_BUTT) / 2 })
    .add(new SphereGeometry(0.021, 8, 6), WOOD_DARK, { y: -ROD_BUTT })
    .add(new CylinderGeometry(0.004, 0.012, ROD_REACH - ROD_GRIP_END, 6), CANE, { y: (ROD_GRIP_END + ROD_REACH) / 2 })
    .build();

  // Unit length along y; MonkAvatar stretches it between the rod tip and the float.
  const fishLine = new GeometryBuilder().add(new CylinderGeometry(0.007, 0.007, 1, 4), WHITE).build();

  const bobber = new GeometryBuilder()
    .add(new SphereGeometry(0.05, 10, 8), BOBBER_RED, { y: -0.012 })
    .add(new SphereGeometry(0.034, 8, 6), WHITE, { y: 0.04 })
    .add(new CylinderGeometry(0.006, 0.006, 0.07, 4), WHITE, { y: 0.1 })
    .build();

  return { mokt, beads: beadRing.build(), rod, fishLine, bobber };
}
