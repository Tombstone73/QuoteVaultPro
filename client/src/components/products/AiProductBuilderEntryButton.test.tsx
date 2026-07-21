import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { AiProductBuilderEntryButton } from "./AiProductBuilderEntryButton";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("AiProductBuilderEntryButton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("is visible to authorized product staff and opens the guided builder", () => {
    const onOpen = jest.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<AiProductBuilderEntryButton canAccess onOpen={onOpen} />));
    const button = container.querySelector('[data-testid="ai-product-builder-entry"]') as HTMLButtonElement;
    expect(button.textContent).toContain("AI Product Builder");
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  test("is hidden without product administration access", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<AiProductBuilderEntryButton canAccess={false} onOpen={() => undefined} />));
    expect(container.textContent).toBe("");
    act(() => root.unmount());
  });
});
