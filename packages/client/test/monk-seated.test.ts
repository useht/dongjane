import { readFileSync } from "node:fs";
import { type Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { BENCH_HIPS_BACK, BOW_MS, SEAT_POSES, SEAT_TOPS, type SeatPose } from "@dongjane/shared";
import { extractMonkParts, monkRig } from "../src/game/monk-assets.ts";
import { MonkAvatar, type PartName } from "../src/game/monk-model.ts";

function nodeOf(avatar: MonkAvatar, part: PartName, copy = 0): Object3D {
  const binding = avatar.bindings.find((b) => b.part === part && b.copy === copy);
  if (!binding) throw new Error(`no ${part} binding ${copy}`);
  return binding.node;
}

function positionOf(node: Object3D): Vector3 {
  return new Vector3().setFromMatrixPosition(node.matrixWorld);
}

// A monk who has been seated for a while, facing -z at the origin, with reduced motion so the pose is exact and steady.
function seated(pose: SeatPose, top: number, mode = "kneel", nowMs = 5000): MonkAvatar {
  const avatar = new MonkAvatar("sitter", 0, false);
  avatar.seatPose = pose;
  avatar.seatTop = top;
  avatar.setMode(mode, 0);
  avatar.place(0, 0, 0);
  avatar.animate(0.016, nowMs, 0, true);
  return avatar;
}

const hipsOf = (avatar: MonkAvatar): Vector3 => positionOf(nodeOf(avatar, "torso"));
const footOf = (avatar: MonkAvatar, side: number): Vector3 => positionOf(nodeOf(avatar, "foot", side));

describe("the seated poses", () => {
  it("draws the kneeling monk in the 정좌: lifted by the 방석, the hips on the heels and the feet folded under, the right foot over the left", () => {
    const avatar = seated("kneel", monkRig.seatTop);
    expect(avatar.root.position.y).toBeCloseTo(monkRig.seatTop, 6);
    expect(hipsOf(avatar).y).toBeCloseTo(monkRig.seatTop + monkRig.hipKneel, 6);
    expect(hipsOf(avatar).z).toBeCloseTo(0, 6);
    for (const side of [0, 1]) {
      const foot = footOf(avatar, side);
      const over = side === 1 ? 1 : 0;
      expect(foot.z, `foot ${side} folds behind`).toBeCloseTo(monkRig.footKneelZ + monkRig.footOverShift * over, 6);
      expect(foot.y, `foot ${side} on the 방석`).toBeCloseTo(monkRig.seatTop + monkRig.footKneelY + monkRig.footOverLift * over, 6);
    }
    expect(nodeOf(avatar, "pelvis").scale.y).toBeCloseTo(monkRig.kneelPelvisScaleY, 6);
  });

  describe("on a bench", () => {
    const top = SEAT_TOPS.church;
    const avatar = seated("bench", top);
    const hips = hipsOf(avatar);
    const squash = nodeOf(avatar, "pelvis").scale.y;

    it("keeps the monk on the floor and puts the hips on the seat, behind the spot", () => {
      expect(avatar.root.position.y).toBe(0);
      expect(squash).toBeLessThan(1);
      expect(hips.y).toBeGreaterThan(top + monkRig.pelvisDrop * squash);
      expect(hips.y).toBeLessThan(monkRig.hipStand);
      expect(hips.z).toBeCloseTo(BENCH_HIPS_BACK, 6);
    });

    it("rests the seat of the trousers on the seat without sinking into it", () => {
      const underSeat = hips.y - monkRig.pelvisDrop * squash;
      expect(underSeat - top).toBeGreaterThanOrEqual(0);
      expect(underSeat - top).toBeLessThan(0.02);
    });

    it("stands both feet on the floor in front of the hips, with the legs about as long as they are", () => {
      for (const side of [0, 1]) {
        const foot = footOf(avatar, side);
        expect(foot.y, `foot ${side} on the floor`).toBeCloseTo(monkRig.footY, 6);
        expect(hips.z - foot.z, `foot ${side} in front of the hips`).toBeGreaterThan(0.25);
        expect(foot.z, `foot ${side} in front of the spot`).toBeLessThan(0);
        expect(Math.abs(nodeOf(avatar, "leg", side).scale.y - 1), `leg ${side} length`).toBeLessThan(0.15);
      }
    });

    it("sits at the height of whichever seat the monk is on", () => {
      const log = seated("bench", SEAT_TOPS.bonfire);
      expect(hipsOf(log).y - hips.y).toBeCloseTo(SEAT_TOPS.bonfire - top, 6);
      expect(log.root.position.y).toBe(0);
    });

    it("only leans from the waist when it bows", () => {
      const deepest = 0.45 * BOW_MS;
      const bench = seated("bench", top, "bow", deepest);
      const knees = seated("kneel", top, "bow", deepest);
      const lean = Math.abs(nodeOf(bench, "torso").rotation.x);
      expect(lean).toBeGreaterThan(0.3);
      expect(lean).toBeLessThan(Math.abs(nodeOf(knees, "torso").rotation.x) / 2);
    });
  });

  describe("cross-legged on a mat", () => {
    const top = SEAT_TOPS.bathhouse;
    const avatar = seated("cross", top);

    it("lifts the monk by the mat and seats the trousers on it, not on heels that are not there", () => {
      expect(avatar.root.position.y).toBeCloseTo(top, 6);
      expect(nodeOf(avatar, "pelvis").scale.y).toBeCloseTo(monkRig.kneelPelvisScaleY, 6);
      const underSeat = hipsOf(avatar).y - monkRig.pelvisDrop * monkRig.kneelPelvisScaleY - top;
      expect(underSeat).toBeGreaterThanOrEqual(0);
      expect(underSeat).toBeLessThan(0.02);
    });

    it("lays the feet in front, at the height of the mat, crossed over to the other side", () => {
      const left = footOf(avatar, 0);
      const right = footOf(avatar, 1);
      for (const foot of [left, right]) {
        expect(foot.z, "in front of the hips").toBeLessThan(-0.05);
        expect(foot.y - top, "on the mat").toBeGreaterThanOrEqual(0);
        expect(foot.y - top, "on the mat").toBeLessThan(0.08);
      }
      expect(left.x, "the left foot has crossed to the right").toBeGreaterThan(0);
      expect(right.x, "the right foot has crossed to the left").toBeLessThan(0);
    });

    it("reaches each foot with a leg that is shorter than a standing one", () => {
      for (const side of [0, 1]) {
        const leg = nodeOf(avatar, "leg", side);
        expect(leg.scale.y).toBeGreaterThan(0.3);
        expect(leg.scale.y).toBeLessThan(0.8);
      }
    });
  });

  it("keeps the hem of the jacket and the seat of the trousers off the seat, whichever way the monk sits", async () => {
    const file = readFileSync(new URL("../assets/monk/monk.glb", import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, "");
    const parts = extractMonkParts(gltf.scene);
    const lowest = (avatar: MonkAvatar, part: "skirt" | "pelvis"): number => {
      const position = parts[part].getAttribute("position");
      let low = Infinity;
      for (let i = 0; i < position.count; i += 1) {
        low = Math.min(low, new Vector3().fromBufferAttribute(position as never, i).applyMatrix4(nodeOf(avatar, part).matrixWorld).y);
      }
      return low;
    };
    const sittings: [SeatPose, number][] = [["kneel", monkRig.seatTop], ["cross", SEAT_TOPS.bathhouse], ["bench", SEAT_TOPS.church], ["bench", SEAT_TOPS.bonfire]];
    for (const [pose, top] of sittings) {
      for (const mode of ["kneel", "bow"]) {
        const avatar = seated(pose, top, mode, mode === "bow" ? BOW_MS * 0.45 : 5000);
        expect(lowest(avatar, "skirt") - top, `the skirt of a monk sitting ${pose} on ${top} (${mode}) stays above the seat`).toBeGreaterThanOrEqual(0.005);
        expect(lowest(avatar, "pelvis") - top, `the trousers of a monk sitting ${pose} on ${top} (${mode}) stay above the seat`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("changes nothing for a monk afoot, whichever seat it last passed", () => {
    const poses: SeatPose[] = ["kneel", "cross", "bench"];
    const [first, ...others] = poses.map((pose) => seated(pose, 0.3, "stand"));
    for (const other of others) {
      expect(hipsOf(other).toArray()).toEqual(hipsOf(first as MonkAvatar).toArray());
      expect(footOf(other, 0).toArray()).toEqual(footOf(first as MonkAvatar, 0).toArray());
      expect(positionOf(nodeOf(other, "leg")).toArray()).toEqual(positionOf(nodeOf(first as MonkAvatar, "leg")).toArray());
    }
    expect(hipsOf(first as MonkAvatar).y).toBeCloseTo(monkRig.hipStand, 6);
    expect((first as MonkAvatar).root.position.y).toBe(0);
  });

  it("is told its pose by the zone it stands in", () => {
    expect(SEAT_POSES.church).toBe("bench");
    expect(SEAT_POSES.bonfire).toBe("bench");
    expect(SEAT_POSES.bathhouse).toBe("cross");
    expect(SEAT_POSES.dharma).toBe("kneel");
    expect(SEAT_POSES.gatbawi).toBe("kneel");
  });
});
