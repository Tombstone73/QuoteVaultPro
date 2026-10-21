import { afterEach, describe, expect, test } from "@jest/globals";
import {
  NOTIFICATION_HISTORY_LIMIT, addNotification, clearNotificationSession, dismissNotification,
  getNotificationSnapshot, setNotificationScope, toast, updateNotification,
} from "./use-toast";

afterEach(() => {
  clearNotificationSession();
  sessionStorage.clear();
});

describe("recent notification history", () => {
  test("orders newest first, bounds history, and collapses identical autosave messages", () => {
    setNotificationScope("user:a:tenant:a");
    addNotification({ title: "Saved" });
    addNotification({ title: "Saved" });
    expect(getNotificationSnapshot().toasts[0].count).toBe(2);
    for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 5; index++) {
      addNotification({ title: `Message ${index}` });
    }
    const history = getNotificationSnapshot().toasts;
    expect(history).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
    expect(history[0].title).toBe(`Message ${NOTIFICATION_HISTORY_LIMIT + 4}`);
    expect(history.some((item) => item.title === "Message 0")).toBe(false);
  });

  test("moves a repeated message to the top and announces each occurrence", () => {
    setNotificationScope("user:a:tenant:a");
    const first = addNotification({ title: "Autosaved", severity: "success" });
    addNotification({ title: "Other", severity: "info" });
    const before = getNotificationSnapshot().announcement?.id;
    const repeated = addNotification({ title: "Autosaved", severity: "success" });
    const state = getNotificationSnapshot();
    expect(repeated).toBe(first);
    expect(state.toasts[0]).toMatchObject({ id: first, count: 2 });
    expect(state.announcement?.id).not.toBe(before);
  });

  test("keeps errors in history until dismissed and updates async progress in place", () => {
    setNotificationScope("user:a:tenant:a");
    const progress = toast({ title: "Saving", severity: "info" });
    progress.update({ title: "Save failed" });
    addNotification({ title: "Saved" });
    expect(getNotificationSnapshot().toasts.filter((item) => item.severity === "error")).toHaveLength(1);
    expect(getNotificationSnapshot().toasts.find((item) => item.id === progress.id)?.title).toBe("Save failed");
    dismissNotification(progress.id);
    expect(getNotificationSnapshot().toasts.some((item) => item.id === progress.id)).toBe(false);
  });

  test("keeps history across navigation-like reads and scopes it to the user and tenant", () => {
    setNotificationScope("user:a:tenant:a");
    addNotification({ title: "Private invoice message" });
    expect(sessionStorage.getItem("printershero:notifications:user:a:tenant:a")).toContain("Private invoice message");
    setNotificationScope("user:a:tenant:b");
    expect(getNotificationSnapshot().toasts).toHaveLength(0);
    expect(sessionStorage.getItem("printershero:notifications:user:a:tenant:a")).toBeNull();
    addNotification({ title: "Other tenant" });
    clearNotificationSession();
    expect(getNotificationSnapshot().toasts).toHaveLength(0);
    expect(sessionStorage.getItem("printershero:notifications:user:a:tenant:b")).toBeNull();
  });

  test("persists safe text and announces an updated notification", () => {
    setNotificationScope("user:a:tenant:a");
    const id = addNotification({ title: "Retry", description: "Save failed" });
    updateNotification(id, { title: "Saved" });
    expect(getNotificationSnapshot().toasts[0].title).toBe("Saved");
    expect(getNotificationSnapshot().announcement?.text).toContain("Saved");
    expect(sessionStorage.getItem("printershero:notifications:user:a:tenant:a")).toContain("Saved");
  });
});
