import { readFileSync } from "node:fs";
import { Euler, Object3D, ShaderLib, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { BOW_MS } from "@dongjane/shared";
import { extractMonkParts, monkRig } from "../src/game/monk-assets.ts";
import { BEND_FORWARD, BEND_LENGTH, bendFrame, bendNormal, bendPoint, bendVertexShader } from "../src/game/monk-bend.ts";
import { MonkAvatar } from "../src/game/monk-model.ts";

// monk-bend-samples.json, written by build_monk.py: where its bend_vertex puts a dozen vertices of the upright jacket, with their
// shading normals, at each depth of the bow and each gather. Axes are three.js's, positions in the waist frame.
type Sample = { position: number[]; normal: number[] };
type Samples = {
  bendLength: number;
  bendForward: number;
  bowLean: number;
  gathers: number[];
  depths: number[];
  rest: Sample[];
  posed: Record<string, Sample[]>;
};

const samples = JSON.parse(readFileSync(new URL("../assets/monk/monk-bend-samples.json", import.meta.url), "utf8")) as Samples;
const TOLERANCE = 1e-4;

function vector(values: number[]): Vector3 {
  return new Vector3(values[0], values[1], values[2]);
}

function key(gather: number, depth: number): string {
  return `gather ${gather.toFixed(2)} depth ${depth.toFixed(2)}`;
}

async function jacketGeometry() {
  const file = readFileSync(new URL("../assets/monk/monk.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, "");
  return extractMonkParts(gltf.scene).jacket;
}

describe("the jacket's bend", () => {
  it("puts every sampled vertex where build_monk.py puts it, at every depth and gather", () => {
    expect(samples.rest.length, "the samples cover the jacket from the hem to the collar").toBeGreaterThanOrEqual(12);
    for (const gather of samples.gathers) {
      for (const depth of samples.depths) {
        const want = samples.posed[key(gather, depth)] as Sample[];
        expect(want, key(gather, depth)).toHaveLength(samples.rest.length);
        for (const [i, rest] of samples.rest.entries()) {
          const theta = samples.bowLean * depth;
          const point = bendPoint(vector(rest.position), theta, gather, new Vector3());
          const normal = bendNormal(vector(rest.position), vector(rest.normal), theta, gather, new Vector3());
          const label = `${key(gather, depth)}, vertex ${i}`;
          expect(point.distanceTo(vector((want[i] as Sample).position)), `${label}: position`).toBeLessThan(TOLERANCE);
          expect(normal.distanceTo(vector((want[i] as Sample).normal)), `${label}: normal`).toBeLessThan(TOLERANCE);
        }
      }
    }
  });

  it("leaves the standing jacket as it is and gathers only what hangs below the waist", () => {
    const below = new Vector3(0.05, -0.2, -0.1);
    const above = new Vector3(0.05, 0.1, -0.1);
    expect(bendPoint(below, 0, 1, new Vector3()).distanceTo(below)).toBeLessThan(1e-9);
    expect(bendPoint(below, 0, 0.8, new Vector3()).y).toBeCloseTo(-0.16, 9);
    expect(bendPoint(above, 0, 0.8, new Vector3()).distanceTo(above), "above the waist nothing is gathered").toBeLessThan(1e-9);
    const base = new Vector3(0.05, -BEND_LENGTH - 0.05, -0.1);
    expect(bendPoint(base, 1.54, 1, new Vector3()).distanceTo(base), "below the base of the bend nothing moves").toBeLessThan(1e-9);
  });

  it("is rigid above the hinge: the bent point is the point carried by the frame the head and shoulders ride", () => {
    for (const theta of [0.3, 0.8, 1.54]) {
      const frame = new Object3D();
      bendFrame(theta, frame.position);
      frame.rotation.copy(new Euler(-theta, 0, 0));
      frame.updateMatrix();
      for (const point of [new Vector3(0, 0, 0), new Vector3(0.07, 0.1, 0.12), new Vector3(-0.1, 0.175, -0.15)]) {
        const carried = point.clone().applyMatrix4(frame.matrix);
        expect(bendPoint(point, theta, 1, new Vector3()).distanceTo(carried), `theta ${theta} at ${point.toArray()}`).toBeLessThan(1e-9);
        expect(bendPoint(point, theta, 0.86, new Vector3()).distanceTo(carried), `gathered, theta ${theta} at ${point.toArray()}`).toBeLessThan(1e-9);
      }
    }
  });

  it("is the frame the avatar puts the chest in", () => {
    const avatar = new MonkAvatar("bower", 0, false);
    avatar.setMode("bow", 0);
    avatar.animate(0.016, BOW_MS * 0.32, 0, true);
    expect(avatar.bend.theta).toBeCloseTo(samples.bowLean, 9);
    expect(avatar.torsoNode.rotation.x).toBeCloseTo(-samples.bowLean, 9);
    expect(avatar.torsoNode.position.distanceTo(bendFrame(samples.bowLean, new Vector3()))).toBeLessThan(1e-9);
  });

  it("is checked against samples of this rig and this jacket, so a changed script or model fails until the samples are rebuilt", async () => {
    expect(samples.bendLength).toBe(monkRig.bendLength);
    expect(samples.bendForward).toBe(monkRig.bendForward);
    expect(BEND_LENGTH).toBe(monkRig.bendLength);
    expect(BEND_FORWARD).toBe(monkRig.bendForward);
    expect(samples.bowLean).toBe(monkRig.bowLean);

    // The gathers the client uses: kneeling, and sitting on a bench (which the avatar owns).
    const gathers = (seatPose: "kneel" | "bench"): number => {
      const avatar = new MonkAvatar("sitter", 0, false);
      avatar.seatPose = seatPose;
      avatar.seatTop = 0.3;
      avatar.setMode("bow", 0);
      avatar.animate(0.016, 5000, 0, true);
      return avatar.bend.gather;
    };
    for (const gather of [1, gathers("kneel"), gathers("bench")]) {
      expect(samples.gathers.some((g) => Math.abs(g - gather) < 1e-9), `the samples include the gather ${gather}`).toBe(true);
    }
    expect(gathers("kneel")).toBeCloseTo(monkRig.kneelSkirtScale, 9);

    // Every sampled rest vertex is a vertex of the jacket in the shipped model, normal and all.
    const jacket = await jacketGeometry();
    const position = jacket.getAttribute("position");
    const normal = jacket.getAttribute("normal");
    for (const [i, rest] of samples.rest.entries()) {
      let nearest = Infinity;
      for (let v = 0; v < position.count; v += 1) {
        const point = new Vector3().fromBufferAttribute(position as never, v);
        if (point.distanceTo(vector(rest.position)) > 1e-4) continue;
        const direction = new Vector3().fromBufferAttribute(normal as never, v);
        nearest = Math.min(nearest, direction.distanceTo(vector(rest.normal)));
      }
      expect(nearest, `sample ${i} is a vertex of the jacket in monk.glb`).toBeLessThan(2e-3);
    }
  });

  it("patches the shaders three.js really draws with: the lit one for points and normals, the shadow one for points", () => {
    const lit = bendVertexShader(ShaderLib.lambert.vertexShader, true);
    const shadow = bendVertexShader(ShaderLib.depth.vertexShader, false);
    for (const [shader, name] of [[lit, "lit"], [shadow, "depth"]] as const) {
      expect(shader, `${name}: declares the per-instance bend`).toContain("attribute vec2 instanceBend;");
      expect(shader.indexOf("vec3 bendPoint"), `${name}: the functions come before main`).toBeLessThan(shader.indexOf("void main()"));
      const begin = shader.indexOf("#include <begin_vertex>");
      const moved = shader.indexOf("transformed = bendPoint( transformed, instanceBend.x, instanceBend.y );");
      expect(moved, `${name}: bends the point right after it is set`).toBe(shader.indexOf("\n", begin) + 1);
      expect(shader.indexOf("#include <project_vertex>"), `${name}: before it is projected`).toBeGreaterThan(moved);
    }
    const normalAt = lit.indexOf("objectNormal = bendNormal( position, objectNormal, instanceBend.x, instanceBend.y );");
    expect(normalAt, "the lit shader bends the normal right after it is set").toBe(lit.indexOf("\n", lit.indexOf("#include <beginnormal_vertex>")) + 1);
    expect(lit.indexOf("#include <defaultnormal_vertex>"), "and before it is transformed").toBeGreaterThan(normalAt);
    expect(shadow, "the shadow pass has no normal to bend").not.toContain("objectNormal = bendNormal");
    expect(() => bendVertexShader("void main() {}", false)).toThrow(/common/);
  });
});
