import { describe, expect, it, vi } from "vitest";
import { ScreenHold } from "../src/audio/screen-hold.ts";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

interface FakeScreenLock {
  released: boolean;
  release: ReturnType<typeof vi.fn>;
}

function fakeScreenLock(): FakeScreenLock {
  const lock: FakeScreenLock = {
    released: false,
    release: vi.fn(async () => {
      lock.released = true;
    }),
  };
  return lock;
}

function fakeWakeLocks(answer?: () => Promise<FakeScreenLock>) {
  const granted: FakeScreenLock[] = [];
  const request = vi.fn((_type: string) => {
    if (answer) return answer();
    const lock = fakeScreenLock();
    granted.push(lock);
    return Promise.resolve(lock);
  });
  const held = (): FakeScreenLock => {
    const lock = granted[0];
    if (!lock) throw new Error("no lock was granted");
    return lock;
  };
  return { request, held };
}

const holdWith = (wake: ReturnType<typeof fakeWakeLocks> | undefined) => new ScreenHold(() => wake as never);

describe("ScreenHold", () => {
  it("holds the screen while it is on and lets it go when it is off", async () => {
    const wake = fakeWakeLocks();
    const hold = holdWith(wake);
    hold.set(true);
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(1);
    expect(wake.request).toHaveBeenCalledWith("screen");
    expect(wake.held().release).not.toHaveBeenCalled();
    hold.set(true);
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(1);
    hold.set(false);
    expect(wake.held().release).toHaveBeenCalledTimes(1);
    expect(wake.request).toHaveBeenCalledTimes(1);
  });

  it("asks again after the browser released the lock while it is still on", async () => {
    const wake = fakeWakeLocks();
    const hold = holdWith(wake);
    hold.set(true);
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(1);
    wake.held().released = true;
    hold.set(true);
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(2);
  });

  it("releases a lock that arrives after it has already been turned off", async () => {
    let arrive: (lock: FakeScreenLock) => void = () => undefined;
    const late = fakeScreenLock();
    const wake = fakeWakeLocks(() => new Promise<FakeScreenLock>((resolve) => void (arrive = resolve)));
    const hold = holdWith(wake);
    hold.set(true);
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(1);
    hold.set(false);
    arrive(late);
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(wake.request).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a second lock while one request is still pending", async () => {
    let arrive: (lock: FakeScreenLock) => void = () => undefined;
    const wake = fakeWakeLocks(() => new Promise<FakeScreenLock>((resolve) => void (arrive = resolve)));
    const hold = holdWith(wake);
    hold.set(true);
    await flush();
    hold.set(true);
    hold.set(true);
    expect(wake.request).toHaveBeenCalledTimes(1);
    arrive(fakeScreenLock());
    await flush();
    hold.set(true);
    expect(wake.request).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser without a screen wake lock, and when the request is refused", async () => {
    const none = holdWith(undefined);
    expect(() => none.set(true)).not.toThrow();
    none.set(false);

    const refusing = fakeWakeLocks(() => Promise.reject(new Error("denied")));
    const hold = holdWith(refusing);
    hold.set(true);
    await flush();
    hold.set(true);
    await flush();
    expect(refusing.request).toHaveBeenCalledTimes(2);
    hold.set(false);
  });
});
