import { describe, expect, it } from "vitest";
import { RetryCancelled, withBackoff } from "../src/net/retry.ts";

const instantSleep = (log: number[]) => async (ms: number) => {
  log.push(ms);
};

describe("withBackoff", () => {
  it("returns the first success without sleeping", async () => {
    const slept: number[] = [];
    const result = await withBackoff(async () => "ok", { delaysMs: [10, 20], sleep: instantSleep(slept) });
    expect(result).toBe("ok");
    expect(slept).toEqual([]);
  });

  it("retries with the configured delays until it succeeds", async () => {
    const slept: number[] = [];
    const retries: number[] = [];
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("down");
        return calls;
      },
      { delaysMs: [10, 20, 40], sleep: instantSleep(slept), onRetry: (failures) => retries.push(failures) },
    );
    expect(result).toBe(3);
    expect(slept).toEqual([10, 20]);
    expect(retries).toEqual([1, 2]);
  });

  it("throws the last error once the delays are used up", async () => {
    const slept: number[] = [];
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error(`failure ${calls}`);
        },
        { delaysMs: [1, 2], sleep: instantSleep(slept) },
      ),
    ).rejects.toThrow("failure 3");
    expect(calls).toBe(3);
    expect(slept).toEqual([1, 2]);
  });

  it("does not retry errors the caller rules out", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error("fatal");
        },
        { delaysMs: [1, 2], shouldRetry: () => false, sleep: async () => undefined },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("stops with RetryCancelled when the caller gives up between attempts", async () => {
    let cancelled = false;
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error("down");
        },
        {
          delaysMs: [1, 2, 3],
          isCancelled: () => cancelled,
          sleep: async () => {
            cancelled = true;
          },
        },
      ),
    ).rejects.toBeInstanceOf(RetryCancelled);
    expect(calls).toBe(1);
  });
});
