import React from "react";
import { describe, expect, test } from "@jest/globals";
import { ToastProvider, ToastViewport } from "./toast";

describe("global toast placement", () => {
  test("keeps desktop toasts in the top-right away from sticky workflow actions", async () => {
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(
      <ToastProvider>
        <ToastViewport data-testid="toast-viewport" />
      </ToastProvider>,
    ));

    const viewport = container.querySelector('[data-testid="toast-viewport"]');
    expect(viewport?.className).toContain("sm:top-0");
    expect(viewport?.className).toContain("sm:right-0");
    expect(viewport?.className).toContain("sm:bottom-auto");
    expect(viewport?.className).not.toContain("sm:bottom-0");

    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
