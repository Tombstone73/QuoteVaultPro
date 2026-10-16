import React from "react";
import { describe, expect, test } from "@jest/globals";
import { Toast, ToastAction, ToastClose, ToastProvider, ToastTitle, ToastViewport } from "./toast";

describe("global toast controls", () => {
  test("keeps action and close controls available in the shared viewport", async () => {
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let actionCount = 0;
    let closed = false;

    await act(async () => root.render(
      <ToastProvider>
        <Toast defaultOpen onOpenChange={(open) => { closed = !open; }}>
          <ToastTitle>Saved with a warning</ToastTitle>
          <ToastAction altText="Retry save" onClick={() => { actionCount += 1; }}>Retry</ToastAction>
          <ToastClose />
        </Toast>
        <ToastViewport data-testid="toast-viewport" />
      </ToastProvider>,
    ));

    const viewport = container.querySelector('[data-testid="toast-viewport"]');
    expect(viewport?.textContent).toContain("Saved with a warning");
    await act(async () => {
      viewport?.querySelector<HTMLButtonElement>('button:not([toast-close])')?.click();
    });
    expect(actionCount).toBe(1);
    await act(async () => {
      viewport?.querySelector<HTMLButtonElement>('button[toast-close]')?.click();
    });
    expect(closed).toBe(true);

    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
