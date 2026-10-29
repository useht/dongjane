import { describe, expect, it } from "vitest";
import { type Sample, SnapshotBuffer } from "../src/game/snapshot.ts";

const out = (): Sample => ({ x: 0, z: 0, yaw: 0 });

describe("SnapshotBuffer", () => {
  it("returns false until a snapshot exists", () => {
    expect(new SnapshotBuffer().sample(100, out())).toBe(false);
  });

  it("interpolates linearly between two snapshots", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0);
    buffer.push(1050, 1, -2, 0);
    const sample = out();
    buffer.sample(1025, sample);
    expect(sample.x).toBeCloseTo(0.5);
    expect(sample.z).toBeCloseTo(-1);
  });

  it("holds the newest snapshot instead of extrapolating", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0);
    buffer.push(1050, 1, 1, 0.4);
    const sample = out();
    buffer.sample(5000, sample);
    expect(sample).toEqual({ x: 1, z: 1, yaw: 0.4 });
  });

  it("clamps to the oldest snapshot when asked for the past", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 3, 4, 0);
    buffer.push(1050, 5, 6, 0);
    const sample = out();
    buffer.sample(10, sample);
    expect(sample.x).toBe(3);
    expect(sample.z).toBe(4);
  });

  it("interpolates yaw along the short arc across the wrap point", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, 0, 0, Math.PI - 0.1);
    buffer.push(100, 0, 0, -Math.PI + 0.1);
    const sample = out();
    buffer.sample(50, sample);
    expect(Math.abs(Math.abs(sample.yaw) - Math.PI)).toBeLessThan(1e-6);
  });

  it("overwrites a snapshot with a duplicate or older timestamp", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(100, 0, 0, 0);
    buffer.push(100, 9, 9, 0);
    buffer.push(90, 7, 7, 0);
    expect(buffer.length).toBe(1);
    const sample = out();
    buffer.sample(100, sample);
    expect(sample.x).toBe(7);
  });

  it("discards snapshots that are already in the past and caps its size", () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 200; i += 1) buffer.push(i * 50, i, 0, 0);
    expect(buffer.length).toBeLessThanOrEqual(40);
    const sample = out();
    buffer.sample(199 * 50 - 25, sample);
    expect(sample.x).toBeCloseTo(198.5);
    expect(buffer.length).toBeLessThanOrEqual(3);
  });
});
