import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ToastAction } from "@/components/ui/toast";
import { clearNotificationSession, setNotificationScope, toast } from "@/hooks/use-toast";
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
});
