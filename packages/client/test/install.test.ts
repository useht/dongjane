import { describe, expect, it } from "vitest";
import {
  captureInstallPrompt,
  getInstallPrompt,
  installHint,
  isIosSafari,
  isStandalone,
  onInstallChange,
  takeInstallPrompt,
} from "../src/install.ts";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1";
const IPHONE_IN_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";

describe("isStandalone", () => {
  it("is installed when the display mode is standalone", () => {
    expect(isStandalone(true, undefined)).toBe(true);
  });

  it("is installed when iOS reports navigator.standalone", () => {
    expect(isStandalone(false, true)).toBe(true);
  });

  it("is not installed in a plain browser tab", () => {
    expect(isStandalone(false, undefined)).toBe(false);
    expect(isStandalone(false, false)).toBe(false);
  });
});

describe("isIosSafari", () => {
  it("recognises iPhone Safari", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
  });

  it("recognises iPad Safari that reports a desktop user agent", () => {
    expect(isIosSafari(IPAD_SAFARI_DESKTOP_UA, 5)).toBe(true);
  });

  it("does not mistake desktop Safari for iOS", () => {
    expect(isIosSafari(IPAD_SAFARI_DESKTOP_UA, 0)).toBe(false);
  });

  it("skips iOS browsers whose share menu differs", () => {
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(isIosSafari(IPHONE_IN_APP, 5)).toBe(false);
  });

  it("ignores Android", () => {
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe("installHint", () => {
  it("offers the deferred prompt first", () => {
    expect(installHint({ installed: false, hasPrompt: true, iosSafari: false })).toBe("prompt");
    expect(installHint({ installed: false, hasPrompt: true, iosSafari: true })).toBe("prompt");
  });

  it("falls back to manual steps on iOS Safari", () => {
    expect(installHint({ installed: false, hasPrompt: false, iosSafari: true })).toBe("ios");
  });

  it("stays quiet when there is no install path", () => {
    expect(installHint({ installed: false, hasPrompt: false, iosSafari: false })).toBeNull();
  });

  it("stays quiet once installed", () => {
    expect(installHint({ installed: true, hasPrompt: true, iosSafari: true })).toBeNull();
  });
});

describe("captureInstallPrompt", () => {
  it("holds the browser prompt for later and announces changes", () => {
    const target = new EventTarget();
    let changes = 0;
    onInstallChange(() => {
      changes += 1;
    });
    captureInstallPrompt(target);

    const event = new Event("beforeinstallprompt", { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallPrompt()).toBe(event);
    expect(changes).toBe(1);

    target.dispatchEvent(new Event("appinstalled"));
    expect(getInstallPrompt()).toBeNull();
    expect(changes).toBe(2);
  });

  it("hands the prompt out only once", () => {
    const target = new EventTarget();
    captureInstallPrompt(target);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    target.dispatchEvent(event);

    expect(takeInstallPrompt()).toBe(event);
    expect(getInstallPrompt()).toBeNull();
    expect(takeInstallPrompt()).toBeNull();
  });
});
