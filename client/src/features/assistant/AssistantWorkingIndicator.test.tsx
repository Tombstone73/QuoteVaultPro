import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { AssistantWorkingIndicator, formatAssistantWorkingElapsed, resolveAssistantWorkingState } from "./AssistantWorkingIndicator";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(active: boolean, label?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<AssistantWorkingIndicator active={active} label={label} />));
  return { container, root };
}

describe("AssistantWorkingIndicator", () => {
  afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ""; });

  test("formats seconds and minutes", () => {
    expect(formatAssistantWorkingElapsed(0)).toBe("0s");
    expect(formatAssistantWorkingElapsed(8_900)).toBe("8s");
    expect(formatAssistantWorkingElapsed(72_000)).toBe("1m 12s");
  });

  test("uses generic thinking unless a real plan request is active", () => {
    expect(resolveAssistantWorkingState({ turnPending: true, planPreparationPending: false, planExecutionPending: false })).toEqual({ active: true, label: "Thinking…" });
    expect(resolveAssistantWorkingState({ turnPending: false, planPreparationPending: true, planExecutionPending: false })).toEqual({ active: true, label: "Preparing changes…" });
    expect(resolveAssistantWorkingState({ turnPending: false, planPreparationPending: false, planExecutionPending: true })).toEqual({ active: true, label: "Applying changes…" });
    expect(resolveAssistantWorkingState({ turnPending: false, planPreparationPending: false, planExecutionPending: false })).toEqual({ active: false, label: "Thinking…" });
  });

  test("appears immediately and advances its client-side elapsed timer", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
    const view = render(true);
    expect(view.container.textContent).toContain("Thinking…0s");
    act(() => { jest.advanceTimersByTime(8_000); });
    expect(view.container.textContent).toContain("Thinking…8s");
    expect(view.container.querySelector("[role=status]")?.getAttribute("aria-label")).toBe("AI is working");
    expect(view.container.querySelector("svg")?.getAttribute("class")).toContain("motion-reduce:animate-none");
    act(() => view.root.unmount());
  });

  test("disappears when the active request settles and resets for the next turn", () => {
    jest.useFakeTimers();
    const view = render(true);
    act(() => { jest.advanceTimersByTime(3_000); });
    expect(view.container.textContent).toContain("3s");
    act(() => view.root.render(<AssistantWorkingIndicator active={false} />));
    expect(view.container.querySelector("[data-testid=assistant-working-indicator]")).toBeNull();
    act(() => view.root.render(<AssistantWorkingIndicator active label="Applying changes…" />));
    expect(view.container.textContent).toContain("Applying changes…0s");
    act(() => view.root.unmount());
  });
});
