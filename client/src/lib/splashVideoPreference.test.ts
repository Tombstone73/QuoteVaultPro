import { describe, expect, it, jest } from "@jest/globals";
import {
  hasSplashVideoBeenSeen,
  markSplashVideoSeen,
  SPLASH_VIDEO_SEEN_STORAGE_KEY,
} from "./splashVideoPreference";

describe("splash video preference", () => {
  it("stores and reads the browser-only seen state", () => {
    window.localStorage.clear();

    expect(hasSplashVideoBeenSeen()).toBe(false);

    markSplashVideoSeen();

    expect(window.localStorage.getItem(SPLASH_VIDEO_SEEN_STORAGE_KEY)).toBe("true");
    expect(hasSplashVideoBeenSeen()).toBe(true);
  });

  it("falls back to not seen when localStorage reads throw", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    try {
      expect(hasSplashVideoBeenSeen()).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });

  it("does not throw when localStorage writes fail", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    try {
      expect(() => markSplashVideoSeen()).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
