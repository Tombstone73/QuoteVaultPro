import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ToastAction } from "@/components/ui/toast";
import { addNotification, clearNotificationSession, setNotificationScope, toast } from "@/hooks/use-toast";
import { NotificationArea } from "./NotificationArea";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/invoices", search: "" }),
  useNavigate: () => jest.fn(),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (media) => ({
    matches: false, media, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState({}, "", "/invoices");
  setNotificationScope("staff:test:tenant");
});

afterEach(async () => {
  jest.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  clearNotificationSession();
  sessionStorage.clear();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("header notification area", () => {
  test("opens from its focusable trigger, keeps actions keyboard accessible, and never renders a floating viewport", async () => {
    let retries = 0;
    await act(async () => root.render(<NotificationArea />));
    await act(async () => {
      toast({
        title: "Save failed",
        description: "Please retry this save.",
        variant: "destructive",
        action: <ToastAction altText="Retry save" onClick={() => { retries++; }}>Retry</ToastAction>,
      });
    });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]');
    expect(trigger?.getAttribute("aria-label")).toContain("1 unread errors");
    await act(async () => trigger?.focus());
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger?.click());
    expect(document.body.textContent).toContain("Please retry this save.");
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="Retry save"]');
    expect(retry?.disabled).toBe(false);
    await act(async () => retry?.focus());
    expect(document.activeElement).toBe(retry);
    await act(async () => retry?.click());
    expect(retries).toBe(1);
    expect(document.querySelector(".toast-viewport")).toBeNull();
  });

  test("keeps an unread-error indicator after a later success and marks errors read explicitly", async () => {
    await act(async () => root.render(<NotificationArea />));
    await act(async () => {
      toast({ title: "Failed", variant: "destructive" });
      toast({ title: "Saved" });
    });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]');
    expect(trigger?.getAttribute("aria-label")).toContain("1 unread errors");
    await act(async () => trigger?.click());
    const markRead = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Mark all read");
    await act(async () => markRead?.click());
    expect(trigger?.getAttribute("aria-label")).not.toContain("unread errors");
  });

  test("shows each newest arrival immediately, including grouped repeats, with severity styling that settles", async () => {
    jest.useFakeTimers();
    await act(async () => root.render(<NotificationArea />));
    await act(async () => { addNotification({ title: "First", severity: "info" }); addNotification({ title: "Second", severity: "warning" }); });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]')!;
    expect(trigger.textContent).toContain("Second");
    expect(trigger.className).toContain("border-amber-600");
    await act(async () => { jest.advanceTimersByTime(1900); });
    expect(trigger.className).toContain("border-amber-400");
    await act(async () => { jest.advanceTimersByTime(1100); });
    expect(trigger.textContent).toContain("First");
    await act(async () => { addNotification({ title: "Second", severity: "warning" }); });
    expect(trigger.textContent).toContain("Second (×2)");
    expect(trigger.className).toContain("border-amber-600");
    await act(async () => { addNotification({ title: "Failure", severity: "error" }); addNotification({ title: "Saved", severity: "success" }); });
    expect(trigger.textContent).toContain("Saved");
    expect(trigger.className).toContain("border-emerald-600");
    expect(trigger.getAttribute("aria-label")).toContain("1 unread errors");
  });

  test("respects reduced motion and keeps scrolled history in place until New messages is selected", async () => {
    window.matchMedia = (media) => ({
      matches: true, media, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    });
    await act(async () => root.render(<NotificationArea />));
    await act(async () => {
      addNotification({ title: "Old", severity: "info" });
      addNotification({ title: "Newest", severity: "error" });
    });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Notifications"]')!;
    expect(trigger.className).toContain("motion-reduce:transition-none");
    await act(async () => trigger.click());
    const list = document.querySelector<HTMLDivElement>('[aria-label="Notification history"]')!;
    expect(list.scrollTop).toBe(0);
    await act(async () => { list.scrollTop = 80; list.dispatchEvent(new Event("scroll", { bubbles: true })); });
    await act(async () => { addNotification({ title: "Later", severity: "success" }); });
    expect(list.scrollTop).toBe(80);
    expect(document.body.textContent).toContain("New messages (1)");
    const newMessages = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "New messages (1)")!;
    await act(async () => newMessages.click());
    expect(list.scrollTop).toBe(0);
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-notification-id]"));
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Later"), expect.stringContaining("Newest")]));
    expect(rows[0].textContent).toContain("Later");
    await act(async () => { list.scrollTop = 70; list.dispatchEvent(new Event("scroll", { bubbles: true })); });
    await act(async () => trigger.click());
    await act(async () => trigger.click());
    expect(document.querySelector<HTMLDivElement>('[aria-label="Notification history"]')?.scrollTop).toBe(0);
  });
});
