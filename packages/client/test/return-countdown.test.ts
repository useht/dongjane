import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnCountdown } from "../src/net/return-countdown.ts";

const T0 = 1_800_000_000_000;

function open() {
  const onTick = vi.fn<(secondsLeft: number) => void>();
  const onDone = vi.fn<() => void>();
  return { countdown: new ReturnCountdown(onTick, onDone), onTick, onDone };
}

describe("ReturnCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks once a second from the start value and finishes exactly once", () => {
    const { countdown, onTick, onDone } = open();
    countdown.start(10);
    expect(countdown.running).toBe(true);
    expect(onTick.mock.calls.map(([seconds]) => seconds)).toEqual([10]);

    vi.advanceTimersByTime(9_000);
    expect(onTick.mock.calls.map(([seconds]) => seconds)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(onDone).not.toHaveBeenCalled();
    expect(countdown.running).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledTimes(10);
    expect(countdown.running).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledTimes(10);
  });

  it("stops without finishing when cancelled", () => {
    const { countdown, onTick, onDone } = open();
    countdown.start(10);
    vi.advanceTimersByTime(3_000);
    countdown.cancel();
    expect(countdown.running).toBe(false);

    const ticks = onTick.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledTimes(ticks);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("ignores cancel when nothing is running", () => {
    const { countdown, onTick, onDone } = open();
    countdown.cancel();
    expect(countdown.running).toBe(false);
    expect(onTick).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("restarts from the new value when started again", () => {
    const { countdown, onTick, onDone } = open();
    countdown.start(10);
    vi.advanceTimersByTime(4_000);
    onTick.mockClear();

    countdown.start(3);
    expect(onTick.mock.calls.map(([seconds]) => seconds)).toEqual([3]);

    vi.advanceTimersByTime(2_000);
    expect(onTick.mock.calls.map(([seconds]) => seconds)).toEqual([3, 2, 1]);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("can run again after finishing", () => {
    const { countdown, onDone } = open();
    countdown.start(2);
    vi.advanceTimersByTime(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);

    countdown.start(2);
    expect(countdown.running).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("finishes on a late tick, as a throttled background tab would deliver it", () => {
    const { countdown, onTick, onDone } = open();
    countdown.start(10);
    onTick.mockClear();

    vi.setSystemTime(T0 + 25_000);
    vi.advanceTimersByTime(1_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onTick).not.toHaveBeenCalled();
    expect(countdown.running).toBe(false);
  });

  it("reports the time left from the clock, not from the tick count", () => {
    const { countdown, onTick } = open();
    countdown.start(10);
    onTick.mockClear();

    vi.setSystemTime(T0 + 6_000);
    vi.advanceTimersByTime(1_000);
    expect(onTick.mock.calls.map(([seconds]) => seconds)).toEqual([3]);
  });
});
