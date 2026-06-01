export const SPLASH_VIDEO_SEEN_STORAGE_KEY = "titanos:splashVideoSeen:v1";

function getLocalStorage() {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasSplashVideoBeenSeen() {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    return storage.getItem(SPLASH_VIDEO_SEEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function markSplashVideoSeen() {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(SPLASH_VIDEO_SEEN_STORAGE_KEY, "true");
  } catch {
    // Browser preference only; the landing page should still work if storage is blocked.
  }
}
